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
import "../interfaces/IRiskManager_PM_Hook.sol";

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
    IRiskManager_PM_Hook public riskManager;
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
        address _registry,
        address _capital,
        address _cat,
        address _rewards,
        address _rm
    ) external onlyOwner {
        if (
            _registry == address(0) ||
            _capital  == address(0) ||
            _cat      == address(0) ||
            _rewards  == address(0) ||
            _rm       == address(0)
        ) revert AddressesNotSet();
        poolRegistry     = IPoolRegistry(_registry);
        capitalPool      = ICapitalPool(_capital);
        catPool          = IBackstopPool(_cat);
        rewardDistributor= IRewardDistributor(_rewards);
        riskManager      = IRiskManager_PM_Hook(_rm);
        emit AddressesSet(_registry, _capital, _rewards, _rm);
    }

    function setCatPool(address _catPool) external onlyOwner {
        if (_catPool == address(0)) revert AddressesNotSet();
        catPool = IBackstopPool(_catPool);
        emit CatPoolSet(_catPool);
    }

    function setCatPremiumShareBps(uint256 _newBps) external onlyOwner {
        if (_newBps > 5000) revert InvalidAmount();
        catPremiumBps = _newBps;
        emit CatPremiumShareSet(_newBps);
    }

    function setCoverCooldownPeriod(uint256 _newPeriod) external onlyOwner {
        coverCooldownPeriod = _newPeriod;
        emit CoverCooldownPeriodSet(_newPeriod);
    }

    /* ───────────────────── Policy Management ───────────────────── */

    function purchaseCover(
        uint256 _poolId,
        uint256 _coverageAmount,
        uint256 _initialPremiumDeposit
    ) external nonReentrant returns (uint256 policyId) {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();

        (
            IERC20 _pt,
            uint256 _pledged,
            uint256 sold,
            uint256 _pending,
            bool paused,
            address _feeR,
            uint256 _claimFee
        ) = poolRegistry.getPoolData(_poolId);
        // silence unused variable warnings
        (_pt, _pledged, _pending, _feeR, _claimFee);
        if (paused) revert PoolPaused();
        if (_coverageAmount == 0 || _initialPremiumDeposit == 0) revert InvalidAmount();
        if (_initialPremiumDeposit > type(uint128).max) revert InvalidAmount();

        uint256 cap = _getAvailableCapital(_poolId);
        if (sold + _coverageAmount > cap) revert InsufficientCapacity();

        uint256 rateBps = _getPremiumRateBpsAnnual(_poolId);
        uint256 minPrem = (_coverageAmount * rateBps * 7 days) / (SECS_YEAR * BPS);
        if (_initialPremiumDeposit < minPrem) revert DepositTooLow();

        capitalPool.underlyingAsset().safeTransferFrom(msg.sender, address(this), _initialPremiumDeposit);

        uint256 activateAt = block.timestamp + coverCooldownPeriod;
        policyId = policyNFT.mint(
          msg.sender,
          _poolId,
          _coverageAmount,
          activateAt,
          uint128(_initialPremiumDeposit),
          uint128(activateAt)
        );

        riskManager.updateCoverageSold(_poolId, _coverageAmount, true);
    }

    function increaseCover(uint256 _policyId, uint256 _additionalCoverage) external nonReentrant {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();
        if (_additionalCoverage == 0 || _additionalCoverage > type(uint128).max) revert InvalidAmount();
        if (policyNFT.ownerOf(_policyId) != msg.sender) revert NotPolicyOwner();

        _settleAndDrainPremium(_policyId);
        if (!isPolicyActive(_policyId)) revert PolicyNotActive();

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (pol.coverage == 0) revert PolicyAlreadyTerminated();

        (
            IERC20 _pt,
            uint256 _pledged,
            uint256 sold,
            uint256 _pending,
            bool _p,
            address _fr,
            uint256 _cf
        ) = poolRegistry.getPoolData(pol.poolId);
        (_pt, _pledged, _pending, _p, _fr, _cf);
        uint256 cap = _getAvailableCapital(pol.poolId);
        if (sold + _additionalCoverage > cap) revert InsufficientCapacity();

        uint256 newTotal = pol.coverage + pendingCoverageSum[_policyId] + _additionalCoverage;

        uint256 rateBps = _getPremiumRateBpsAnnual(pol.poolId);
        uint256 minPrem = (newTotal * rateBps * 7 days) / (SECS_YEAR * BPS);
        if (pol.premiumDeposit < minPrem) revert DepositTooLow();

        uint256 activateAt = block.timestamp + coverCooldownPeriod;
        uint256 nodeId     = _nextNodeId++;
        _nodes[nodeId]     = PendingIncreaseNode({
            amount: uint128(_additionalCoverage),
            activationTimestamp: uint128(activateAt),
            nextNodeId: pendingIncreaseListHead[_policyId]
        });
        pendingIncreaseListHead[_policyId] = nodeId;
        pendingCoverageSum[_policyId]     += _additionalCoverage;

        riskManager.updateCoverageSold(pol.poolId, _additionalCoverage, true);

        emit CoverIncreaseRequested(_policyId, _additionalCoverage, activateAt);
    }

    function cancelCover(uint256 _policyId) external nonReentrant {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();
        if (policyNFT.ownerOf(_policyId) != msg.sender) revert NotPolicyOwner();

        _settleAndDrainPremium(_policyId);
        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (pol.coverage == 0) revert PolicyAlreadyTerminated();
        if (block.timestamp < pol.activation) revert CooldownActive();

        uint256 refund = pol.premiumDeposit;
        
        // FIX: Store the sum *before* it's modified.
        uint256 pendingToCancel = pendingCoverageSum[_policyId];
        uint256 cleared = 0;
        uint256 nodeId = pendingIncreaseListHead[_policyId];

        // batch delete up to PROCESS_LIMIT
        while (nodeId != 0) {
            if (cleared >= PROCESS_LIMIT) revert TooManyPendingIncreases();
            uint256 nextId = _nodes[nodeId].nextNodeId;
            delete _nodes[nodeId]; // Simplified: removed redundant _burnNode
            nodeId = nextId;
            cleared++;
        }
        pendingIncreaseListHead[_policyId] = 0;
        pendingCoverageSum[_policyId] = 0;

        // FIX: Use the stored sum for an accurate calculation.
        uint256 totalToReduce = pol.coverage + pendingToCancel;
        if (totalToReduce > 0) {
            riskManager.updateCoverageSold(pol.poolId, totalToReduce, false);
        }

        policyNFT.burn(_policyId);
        if (refund > 0) {
            capitalPool.underlyingAsset().safeTransfer(msg.sender, refund);
        }
    }

    function lapsePolicy(uint256 _policyId) external nonReentrant {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();

        _settleAndDrainPremium(_policyId);
        if (isPolicyActive(_policyId)) revert PolicyIsActive();

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (pol.coverage == 0) revert PolicyAlreadyTerminated();
        
        // FIX: Store the sum *before* it's modified.
        uint256 pendingToCancel = pendingCoverageSum[_policyId];
        uint256 cleared = 0;
        uint256 nodeId = pendingIncreaseListHead[_policyId];

        while (nodeId != 0) {
            if (cleared >= PROCESS_LIMIT) revert TooManyPendingIncreases();
            uint256 nextId = _nodes[nodeId].nextNodeId;
            delete _nodes[nodeId]; // Simplified: removed redundant _burnNode
            nodeId = nextId;
            cleared++;
        }
        pendingIncreaseListHead[_policyId] = 0;
        pendingCoverageSum[_policyId] = 0;
        
        // FIX: Use the stored sum for an accurate calculation.
        uint256 totalToReduce = pol.coverage + pendingToCancel;
        if (totalToReduce > 0) {
            riskManager.updateCoverageSold(pol.poolId, totalToReduce, false);
        }

        policyNFT.burn(_policyId);
    }

    /* ───────────────── Internal Helpers ────────────────────────── */

    function _settleAndDrainPremium(uint256 _policyId) internal {
        _resolvePendingIncrease(_policyId);

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (block.timestamp <= pol.lastDrainTime) return;

        uint256 rateBps = _getPremiumRateBpsAnnual(pol.poolId);
        uint256 elapsed  = block.timestamp - pol.lastDrainTime;

        if (rateBps == 0) {
            policyNFT.updatePremiumAccount(_policyId, pol.premiumDeposit, uint128(block.timestamp));
            return;
        }

        uint256 cost      = (pol.coverage * rateBps * elapsed) / (SECS_YEAR * BPS);
        uint256 toDrain   = Math.min(cost, pol.premiumDeposit);
        if (toDrain == 0) {
            policyNFT.updatePremiumAccount(_policyId, pol.premiumDeposit, uint128(block.timestamp));
            return;
        }

        uint128 newDep = uint128(pol.premiumDeposit - toDrain);
        policyNFT.updatePremiumAccount(_policyId, newDep, uint128(block.timestamp));

        uint256 catAmt  = (toDrain * catPremiumBps) / BPS;
        uint256 poolInc = toDrain - catAmt;

        if (catAmt > 0) {
            IERC20 underlying = capitalPool.underlyingAsset();
            // approve safely for catastrophe pool
            underlying.forceApprove(address(catPool), catAmt);
            catPool.receiveUsdcPremium(catAmt);
        }

        (
            IERC20 _pt2,
            uint256 pledged,
            uint256 _sold2,
            uint256 _pending2,
            bool _pause2,
            address _fr2,
            uint256 _cf2
        ) = poolRegistry.getPoolData(pol.poolId);
        (_pt2, _sold2, _pending2, _pause2, _fr2, _cf2);
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
                // unlink
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

    function getPendingIncreases(uint256 _policyId) external view returns (PendingIncreaseNode[] memory) {
        // capped view to prevent RPC DoS
        PendingIncreaseNode[] memory list = new PendingIncreaseNode[](PROCESS_LIMIT);
        uint256 nodeId = pendingIncreaseListHead[_policyId];
        uint256 i = 0;
        while (nodeId != 0 && i < PROCESS_LIMIT) {
            list[i] = _nodes[nodeId];
            nodeId = _nodes[nodeId].nextNodeId;
            i++;
        }
        assembly { mstore(list, i) }
        return list;
    }

    function isPolicyActive(uint256 _policyId) public view returns (bool) {
        if (address(poolRegistry) == address(0)) return false;
        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (pol.coverage == 0) return false;
        if (block.timestamp <= pol.lastDrainTime) return pol.premiumDeposit > 0;

        uint256 rateBps = _getPremiumRateBpsAnnual(pol.poolId);
        if (rateBps == 0) return pol.premiumDeposit > 0;

        uint256 elapsed = block.timestamp - pol.lastDrainTime;
        uint256 cost    = (pol.coverage * rateBps * elapsed) / (SECS_YEAR * BPS);
        return pol.premiumDeposit > cost;
    }

    function _getPremiumRateBpsAnnual(uint256 _poolId) internal view returns (uint256) {
        (
            IERC20 _pt3,
            uint256 _pledged3,
            uint256 sold,
            uint256 _pend3,
            bool _paused3,
            address _fr3,
            uint256 _cf3
        ) = poolRegistry.getPoolData(_poolId);
        (_pt3, _pledged3, _pend3, _paused3, _fr3, _cf3);
        uint256 cap    = _getAvailableCapital(_poolId);
        IPoolRegistry.RateModel memory m = poolRegistry.getPoolRateModel(_poolId);
        if (cap == 0) {
            return m.base + (m.slope1 * m.kink) / BPS + (m.slope2 * (BPS - m.kink)) / BPS;
        }
        uint256 utilBps = (sold * BPS) / cap;
        if (utilBps < m.kink) {
            return m.base + (m.slope1 * utilBps) / BPS;
        }
        return m.base + (m.slope1 * m.kink) / BPS + (m.slope2 * (utilBps - m.kink)) / BPS;
    }

    function _getAvailableCapital(uint256 _poolId) internal view returns (uint256) {
        (
            IERC20 _pt4,
            uint256 pledged,
            uint256 _sold4,
            uint256 pendingW,
            bool _paused4,
            address _fr4,
            uint256 _cf4
        ) = poolRegistry.getPoolData(_poolId);
        (_pt4, _sold4, _paused4, _fr4, _cf4);
        return pendingW >= pledged ? 0 : pledged - pendingW;
    }
}