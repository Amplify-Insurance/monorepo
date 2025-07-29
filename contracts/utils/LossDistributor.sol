// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/ILossDistributor.sol";
import "../interfaces/IUnderwriterManager.sol";
import "../interfaces/ICapitalPool.sol";
import "../interfaces/IPoolRegistry.sol"; // + ADDED
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title LossDistributor
 * @author Gemini
 * @notice Manages the scalable accounting of losses for underwriters using the "pull-over-push" pattern.
 * @dev V2: Implements cross-pool loss distribution based on underwriter capital overlap.
 */
contract LossDistributor is ILossDistributor, Ownable {
    // --- Dependencies ---
    address public riskManager;
    IUnderwriterManager public underwriterManager;
    ICapitalPool        public capitalPool;
    IPoolRegistry       public poolRegistry; // + ADDED

    // --- Events ---
    event RiskManagerSet(address indexed newRiskManager);
    event UnderwriterManagerSet(address indexed newUnderwriterManager);
    event CapitalPoolSet(address indexed newCapitalPool);
    event PoolRegistrySet(address indexed newPoolRegistry); // + ADDED

    // --- Accounting Structs for the "Pull-over-Push" Pattern ---
    struct LossTracker {
        uint256 accumulatedSharesToBurnPerPledge;
    }

    struct UserLossState {
        uint256 historicalShareDebt;
        uint256 accumulatedSharesToBurnPerPledgeAtLastUpdate;
    }

    // --- State Variables ---
    mapping(uint256 => LossTracker)                         public poolLossTrackers;
    mapping(address => mapping(uint256 => UserLossState))   public userLossStates;
    uint256 public constant PRECISION_FACTOR = 1e18;

    /* ───────────────────── Modifiers & Errors ───────────────────── */
    modifier onlyRiskManager() {
        require(msg.sender == riskManager, "LD: Not RiskManager");
        _;
    }

    modifier onlyUnderwriterManager() {
        require(msg.sender == address(underwriterManager), "LD: Not UnderwriterManager");
        _;
    }

    error ZeroAddress();

    /* ─────────────────── Constructor & Configuration ─────────────────── */
    constructor(
        address _riskManager,
        address _underwriterManager,
        address _capitalPool,
        address _poolRegistry // + ADDED
    ) Ownable(msg.sender) {
        if (
            _riskManager         == address(0) ||
            _underwriterManager  == address(0) ||
            _capitalPool         == address(0) ||
            _poolRegistry        == address(0) // + ADDED
        ) revert ZeroAddress();

        riskManager        = _riskManager;
        underwriterManager = IUnderwriterManager(_underwriterManager);
        capitalPool        = ICapitalPool(_capitalPool);
        poolRegistry       = IPoolRegistry(_poolRegistry); // + ADDED
    }

    function setRiskManager(address newRiskManager) external onlyOwner {
        if (newRiskManager == address(0)) revert ZeroAddress();
        riskManager = newRiskManager;
        emit RiskManagerSet(newRiskManager);
    }

    function setUnderwriterManager(address newUnderwriterManager) external onlyOwner {
        if (newUnderwriterManager == address(0)) revert ZeroAddress();
        underwriterManager = IUnderwriterManager(newUnderwriterManager);
        emit UnderwriterManagerSet(newUnderwriterManager);
    }

    function setCapitalPool(address newCapitalPool) external onlyOwner {
        if (newCapitalPool == address(0)) revert ZeroAddress();
        capitalPool = ICapitalPool(newCapitalPool);
        emit CapitalPoolSet(newCapitalPool);
    }

    // + ADDED
    function setPoolRegistry(address newPoolRegistry) external onlyOwner {
        if (newPoolRegistry == address(0)) revert ZeroAddress();
        poolRegistry = IPoolRegistry(newPoolRegistry);
        emit PoolRegistrySet(newPoolRegistry);
    }

    /* ───────────────────────── Core Logic ───────────────────────── */

    /**
     * @notice Records a loss against a claiming pool and distributes it across all
     * correlated pools based on the capital overlap of their underwriters.
     * @dev This is the "push" part of the pattern, now with cross-pool logic.
     * @param claimPoolId The pool that suffered the initial loss.
     * @param lossAmount Amount of underlying asset lost.
     */
    function distributeLoss(
        uint256 claimPoolId,
        uint256 lossAmount
    ) external override onlyRiskManager {
        if (lossAmount == 0) return;

        // Total capital in the claiming pool. This is the denominator for the loss ratio.
        // We get it from the diagonal of the exposure matrix for consistency.
        uint256 totalCapitalInClaimPool = underwriterManager.overlapExposure(claimPoolId, claimPoolId);
        if (totalCapitalInClaimPool == 0) return;

        uint256 poolCount = poolRegistry.getPoolCount();

        // For every other pool `P`, calculate its share of the loss from `C`.
        for (uint256 p = 0; p < poolCount; p++) {
            // How much capital in pool `p` is from underwriters who also backed `claimPoolId`?
            uint256 overlap = underwriterManager.overlapExposure(claimPoolId, p);
            if (overlap == 0) continue;

            // Loss allocated to pool `p` = Δ * (Overlap[C][P] / TotalCapital[C])
            uint256 lossForPoolP = Math.mulDiv(lossAmount, overlap, totalCapitalInClaimPool);
            if (lossForPoolP == 0) continue;

            // Total capital in the affected pool `P`. This is the denominator for distributing the loss
            // among the underwriters of pool `P`.
            uint256 totalCapitalInPoolP = underwriterManager.overlapExposure(p, p);
            if (totalCapitalInPoolP == 0) continue;

            // Convert the asset loss for pool `P` into CapitalPool shares to be burned.
            uint256 sharesToBurn = capitalPool.valueToShares(lossForPoolP);
            if (sharesToBurn == 0) continue;

            // Update pool P's loss tracker. This increases the per-pledge debt for all of its underwriters.
            poolLossTrackers[p].accumulatedSharesToBurnPerPledge +=
                (sharesToBurn * PRECISION_FACTOR) / totalCapitalInPoolP;
        }
    }
    
    /**
     * @notice Snapshot a user's pending share debt before their pledge changes.
     * @dev Called by UnderwriterManager *before* updating userPledge.
     */
    function recordPledgeUpdate(address user, uint256 poolId)
        external
        override
        onlyUnderwriterManager
    {
        LossTracker   storage tracker   = poolLossTrackers[poolId];
        UserLossState storage userState = userLossStates[user][poolId];

        uint256 currentPledge = underwriterManager.underwriterPoolPledge(user, poolId);

        uint256 deltaRatio = tracker.accumulatedSharesToBurnPerPledge
                           - userState.accumulatedSharesToBurnPerPledgeAtLastUpdate;

        if (deltaRatio > 0 && currentPledge > 0) {
            uint256 newDebt = (currentPledge * deltaRatio) / PRECISION_FACTOR;
            userState.historicalShareDebt += newDebt;
        }

        userState.accumulatedSharesToBurnPerPledgeAtLastUpdate =
            tracker.accumulatedSharesToBurnPerPledge;
    }

    /**
     * @notice Realize (burn) a user's aggregate pending share debt.
     * @param user              The underwriter whose debt to settle.
     * @param totalSharesToBurn Total shares owed across all pools.
     * @param poolIds           The list of pools used to snapshot post‑burn state.
     */
    function realizeAggregateLoss(
        address user,
        uint256 totalSharesToBurn,
        uint256[] calldata poolIds
    ) external override onlyUnderwriterManager {
        if (totalSharesToBurn == 0) return;

        (, , uint256 userMasterShares, ) = capitalPool.getUnderwriterAccount(user);

        uint256 burnable = Math.min(totalSharesToBurn, userMasterShares);
        if (burnable > 0) {
            capitalPool.burnSharesForLoss(user, burnable);
        }

        for (uint256 i = 0; i < poolIds.length; i++) {
            uint256 pid = poolIds[i];
            userLossStates[user][pid].historicalShareDebt = 0;
            userLossStates[user][pid]
                .accumulatedSharesToBurnPerPledgeAtLastUpdate =
                poolLossTrackers[pid].accumulatedSharesToBurnPerPledge;
        }
    }

    /* ───────────────────────── View Functions ───────────────────────── */
    function getPendingLosses(
        address user,
        uint256 poolId,
        uint256 userPledge
    ) public view override returns (uint256 pendingSharesToBurn) {
        UserLossState storage us = userLossStates[user][poolId];
        LossTracker   storage lt = poolLossTrackers[poolId];

        uint256 deltaRatio = lt.accumulatedSharesToBurnPerPledge
                           - us.accumulatedSharesToBurnPerPledgeAtLastUpdate;

        uint256 liveDebt = 0;
        if (deltaRatio > 0 && userPledge > 0) {
            liveDebt = (userPledge * deltaRatio) / PRECISION_FACTOR;
        }

        return us.historicalShareDebt + liveDebt;
    }
}