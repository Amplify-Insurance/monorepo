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
 * @dev This avoids gas-intensive loops by tracking losses on a per-share basis and realizing them on demand.
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
        // Total accumulated losses for a pool, per unit of pledge, stored with high precision.
        uint256 accumulatedLossPerPledge;
    }

    struct UserLossState {
        // The total loss the user has already realized and "paid" for.
        uint256 lossDebt;
        uint256 accumulatedLossPerPledgeAtLastUpdate;

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

    /**
     * @notice Records a new loss by updating the pool's loss-per-pledge metric.
     * @dev This is now a highly scalable O(1) operation.
     */
    function distributeLoss(
        uint256 poolId,
        uint256 lossAmount,
        uint256 totalPledgeInPool
    ) external override onlyRiskManager {
        if (lossAmount == 0 || totalPledgeInPool == 0) {
            return;
        }
        LossTracker storage tracker = poolLossTrackers[poolId];
        tracker.accumulatedLossPerPledge += (lossAmount * PRECISION_FACTOR) / totalPledgeInPool;
    }

    /**
     * @notice Realizes a user's total aggregated losses from multiple pools at once.
     * @dev This function is called by the UnderwriterManager after it has summed up
     * the pending losses from all of a user's leveraged positions.
     */
    function realizeAggregateLoss(
        address user,
        uint256 totalLossValue,
        uint256[] calldata poolIds
    ) external override onlyUnderwriterManager {
        if (totalLossValue == 0) return;

        // 1. Convert the single, total loss value into a number of shares to burn.
        uint256 sharesToBurn = totalLossValue; // capitalPool.valueToShares(totalLossValue);

        if (sharesToBurn > 0) {
            // Get the user's actual, current share balance to ensure we don't burn more than they have.
            (,, uint256 userMasterShares,) = capitalPool.getUnderwriterAccount(user);
            uint256 clampedSharesToBurn = Math.min(sharesToBurn, userMasterShares);

            if (clampedSharesToBurn > 0) {
                // 2. Perform the SINGLE, simplified burn operation on the CapitalPool.
                capitalPool.burnSharesForLoss(user, clampedSharesToBurn);
            }
        }

        // 3. Loop through the user's covered pools to update their loss debt,
        //    ensuring their accounting is fully settled.
        for (uint i = 0; i < poolIds.length; i++) {
            uint256 poolId = poolIds[i];
            LossTracker storage tracker = poolLossTrackers[poolId];
            UserLossState storage userState = userLossStates[user][poolId];
            uint256 userPledge = underwriterManager.underwriterPoolPledge(user, poolId);
            
            if (userPledge > 0) {
                userState.lossDebt = (userPledge * tracker.accumulatedLossPerPledge) / PRECISION_FACTOR;
            }
        }
    }

    /* ───────────────────────── View Functions ──────────────────────── */
    
    /**
     * @notice Calculates the pending, unrealized losses for a user in a specific pool.
     */
    function getPendingLosses(
        address user,
        uint256 poolId,
        uint256 userPledge
    ) public view override returns (uint256) {
        LossTracker storage tracker = poolLossTrackers[poolId];
        UserLossState storage userState = userLossStates[user][poolId];

        uint256 totalLossIncurred = (userPledge * tracker.accumulatedLossPerPledge) / PRECISION_FACTOR;
        
        // Ensure we don't return a negative number due to rounding
        if (totalLossIncurred <= userState.lossDebt) {
            return 0;
        }
        
        return totalLossIncurred - userState.lossDebt;
    }

    // In LossDistributor.sol

/**
 * @notice Snapshots the current pool loss state for a user.
 * @dev Called by UnderwriterManager when a user's pledge is changed.
 * This sets a new baseline for calculating prospective losses.
 */
function recordPledgeUpdate(
    address user,
    uint256 poolId
) external override onlyUnderwriterManager {
    userLossStates[user][poolId].accumulatedLossPerPledgeAtLastUpdate = poolLossTrackers[poolId].accumulatedLossPerPledge;
}


    // In LossDistributor.sol

/**
 * @notice Calculates only the new losses a user is exposed to since their last pledge update.
 * @dev This provides an intuitive view of losses, ignoring historical losses
 * that occurred before the user's capital was pledged.
 * @return The amount of new, unrealized loss affecting the user.
 */
function getProspectiveLosses(
    address user,
    uint256 poolId,
    uint256 userPledge
) public view returns (uint256) {
    LossTracker storage tracker = poolLossTrackers[poolId];
    UserLossState storage userState = userLossStates[user][poolId];

    uint256 currentLossPerPledge = tracker.accumulatedLossPerPledge;
    uint256 lossPerPledgeAtUpdate = userState.accumulatedLossPerPledgeAtLastUpdate;

    // If the pool's current loss ratio is less than or equal to the user's snapshot,
    // it means no new losses have occurred that affect them.
    if (currentLossPerPledge <= lossPerPledgeAtUpdate) {
        return 0;
    }

    // Calculate the increase in loss-per-pledge since the user's last update.
    uint256 deltaLossPerPledge = currentLossPerPledge - lossPerPledgeAtUpdate;

    // The prospective loss is their current pledge multiplied by the new loss ratio.
    return (userPledge * deltaLossPerPledge) / PRECISION_FACTOR;
}
}