// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../interfaces/IPolicyNFT.sol";
import "../interfaces/IPoolRegistry.sol";
import "../interfaces/ICapitalPool.sol";
import "../interfaces/IBackstopPool.sol";
import "../interfaces/IRewardDistributor.sol";
import "../interfaces/IRiskManagerPMHook.sol";
import {IUnderwriterManager} from "../interfaces/IUnderwriterManager.sol";


/**
 * @title PolicyManager
 * @author Gemini
 * @notice Handles policy lifecycle, including purchasing, premium management, and cancellations.
 * @dev V2: Hardened against Denial of Service attacks by limiting the number of pending increases per policy.
 */
contract PolicyManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ───────────────────────── Constants ───────────────────────── */
    uint256 public constant BPS = 10_000;
    uint256 public constant SECS_YEAR = 365 days;
    uint256 public constant PROCESS_LIMIT = 50;  // Max pending increases & batch processing cap

    /* ───────────────────────── State Variables ───────────────────────── */
    uint256 public coverCooldownPeriod = 0 days;
    IPoolRegistry public poolRegistry;
    ICapitalPool public capitalPool;
    IBackstopPool public catPool;
    IPolicyNFT public immutable policyNFT;
    IRewardDistributor public rewardDistributor;
    IRiskManagerPMHook public riskManager;
    IUnderwriterManager public underwriterManager;
    uint256 public catPremiumBps = 2_000; // 20%

    // --- Pending increases as a linked list ---
    struct PendingIncreaseNode {
        uint128 amount;
        uint128 activationTimestamp;
        uint256 nextNodeId;
    }

    mapping(uint256 => uint256) public pendingIncreaseListHead;
    mapping(uint256 => PendingIncreaseNode) private _nodes;
    mapping(uint256 => uint256) public pendingCoverageSum;
    // --- NEW: Counter to prevent DoS vector ---
    mapping(uint256 => uint256) public pendingIncreaseCount;
    uint256 private _nextNodeId = 1;

    /* ───────────────────────── Errors ───────────────────────── */
    error PoolPaused();
    error InvalidAmount();
    error InsufficientCapacity();
    error NotPolicyOwner();
    error PolicyAlreadyTerminated();
    error CooldownActive();
    error DepositTooLow();
    error PolicyIsActive();
    error PolicyNotActive();
    error AddressesNotSet();
    error TooManyPendingIncreases();
    error NotRiskManager();

    /* ───────────────────────── Events ──────────────────────────── */
    event AddressesSet(address indexed registry, address indexed capital, address indexed rewards, address rm, address um);
    event CatPremiumShareSet(uint256 newBps);
    event CatPoolSet(address indexed newCatPool);
    event CoverCooldownPeriodSet(uint256 newPeriod);
    event CoverIncreaseRequested(uint256 indexed policyId, uint256 additionalCoverage, uint256 activationTimestamp);
    event PremiumAdded(uint256 indexed policyId, uint256 amount);

    /* ───────────────────────── Constructor ───────────────────────── */
    constructor(address _policyNFT, address _initialOwner) Ownable(_initialOwner) {
        policyNFT = IPolicyNFT(_policyNFT);
    }

    /* ───────────────────── Modifiers ───────────────────── */
    modifier onlyRiskManager() {
        require(msg.sender == address(riskManager), "PM: Caller is not the RiskManager");
        _;
    }

    /* ───────────────────── Admin Functions ───────────────────── */
    function setAddresses(
        address registry,
        address capital,
        address cat,
        address rewards,
        address rm,
        address um
    ) external onlyOwner {
        if (registry == address(0) || capital == address(0) || cat == address(0) ||
            rewards == address(0) || rm == address(0) || um == address(0)) {
            revert AddressesNotSet();
        }
        poolRegistry = IPoolRegistry(registry);
        capitalPool = ICapitalPool(capital);
        catPool = IBackstopPool(cat);
        rewardDistributor = IRewardDistributor(rewards);
        riskManager = IRiskManagerPMHook(rm);
        underwriterManager = IUnderwriterManager(um);
        emit AddressesSet(registry, capital, rewards, rm, um);
    }

    function setCatPool(address catPoolAddress) external onlyOwner {
        if (catPoolAddress == address(0)) revert AddressesNotSet();
        catPool = IBackstopPool(catPoolAddress);
        emit CatPoolSet(catPoolAddress);
    }

    function setCatPremiumShareBps(uint256 newBps) external onlyOwner {
        if (newBps > 5000) revert InvalidAmount();
        catPremiumBps = newBps;
        emit CatPremiumShareSet(newBps);
    }

    function setCoverCooldownPeriod(uint256 newPeriod) external onlyOwner {
        coverCooldownPeriod = newPeriod;
        emit CoverCooldownPeriodSet(newPeriod);
    }

    /* ───────────────────── Policy Management ───────────────────── */
    function purchaseCover(
        uint256 poolId,
        uint256 coverageAmount,
        uint256 initialPremiumDeposit
    ) external nonReentrant returns (uint256 policyId) {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();
        if (coverageAmount == 0 || initialPremiumDeposit == 0) revert InvalidAmount();
        if (initialPremiumDeposit > type(uint128).max) revert InvalidAmount();

        uint256 activationTimestamp = _preparePurchase(poolId, coverageAmount, initialPremiumDeposit);

        capitalPool.underlyingAsset().safeTransferFrom(msg.sender, address(this), initialPremiumDeposit);

        policyId = policyNFT.mint(
            msg.sender,
            poolId,
            coverageAmount,
            activationTimestamp,
            uint128(initialPremiumDeposit),
            uint128(activationTimestamp)
        );

        riskManager.updateCoverageSold(poolId, coverageAmount, true);
    }

    function addPremium(uint256 policyId, uint256 amount) external nonReentrant {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();
        if (amount == 0) revert InvalidAmount();
        if (amount > type(uint128).max) revert InvalidAmount();

        _settleAndDrainPremium(policyId);
        if (policyNFT.ownerOf(policyId) != msg.sender) revert NotPolicyOwner();
        if (!isPolicyActive(policyId)) revert PolicyNotActive();

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(policyId);
        if (pol.coverage == 0) revert PolicyAlreadyTerminated();

        capitalPool.underlyingAsset().safeTransferFrom(msg.sender, address(this), amount);

        uint128 newDeposit = pol.premiumDeposit + uint128(amount);
        policyNFT.updatePremiumAccount(policyId, newDeposit, pol.lastDrainTime);

        emit PremiumAdded(policyId, amount);
    }

    function increaseCover(uint256 policyId, uint256 additionalCoverage) external nonReentrant {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();
        if (additionalCoverage == 0 || additionalCoverage > type(uint128).max) revert InvalidAmount();

        // --- FIXED: Enforce limit on pending increases to prevent DoS ---
        require(pendingIncreaseCount[policyId] < PROCESS_LIMIT, "Too many pending increases");
        
        _settleAndDrainPremium(policyId);
        if (policyNFT.ownerOf(policyId) != msg.sender) revert NotPolicyOwner();
        if (!isPolicyActive(policyId)) revert PolicyNotActive();

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(policyId);
        if (pol.coverage == 0) revert PolicyAlreadyTerminated();

        _validateIncreaseCover(policyId, additionalCoverage, pol);

        uint256 activateAt = block.timestamp + coverCooldownPeriod;
        uint256 nodeId = _nextNodeId++;
        _nodes[nodeId] = PendingIncreaseNode({
            amount: uint128(additionalCoverage),
            activationTimestamp: uint128(activateAt),
            nextNodeId: pendingIncreaseListHead[policyId]
        });
        pendingIncreaseListHead[policyId] = nodeId;
        pendingCoverageSum[policyId] += additionalCoverage;
        pendingIncreaseCount[policyId]++; // --- FIXED: Increment counter ---

        riskManager.updateCoverageSold(pol.poolId, additionalCoverage, true);

        emit CoverIncreaseRequested(policyId, additionalCoverage, activateAt);
    }

    function cancelCover(uint256 policyId) external nonReentrant {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();
        if (policyNFT.ownerOf(policyId) != msg.sender) revert NotPolicyOwner();

        _settleAndDrainPremium(policyId);

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(policyId);
        if (pol.coverage == 0) revert PolicyAlreadyTerminated();
        if (block.timestamp < pol.activation) revert CooldownActive();

        _terminatePolicy(policyId, pol);

        if (pol.premiumDeposit > 0) {
            capitalPool.underlyingAsset().safeTransfer(msg.sender, pol.premiumDeposit);
        }
    }

    function lapsePolicy(uint256 policyId) external nonReentrant {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();

        _settleAndDrainPremium(policyId);
        if (isPolicyActive(policyId)) revert PolicyIsActive();

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(policyId);
        if (pol.coverage == 0) revert PolicyAlreadyTerminated();

        _terminatePolicy(policyId, pol);
    }

    /* ───────────────── Trusted Functions ───────────────── */
    function clearIncreasesAndGetPendingAmount(uint256 policyId)
        external
        onlyRiskManager
        returns (uint256 totalCancelled)
    {
        return _clearAllPendingIncreases(policyId);
    }

    /* ───────────────── Internal Helpers ────────────────────────── */
    function _terminatePolicy(uint256 policyId, IPolicyNFT.Policy memory pol) internal {
        uint256 pendingToCancel = _clearAllPendingIncreases(policyId);
        uint256 totalToReduce = pol.coverage + pendingToCancel;

        if (totalToReduce > 0) {
            riskManager.updateCoverageSold(pol.poolId, totalToReduce, false);
        }

        policyNFT.burn(policyId);
    }

    function _clearAllPendingIncreases(uint256 policyId) internal returns (uint256 totalCancelled) {
        totalCancelled = pendingCoverageSum[policyId];
        if (totalCancelled == 0) return 0;

        uint256 clearedCount = 0;
        uint256 nodeId = pendingIncreaseListHead[policyId];

        // This loop is now safe because the number of nodes is capped at PROCESS_LIMIT
        while (nodeId != 0) {
            // Safeguard check, should not be hit with the new logic
            if (clearedCount >= PROCESS_LIMIT) revert TooManyPendingIncreases();
            uint256 nextId = _nodes[nodeId].nextNodeId;
            delete _nodes[nodeId];
            nodeId = nextId;
            clearedCount++;
        }
        pendingIncreaseListHead[policyId] = 0;
        pendingCoverageSum[policyId] = 0;
        pendingIncreaseCount[policyId] = 0; // --- FIXED: Reset counter ---
    }

    function _validateIncreaseCover(uint256 policyId, uint256 additionalCoverage, IPolicyNFT.Policy memory pol) internal view {
        ( , uint256 sold, bool paused, , ,) = poolRegistry.getPoolStaticData(pol.poolId);
        if (paused) revert PoolPaused();

        (,,uint256 pledged) = underwriterManager.getPoolPayoutData(pol.poolId);
        uint256 pendingW = underwriterManager.capitalPendingWithdrawal(pol.poolId);

        uint256 availableCapital = pendingW >= pledged ? 0 : pledged - pendingW;
        uint256 totalPending = pendingCoverageSum[policyId];
        if (sold + totalPending + additionalCoverage > availableCapital) revert InsufficientCapacity();

        uint256 newTotalCoverage = pol.coverage + totalPending + additionalCoverage;
        uint256 rateBps = _getCurrentRateBps(pol.poolId, sold, availableCapital);
        uint256 minPremium = _getMinPremium(newTotalCoverage, rateBps);

        if (pol.premiumDeposit < minPremium) revert DepositTooLow();
    }

    function _preparePurchase(uint256 poolId, uint256 coverageAmount, uint256 initialPremiumDeposit)
        internal
        view
        returns (uint256 activationTimestamp)
    {
        ( , uint256 sold, bool paused, , ,) = poolRegistry.getPoolStaticData(poolId);
        if (paused) revert PoolPaused();

        (,,uint256 pledged) = underwriterManager.getPoolPayoutData(poolId);
        uint256 pendingW = underwriterManager.capitalPendingWithdrawal(poolId);

        uint256 availableCapital = pendingW >= pledged ? 0 : pledged - pendingW;
        if (sold + coverageAmount > availableCapital) revert InsufficientCapacity();

        uint256 rateBps = _getCurrentRateBps(poolId, sold, availableCapital);
        uint256 minPremium = _getMinPremium(coverageAmount, rateBps);

        if (initialPremiumDeposit < minPremium) revert DepositTooLow();

        activationTimestamp = block.timestamp + coverCooldownPeriod;
    }

    function _settleAndDrainPremium(uint256 _policyId) internal {
        _resolvePendingIncrease(_policyId);
        _drainOwedPremium(_policyId);
    }

    function _drainOwedPremium(uint256 _policyId) internal {
        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (block.timestamp <= pol.lastDrainTime) {
            return;
        }

        (uint256 cost,) = _calculatePremiumCost(pol);
        uint256 toDrain = Math.min(cost, pol.premiumDeposit);

        if (toDrain < 1) {
            policyNFT.updatePremiumAccount(_policyId, uint128(pol.premiumDeposit), uint128(block.timestamp));
            return;
        }

        uint128 newDeposit = uint128(pol.premiumDeposit - toDrain);
        policyNFT.updatePremiumAccount(_policyId, newDeposit, uint128(block.timestamp));

        _distributeDrainedPremium(pol.poolId, toDrain);
    }

    function _calculatePremiumCost(IPolicyNFT.Policy memory pol) internal view returns (uint256 cost, uint256 rateBps) {
        ( , uint256 sold, , , ,) = poolRegistry.getPoolStaticData(pol.poolId);
        (,,uint256 pledged) = underwriterManager.getPoolPayoutData(pol.poolId);
        uint256 pendingW = underwriterManager.capitalPendingWithdrawal(pol.poolId);
        
        uint256 availableCapital = pendingW >= pledged ? 0 : pledged - pendingW;
        rateBps = _getCurrentRateBps(pol.poolId, sold, availableCapital);

        if (rateBps == 0) return (0, 0);

        uint256 elapsed = block.timestamp - pol.lastDrainTime;
        cost = (pol.coverage * rateBps * elapsed) / (SECS_YEAR * BPS);
    }

    function _distributeDrainedPremium(uint256 poolId, uint256 amount) internal {
        uint256 catAmt = (amount * catPremiumBps) / BPS;
        uint256 poolInc = amount - catAmt;

        if (catAmt > 0) {
            IERC20 asset = capitalPool.underlyingAsset();
            asset.safeTransfer(address(catPool), catAmt);
            catPool.receiveUsdcPremium(catAmt);
        }

        if (poolInc > 0) {
            (,,uint256 pledged) = underwriterManager.getPoolPayoutData(poolId);
            if (pledged > 0) {
                IERC20 asset = capitalPool.underlyingAsset();
                asset.safeTransfer(address(rewardDistributor), poolInc);
                rewardDistributor.distribute(poolId, address(asset), poolInc, pledged);
            }
        }
    }

    function _resolvePendingIncrease(uint256 _policyId) internal {
        uint256 nodeId = pendingIncreaseListHead[_policyId];
        uint256 prev = 0;
        uint256 finalized = 0;
        uint256 processed = 0;

        while (nodeId != 0 && processed < PROCESS_LIMIT) {
            PendingIncreaseNode storage node = _nodes[nodeId];
            uint256 nextId = node.nextNodeId;

            if (block.timestamp >= node.activationTimestamp) {
                finalized += node.amount;
                pendingCoverageSum[_policyId] -= node.amount;
                pendingIncreaseCount[_policyId]--; // --- FIXED: Decrement counter ---

                if (prev == 0) {
                    pendingIncreaseListHead[_policyId] = nextId;
                } else {
                    _nodes[prev].nextNodeId = nextId;
                }
                delete _nodes[nodeId];
            } else {
                prev = nodeId;
            }
            nodeId = nextId;
            processed++;
        }

        if (finalized > 0) {
            policyNFT.finalizeIncreases(_policyId, finalized);
        }
    }

    function _getCurrentRateBps(uint256 poolId, uint256 sold, uint256 availableCapital) internal view returns (uint256) {
        IPoolRegistry.RateModel memory rateModel = poolRegistry.getPoolRateModel(poolId);
        if (availableCapital == 0) {
            return rateModel.base + rateModel.slope1 + rateModel.slope2;
        }

        uint256 utilBps = (sold * BPS) / availableCapital;
        if (utilBps < rateModel.kink) {
            return rateModel.base + (utilBps * rateModel.slope1) / BPS;
        } else {
            uint256 baseAndSlope1 = rateModel.base + rateModel.slope1;
            uint256 utilPostKink = utilBps - rateModel.kink;
            return baseAndSlope1 + (utilPostKink * rateModel.slope2) / BPS;
        }
    }

    function _getMinPremium(uint256 coverage, uint256 rateBps) internal pure returns (uint256) {
        return (coverage * rateBps * 7 days) / (SECS_YEAR * BPS);
    }

    /* ───────────────────── View Functions ───────────────────── */
    function getPendingIncreases(uint256 policyId) external view returns (PendingIncreaseNode[] memory) {
        uint256 count = pendingIncreaseCount[policyId];
        if (count == 0) {
            return new PendingIncreaseNode[](0);
        }

        PendingIncreaseNode[] memory list = new PendingIncreaseNode[](count);
        uint256 nodeId = pendingIncreaseListHead[policyId];
        for (uint256 i = 0; i < count; i++) {
            list[i] = _nodes[nodeId];
            nodeId = _nodes[nodeId].nextNodeId;
        }
        return list;
    }
    
    function isPolicyActive(uint256 policyId) public view returns (bool) {
        if (address(poolRegistry) == address(0)) return false;
        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(policyId);
        if (pol.coverage == 0) return false;
        if (block.timestamp <= pol.lastDrainTime) return pol.premiumDeposit > 0;

        ( , uint256 sold, , , ,) = poolRegistry.getPoolStaticData(pol.poolId);
        (,,uint256 pledged) = underwriterManager.getPoolPayoutData(pol.poolId);
        uint256 pendingW = underwriterManager.capitalPendingWithdrawal(pol.poolId);

        uint256 availableCapital = pendingW >= pledged ? 0 : pledged - pendingW;
        uint256 rateBps = _getCurrentRateBps(pol.poolId, sold, availableCapital);
        
        if (rateBps == 0) return pol.premiumDeposit > 0;

        uint256 elapsed = block.timestamp - pol.lastDrainTime;
        uint256 cost = (pol.coverage * rateBps * elapsed) / (SECS_YEAR * BPS);
        return pol.premiumDeposit > cost;
    }
}