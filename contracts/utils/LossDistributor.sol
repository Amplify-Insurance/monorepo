// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/ILossDistributor.sol";
import "../interfaces/IUnderwriterManager.sol";
import "../interfaces/ICapitalPool.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title LossDistributor
 * @author Gemini
 * @notice Manages the scalable accounting of losses for underwriters using the "pull-over-push" pattern.
 * @dev CORRECTED: The contract now accounts for losses in terms of CapitalPool shares, not asset value.
 * This ensures that loss calculations are consistent with the pool's state at the moment a loss occurs.
 */
contract LossDistributor is ILossDistributor, Ownable {
    // --- Dependencies ---
    address public riskManager;
    IUnderwriterManager public underwriterManager;
    ICapitalPool public capitalPool;

    // --- Events ---
    event RiskManagerSet(address indexed newRiskManager);
    event UnderwriterManagerSet(address indexed newUnderwriterManager);
    event CapitalPoolSet(address indexed newCapitalPool);

    // --- Accounting Structs for the "Pull-over-Push" Pattern ---
    struct LossTracker {
        // Total accumulated shares to be burned for a pool, per unit of pledge, stored with high precision.
        uint256 accumulatedSharesToBurnPerPledge;
    }

    // --- FIX: Updated UserLossState to track historical debt ---
    struct UserLossState {
        // Share debt that was crystallized during previous pledge updates.
        uint256 historicalShareDebt;
        // A snapshot of the pool's loss ratio at the user's last pledge update.
        uint256 accumulatedSharesToBurnPerPledgeAtLastUpdate;
    }

    // --- State Variables ---
    mapping(uint256 => LossTracker) public poolLossTrackers;
    mapping(address => mapping(uint256 => UserLossState)) public userLossStates;
    
    uint256 public constant PRECISION_FACTOR = 1e18;

    /* ───────────────────────── Modifiers & Errors ──────────────────────── */
    modifier onlyRiskManager() {
        require(msg.sender == riskManager, "LD: Not RiskManager");
        _;
    }

    modifier onlyUnderwriterManager() {
        require(msg.sender == address(underwriterManager), "LD: Not UnderwriterManager");
        _;
    }

    error ZeroAddress();

    /* ───────────────────────── Constructor & Setup ──────────────────────── */

    constructor(
        address _riskManager,
        address _underwriterManager,
        address _capitalPool
    ) Ownable(msg.sender) {
        if (_riskManager == address(0) || _underwriterManager == address(0) || _capitalPool == address(0)) {
            revert ZeroAddress();
        }
        riskManager = _riskManager;
        underwriterManager = IUnderwriterManager(_underwriterManager);
        capitalPool = ICapitalPool(_capitalPool);
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

    /* ───────────────────────── Core Logic ──────────────────────── */

    function distributeLoss(
        uint256 poolId,
        uint256 lossAmount,
        uint256 totalPledgeInPool
    ) external override onlyRiskManager {
        if (lossAmount == 0 || totalPledgeInPool == 0) return;
        uint256 sharesToBurn = capitalPool.valueToShares(lossAmount);
        if (sharesToBurn == 0) return;
        poolLossTrackers[poolId].accumulatedSharesToBurnPerPledge += (sharesToBurn * PRECISION_FACTOR) / totalPledgeInPool;
    }
    
    // --- FIX: Implemented logic to handle pledge updates ---
    /**
     * @notice Snapshots a user's current loss state before their pledge is updated.
     * @dev Called by UnderwriterManager *before* a user's pledge is changed.
     * This crystallizes any pending losses and sets a new baseline for future loss calculations.
     */
    function recordPledgeUpdate(address user, uint256 poolId) external override onlyUnderwriterManager {
        LossTracker storage tracker = poolLossTrackers[poolId];
        UserLossState storage userState = userLossStates[user][poolId];
        uint256 currentPledge = underwriterManager.underwriterPoolPledge(user, poolId);

        // Calculate the "live" share debt accrued since the last update
        uint256 lossRatioDelta = tracker.accumulatedSharesToBurnPerPledge - userState.accumulatedSharesToBurnPerPledgeAtLastUpdate;
        if (lossRatioDelta > 0 && currentPledge > 0) {
            uint256 newShareDebt = (currentPledge * lossRatioDelta) / PRECISION_FACTOR;
            // Add the newly calculated debt to the historical total
            userState.historicalShareDebt += newShareDebt;
        }

        // Snapshot the current pool loss ratio as the new baseline for this user
        userState.accumulatedSharesToBurnPerPledgeAtLastUpdate = tracker.accumulatedSharesToBurnPerPledge;
    }

    function realizeAggregateLoss(
        address user,
        uint256 totalSharesToBurn,
        uint256[] calldata poolIds
    ) external override onlyUnderwriterManager {
        if (totalSharesToBurn == 0) return;

        (,, uint256 userMasterShares,) = capitalPool.getUnderwriterAccount(user);
        uint256 clampedSharesToBurn = Math.min(totalSharesToBurn, userMasterShares);

        if (clampedSharesToBurn > 0) {
            capitalPool.burnSharesForLoss(user, clampedSharesToBurn);
        }

        // --- FIX: Reset user's debt state after it has been settled ---
        // After burning shares, clear the historical debt and update the snapshot.
        for (uint i = 0; i < poolIds.length; i++) {
            uint256 poolId = poolIds[i];
            userLossStates[user][poolId].historicalShareDebt = 0;
            userLossStates[user][poolId].accumulatedSharesToBurnPerPledgeAtLastUpdate = poolLossTrackers[poolId].accumulatedSharesToBurnPerPledge;
        }
    }

    /* ───────────────────────── View Functions ──────────────────────── */
    
    // --- FIX: Updated logic to calculate total pending losses ---
    /**
     * @notice Calculates a user's total pending share debt for a specific pool.
     * @dev It sums the crystallized historical debt with the "live" debt accrued since the last update.
     * @return pendingSharesToBurn The total number of shares the user owes.
     */
    function getPendingLosses(
        address user,
        uint256 poolId,
        uint256 userPledge
    ) public view override returns (uint256 pendingSharesToBurn) {
        UserLossState storage userState = userLossStates[user][poolId];
        LossTracker storage tracker = poolLossTrackers[poolId];

        // Calculate the "live" share debt accrued since the last update
        uint256 lossRatioDelta = tracker.accumulatedSharesToBurnPerPledge - userState.accumulatedSharesToBurnPerPledgeAtLastUpdate;
        uint256 liveShareDebt = 0;
        if (lossRatioDelta > 0 && userPledge > 0) {
            liveShareDebt = (userPledge * lossRatioDelta) / PRECISION_FACTOR;
        }

        // Total pending loss is the sum of historical and live debt
        return userState.historicalShareDebt + liveShareDebt;
    }
}