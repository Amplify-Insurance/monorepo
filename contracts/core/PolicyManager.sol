// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IPolicyNFT.sol";
import "../interfaces/IPoolRegistry.sol";
import "../interfaces/ICapitalPool.sol";
import "../interfaces/IBackstopPool.sol";
import "../interfaces/IRewardDistributor.sol";
import "../interfaces/IRiskManagerPMHook.sol";

/**
 * @title PolicyManager
 * @author Gemini
 * @notice Handles policy lifecycle with a batched linked-list for pending increases,
 * tracking a storage sum to avoid under-counting and prevent DoS.
 */
contract PolicyManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ───────────────────────── Constants ───────────────────────── */
    uint256 public constant BPS = 10_000;
    uint256 public constant SECS_YEAR = 365 days;
    uint256 private constant PROCESS_LIMIT = 50;  // cap for batch processing

    /* ───────────────────────── State Variables ───────────────────────── */
    uint256 public coverCooldownPeriod = 0 days;
    IPoolRegistry public poolRegistry;
    ICapitalPool public capitalPool;
    IBackstopPool public catPool;
    IPolicyNFT public immutable policyNFT;
    IRewardDistributor public rewardDistributor;
    IRiskManagerPMHook public riskManager;
    uint256 public catPremiumBps = 2_000; // 20%

    // --- Pending increases as a linked list ---
    struct PendingIncreaseNode {
        uint128 amount;
        uint128 activationTimestamp;
        uint256 nextNodeId;
    }

    mapping(uint256 => uint256) public pendingIncreaseListHead;
    mapping(uint256 => PendingIncreaseNode) private _nodes;
    mapping(uint256 => uint256) public pendingCoverageSum;  // total queued per policy
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

    /* ───────────────────────── Events ──────────────────────────── */
    event AddressesSet(address indexed registry, address indexed capital, address indexed rewards, address rm);
    event CatPremiumShareSet(uint256 newBps);
    event CatPoolSet(address indexed newCatPool);
    event CoverCooldownPeriodSet(uint256 newPeriod);
    event CoverIncreaseRequested(uint256 indexed policyId, uint256 additionalCoverage, uint256 activationTimestamp);

    /* ───────────────────────── Constructor ───────────────────────── */
    constructor(address _policyNFT, address _initialOwner) Ownable(_initialOwner) {
        policyNFT = IPolicyNFT(_policyNFT);
    }

    /* ───────────────────── Admin Functions ───────────────────── */

    function setAddresses(
        address registry,
        address capital,
        address cat,
        address rewards,
        address rm
    ) external onlyOwner {
        if (
            registry == address(0) ||
            capital  == address(0) ||
            cat      == address(0) ||
            rewards  == address(0) ||
            rm       == address(0)
        ) revert AddressesNotSet();
        poolRegistry     = IPoolRegistry(registry);
        capitalPool      = ICapitalPool(capital);
        catPool          = IBackstopPool(cat);
        rewardDistributor= IRewardDistributor(rewards);
        riskManager      = IRiskManagerPMHook(rm);
        emit AddressesSet(registry, capital, rewards, rm);
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

        // All validation and data fetching is moved to the helper function
        // to reduce stack depth in this function.
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

    function increaseCover(uint256 policyId, uint256 additionalCoverage) external nonReentrant {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();
        if (additionalCoverage == 0 || additionalCoverage > type(uint128).max) revert InvalidAmount();
        
        // --- CHECKS ---
        // Perform state-modifying checks first.
        _settleAndDrainPremium(policyId);
        if (policyNFT.ownerOf(policyId) != msg.sender) revert NotPolicyOwner();
        if (!isPolicyActive(policyId)) revert PolicyNotActive();

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(policyId);
        if (pol.coverage == 0) revert PolicyAlreadyTerminated();

        // Perform view-based validation in a helper to reduce stack depth.
        _validateIncreaseCover(policyId, additionalCoverage, pol);

        // --- EFFECTS & INTERACTIONS ---
        uint256 activateAt = block.timestamp + coverCooldownPeriod;
        uint256 nodeId     = _nextNodeId++;
        _nodes[nodeId]     = PendingIncreaseNode({
            amount: uint128(additionalCoverage),
            activationTimestamp: uint128(activateAt),
            nextNodeId: pendingIncreaseListHead[policyId]
        });
        pendingIncreaseListHead[policyId] = nodeId;
        pendingCoverageSum[policyId]     += additionalCoverage;

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

        uint256 refund = pol.premiumDeposit;
        
        uint256 pendingToCancel = pendingCoverageSum[policyId];
        uint256 cleared = 0;
        uint256 nodeId = pendingIncreaseListHead[policyId];

        // batch delete up to PROCESS_LIMIT
        while (nodeId != 0) {
            if (cleared >= PROCESS_LIMIT) revert TooManyPendingIncreases();
            uint256 nextId = _nodes[nodeId].nextNodeId;
            delete _nodes[nodeId];
            nodeId = nextId;
            cleared++;
        }
        pendingIncreaseListHead[policyId] = 0;
        pendingCoverageSum[policyId] = 0;

        uint256 totalToReduce = pol.coverage + pendingToCancel;
        if (totalToReduce > 0) {
            riskManager.updateCoverageSold(pol.poolId, totalToReduce, false);
        }

        policyNFT.burn(policyId);
        if (refund > 0) {
            capitalPool.underlyingAsset().safeTransfer(msg.sender, refund);
        }
    }

    function lapsePolicy(uint256 policyId) external nonReentrant {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();

        _settleAndDrainPremium(policyId);
        if (isPolicyActive(policyId)) revert PolicyIsActive();

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(policyId);
        if (pol.coverage == 0) revert PolicyAlreadyTerminated();
        
        uint256 pendingToCancel = pendingCoverageSum[policyId];
        uint256 cleared = 0;
        uint256 nodeId = pendingIncreaseListHead[policyId];

        while (nodeId != 0) {
            if (cleared >= PROCESS_LIMIT) revert TooManyPendingIncreases();
            uint256 nextId = _nodes[nodeId].nextNodeId;
            delete _nodes[nodeId];
            nodeId = nextId;
            cleared++;
        }
        pendingIncreaseListHead[policyId] = 0;
        pendingCoverageSum[policyId] = 0;
        
        uint256 totalToReduce = pol.coverage + pendingToCancel;
        if (totalToReduce > 0) {
            riskManager.updateCoverageSold(pol.poolId, totalToReduce, false);
        }

        policyNFT.burn(policyId);
    }

    /* ───────────────── Internal Helpers ────────────────────────── */

    /**
     * @dev Internal helper to validate a cover increase request.
     * @notice This function consolidates view-based checks to prevent "Stack too deep" errors.
     */
    function _validateIncreaseCover(uint256 policyId, uint256 additionalCoverage, IPolicyNFT.Policy memory pol) internal view {
        (
            , // _pt
            uint256 pledged,
            uint256 sold,
            uint256 pendingW,
            bool paused,
            , // _fr
              // _cf
        ) = poolRegistry.getPoolData(pol.poolId);

        if (paused) revert PoolPaused();

        uint256 availableCapital = pendingW >= pledged ? 0 : pledged - pendingW;
        uint256 totalPending = pendingCoverageSum[policyId];
        if (sold + totalPending + additionalCoverage > availableCapital) revert InsufficientCapacity();

        uint256 newTotalCoverage = pol.coverage + totalPending + additionalCoverage;
        
        uint256 rateBps;
        {
            IPoolRegistry.RateModel memory rateModel = poolRegistry.getPoolRateModel(pol.poolId);
            if (availableCapital == 0) {
                rateBps = rateModel.base + (rateModel.slope1 * rateModel.kink) / BPS + (rateModel.slope2 * (BPS - rateModel.kink)) / BPS;
            } else {
                uint256 utilBps = (sold * BPS) / availableCapital;
                if (utilBps < rateModel.kink) {
                    rateBps = rateModel.base + (sold * rateModel.slope1) / availableCapital;
                } else {
                    uint256 postKink = (sold * BPS) - (rateModel.kink * availableCapital);
                    rateBps = rateModel.base + (rateModel.slope1 * rateModel.kink) / BPS + ((rateModel.slope2 * postKink) / (availableCapital * BPS));
                }
            }
        }

        // FIX: Combine calculation to save a stack slot for `minPremium`
        if (pol.premiumDeposit < (newTotalCoverage * rateBps * 7 days) / (SECS_YEAR * BPS)) revert DepositTooLow();
    }

    /**
     * @dev Internal helper to validate and prepare data for a new policy purchase.
     * @notice This function consolidates checks and calculations to prevent "Stack too deep" errors.
     * @return activationTimestamp The timestamp when the policy will become active.
     */
    function _preparePurchase(uint256 poolId, uint256 coverageAmount, uint256 initialPremiumDeposit)
        internal
        view
        returns (uint256 activationTimestamp)
    {
        (
            , // _pt
            uint256 pledged,
            uint256 sold,
            uint256 pendingW,
            bool paused,
            , // _feeR
              // _claimFee
        ) = poolRegistry.getPoolData(poolId);

        if (paused) revert PoolPaused();

        uint256 availableCapital = pendingW >= pledged ? 0 : pledged - pendingW;
        if (sold + coverageAmount > availableCapital) revert InsufficientCapacity();

        uint256 rateBps;
        {
            IPoolRegistry.RateModel memory rateModel = poolRegistry.getPoolRateModel(poolId);
            if (availableCapital == 0) {
                rateBps = rateModel.base + (rateModel.slope1 * rateModel.kink) / BPS + (rateModel.slope2 * (BPS - rateModel.kink)) / BPS;
            } else {
                uint256 utilBps = (sold * BPS) / availableCapital;
                if (utilBps < rateModel.kink) {
                    rateBps = rateModel.base + (sold * rateModel.slope1) / availableCapital;
                } else {
                    uint256 postKink = (sold * BPS) - (rateModel.kink * availableCapital);
                    rateBps = rateModel.base + (rateModel.slope1 * rateModel.kink) / BPS + ((rateModel.slope2 * postKink) / (availableCapital * BPS));
                }
            }
        }
        
        // FIX: Combine calculation to save a stack slot for `minPremium`
        if (initialPremiumDeposit < (coverageAmount * rateBps * 7 days) / (SECS_YEAR * BPS)) revert DepositTooLow();

        activationTimestamp = block.timestamp + coverCooldownPeriod;
    }

    /**
    * @dev FIX: This function is refactored to reduce local variables and avoid a "Stack too deep" error.
    */
    function _settleAndDrainPremium(uint256 _policyId) internal {
        _resolvePendingIncrease(_policyId);

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (block.timestamp <= pol.lastDrainTime) return;

        ( , uint256 pledged, uint256 sold, uint256 pendingW, , , ) = poolRegistry.getPoolData(pol.poolId);

        uint256 rateBps;
        {
            IPoolRegistry.RateModel memory rateModel = poolRegistry.getPoolRateModel(pol.poolId);
            uint256 availableCapital = pendingW >= pledged ? 0 : pledged - pendingW;
            if (availableCapital == 0) {
                rateBps = rateModel.base + (rateModel.slope1 * rateModel.kink) / BPS + (rateModel.slope2 * (BPS - rateModel.kink)) / BPS;
            } else {
                uint256 utilBps = (sold * BPS) / availableCapital;
                if (utilBps < rateModel.kink) {
                    rateBps = rateModel.base + (sold * rateModel.slope1) / availableCapital;
                } else {
                    uint256 postKink = (sold * BPS) - (rateModel.kink * availableCapital);
                    rateBps = rateModel.base + (rateModel.slope1 * rateModel.kink) / BPS + ((rateModel.slope2 * postKink) / (availableCapital * BPS));
                }
            }
        }

        uint256 elapsed = block.timestamp - pol.lastDrainTime;

        if (rateBps == 0) {
            policyNFT.updatePremiumAccount(_policyId, pol.premiumDeposit, uint128(block.timestamp));
            return;
        }

        // FIX: Combine `cost` calculation into `Math.min` to save one stack slot.
        uint256 toDrain = Math.min((pol.coverage * rateBps * elapsed) / (SECS_YEAR * BPS), pol.premiumDeposit);
        if (toDrain < 1) {
            policyNFT.updatePremiumAccount(_policyId, pol.premiumDeposit, uint128(block.timestamp));
            return;
        }

        // FIX: Calculate new deposit directly in the update call to save another stack slot (`newDep`).
        policyNFT.updatePremiumAccount(_policyId, uint128(pol.premiumDeposit - toDrain), uint128(block.timestamp));

        uint256 catAmt  = (toDrain * catPremiumBps) / BPS;
        uint256 poolInc = toDrain - catAmt;

        if (catAmt > 0) {
            IERC20 underlying = capitalPool.underlyingAsset();
            underlying.forceApprove(address(catPool), catAmt);
            catPool.receiveUsdcPremium(catAmt);
        }

        if (poolInc > 0 && pledged > 0) {
            rewardDistributor.distribute(pol.poolId, address(capitalPool.underlyingAsset()), poolInc, pledged);
        }
    }

    function _resolvePendingIncrease(uint256 _policyId) internal {
        uint256 nodeId = pendingIncreaseListHead[_policyId];
        uint256 prev   = 0;
        uint256 finalized = 0;
        uint256 processed = 0;

        while (nodeId != 0 && processed < PROCESS_LIMIT) {
            PendingIncreaseNode storage node = _nodes[nodeId];
            uint256 nextId = node.nextNodeId;

            if (block.timestamp >= node.activationTimestamp) {
                finalized += node.amount;
                pendingCoverageSum[_policyId] -= node.amount;

                if (prev == 0) {
                    pendingIncreaseListHead[_policyId] = nextId;
                } else {
                    _nodes[prev].nextNodeId = nextId;
                }
                delete _nodes[nodeId];
            } else {
                prev = nodeId;
            }

            nodeId     = nextId;
            processed++;     
        }

        if (finalized > 0) {
            policyNFT.finalizeIncreases(_policyId, finalized);
        }
    }

    /* ───────────────────── View Functions ───────────────────── */

    function getPendingIncreases(uint256 policyId) external view returns (PendingIncreaseNode[] memory) {
        uint256 count = 0;
        uint256 nodeId = pendingIncreaseListHead[policyId];
        while (nodeId != 0 && count < PROCESS_LIMIT) {
            count++;
            nodeId = _nodes[nodeId].nextNodeId;
        }

        PendingIncreaseNode[] memory list = new PendingIncreaseNode[](count);
        nodeId = pendingIncreaseListHead[policyId];
        for (uint256 i = 0; i < count; i++) {
            list[i] = _nodes[nodeId];
            nodeId = _nodes[nodeId].nextNodeId;
        }
        return list;
    }
    
    /**
    * @dev FIX: This function is refactored to reduce local variables and avoid a potential "Stack too deep" error.
    */
    function isPolicyActive(uint256 policyId) public view returns (bool) {
        if (address(poolRegistry) == address(0)) return false;
        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(policyId);
        if (pol.coverage == 0) return false;
        if (block.timestamp <= pol.lastDrainTime) return pol.premiumDeposit > 0;

        ( , uint256 pledged, uint256 sold, uint256 pendingW, , , ) = poolRegistry.getPoolData(pol.poolId);

        uint256 rateBps;
        {
            uint256 availableCapital = pendingW >= pledged ? 0 : pledged - pendingW;
            IPoolRegistry.RateModel memory rateModel = poolRegistry.getPoolRateModel(pol.poolId);
            if (availableCapital == 0) {
                rateBps = rateModel.base + (rateModel.slope1 * rateModel.kink) / BPS + (rateModel.slope2 * (BPS - rateModel.kink)) / BPS;
            } else {
                uint256 utilBps = (sold * BPS) / availableCapital;
                if (utilBps < rateModel.kink) {
                    rateBps = rateModel.base + (sold * rateModel.slope1) / availableCapital;
                } else {
                    uint256 postKink = (sold * BPS) - (rateModel.kink * availableCapital);
                    rateBps = rateModel.base + (rateModel.slope1 * rateModel.kink) / BPS + ((rateModel.slope2 * postKink) / (availableCapital * BPS));
                }
            }
        }
        
        if (rateBps == 0) return pol.premiumDeposit > 0;

        uint256 elapsed = block.timestamp - pol.lastDrainTime;
        // FIX: Combine cost calculation and comparison to save a stack slot for `cost`.
        return pol.premiumDeposit > (pol.coverage * rateBps * elapsed) / (SECS_YEAR * BPS);
    }
}