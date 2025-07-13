// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/ILossDistributor.sol";

/**
 * @title LossDistributor
 * @author Gemini
 * @notice Manages the scalable accounting of losses for underwriters using the "pull-over-push" pattern.
 * This avoids gas-intensive loops by tracking losses on a per-share basis and realizing them on demand.
 */
contract LossDistributor is ILossDistributor, Ownable {
    address public riskManager;

    event RiskManagerAddressSet(address indexed newRiskManager);

    // --- Accounting Structs ---
    struct LossTracker {
        // Total accumulated losses for a pool, divided by the total pledge at the time of distribution.
        // This value is stored with high precision to minimize rounding errors.
        uint256 accumulatedLossPerShare;
    }

    struct UserLossState {
        // The loss-per-share value at the time of the user's last interaction.
        // Used to calculate how many new losses they've incurred since.
        uint256 lossDebt;
    }

    // --- State Variables ---
    // poolId => LossTracker
    mapping(uint256 => LossTracker) public poolLossTrackers;

    // userAddress => poolId => UserLossState
    mapping(address => mapping(uint256 => UserLossState)) public userLossStates;
    
    uint256 public constant PRECISION_FACTOR = 1e18;

    /* ───────────────────────── Modifiers & Errors ──────────────────────── */
    modifier onlyRiskManager() {
        require(msg.sender == riskManager, "LD: Not RiskManager");
        _;
    }

    error ZeroAddress();

    /* ───────────────────────── Constructor & Setup ──────────────────────── */

    constructor(address _riskManagerAddress) Ownable(msg.sender) {
        if (_riskManagerAddress == address(0)) revert ZeroAddress();
        riskManager = _riskManagerAddress;
    }

    function setRiskManager(address newRiskManager) external onlyOwner {
        if (newRiskManager == address(0)) revert ZeroAddress();
        riskManager = newRiskManager;
        emit RiskManagerAddressSet(newRiskManager);
    }

    /* ───────────────────────── Core Logic ──────────────────────── */

    /**
     * @notice Records a new loss by updating the pool's loss-per-share metric.
     * @dev Called by the RiskManager when a claim is processed.
     * @param poolId The ID of the pool where the loss occurred.
     * @param lossAmount The total amount of the loss to distribute.
     * @param totalPledgeInPool The total capital pledged to the pool at this moment.
     */
    function distributeLoss(uint256 poolId, uint256 lossAmount, uint256 totalPledgeInPool) external override onlyRiskManager {
        if (lossAmount == 0 || totalPledgeInPool == 0) {
            return;
        }
        LossTracker storage tracker = poolLossTrackers[poolId];
        tracker.accumulatedLossPerShare += (lossAmount * PRECISION_FACTOR) / totalPledgeInPool;
    }

    /**
     * @notice Calculates a user's pending, unrealized losses and updates their debt.
     * @dev This is called by the RiskManager before an action like a withdrawal to ensure
     * the user's capital is correctly reduced first.
     * @param user The user for whom to realize losses.
     * @param poolId The pool to realize losses from.
     * @param userPledge The user's current capital pledge.
     * @return The amount of loss to be applied to the user's principal.
     */
    function realizeLosses(address user, uint256 poolId, uint256 userPledge) external override onlyRiskManager returns (uint256) {
        uint256 pending = getPendingLosses(user, poolId, userPledge);
        
        if (pending > 0) {
            UserLossState storage userState = userLossStates[user][poolId];
            LossTracker storage tracker = poolLossTrackers[poolId];
            userState.lossDebt = (userPledge * tracker.accumulatedLossPerShare) / PRECISION_FACTOR;
        }
        return pending;
    }

    /* ───────────────────────── View Functions ──────────────────────── */
    
    /**
     * @notice Calculates the pending, unrealized losses for a user in a specific pool.
     * @param user The user's address.
     * @param poolId The pool ID.
     * @param userPledge The user's current capital pledge.
     * @return The amount of unrealized losses.
     */
    function getPendingLosses(address user, uint256 poolId, uint256 userPledge) public view override returns (uint256) {
        LossTracker storage tracker = poolLossTrackers[poolId];
        UserLossState storage userState = userLossStates[user][poolId];

        uint256 totalLossIncurred = (userPledge * tracker.accumulatedLossPerShare) / PRECISION_FACTOR;
        return totalLossIncurred - userState.lossDebt;
    }
}