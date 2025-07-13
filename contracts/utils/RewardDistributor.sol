// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IRewardDistributor.sol";

/**
 * @title RewardDistributor
 * @author Gemini
 * @notice Manages the scalable distribution of rewards to underwriters using the "pull-over-push" pattern.
 * This avoids gas-intensive loops by tracking rewards on a per-share basis.
 */
contract RewardDistributor is IRewardDistributor, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public riskManager;
    address public policyManager;
    address public catPool;

    event CatPoolSet(address indexed newCatPool);
    event RiskManagerAddressSet(address indexed newRiskManager);
    event PolicyManagerAddressSet(address indexed newPolicyManager);

    // --- Accounting Structs ---
    struct RewardTracker {
        // Total accumulated rewards for a token in a pool, divided by the total pledge at the time of distribution.
        // This value is stored with high precision to minimize rounding errors.
        uint256 accumulatedRewardsPerShare;
    }

    struct UserRewardState {
        // The reward-per-share value at the time of the user's last interaction (deposit, withdrawal, or claim).
        // Used to calculate how many new rewards they've earned since.
        uint256 rewardDebt;
    }

    // --- State Variables ---
    // poolId => rewardTokenAddress => RewardTracker
    mapping(uint256 => mapping(address => RewardTracker)) public poolRewardTrackers;

    // userAddress => poolId => rewardTokenAddress => UserRewardState
    mapping(address => mapping(uint256 => mapping(address => UserRewardState))) public userRewardStates;
    
    uint256 public constant PRECISION_FACTOR = 1e18;

    /* ───────────────────────── Modifiers & Errors ──────────────────────── */
    modifier onlyRiskManager() {
        require(msg.sender == riskManager, "RD: Not RiskManager");
        _;
    }


    modifier onlyApproved() {
        require(msg.sender == riskManager || msg.sender == policyManager, "RD: Not RiskManager or policyManager");
        _;
    }

    modifier onlyCatPool() {
        require(msg.sender == catPool, "RD: Not CatPool");
        _;
    }

    error ZeroAddress();

    /* ───────────────────────── Constructor & Setup ──────────────────────── */

    constructor(address _riskManagerAddress, address _policyManagerAddress) Ownable(msg.sender) {
        if (_riskManagerAddress == address(0)) revert ZeroAddress();
        if (_policyManagerAddress == address(0)) revert ZeroAddress();
       
        policyManager = _policyManagerAddress;
        riskManager = _riskManagerAddress;
        emit RiskManagerAddressSet(_riskManagerAddress);
        emit PolicyManagerAddressSet(_policyManagerAddress);
    }

    function setCatPool(address catPoolAddress) external onlyOwner {
        if (catPoolAddress == address(0)) revert ZeroAddress();
        catPool = catPoolAddress;
        emit CatPoolSet(catPoolAddress);
    }

    function setRiskManager(address newRiskManager) external onlyOwner {
        if (newRiskManager == address(0)) revert ZeroAddress();
        riskManager = newRiskManager;
        emit RiskManagerAddressSet(newRiskManager);
    }

    function setPolicyManager(address newPolicyManager) external onlyOwner {
        if (newPolicyManager == address(0)) revert ZeroAddress();
        policyManager = newPolicyManager;
        emit PolicyManagerAddressSet(newPolicyManager);
    }

    /* ───────────────────────── Core Logic ──────────────────────── */

    /**
     * @notice Distributes a new batch of rewards by updating the pool's rewards-per-share metric.
     * @dev Called by the RiskManager when premiums or fees are to be distributed.
     * @param poolId The ID of the pool receiving rewards.
     * @param rewardToken The address of the token being distributed.
     * @param rewardAmount The total amount of the reward to distribute.
     * @param totalPledgeInPool The total capital pledged to the pool at this moment.
     */
    function distribute(uint256 poolId, address rewardToken, uint256 rewardAmount, uint256 totalPledgeInPool) external override onlyApproved {
        if (rewardAmount == 0 || totalPledgeInPool == 0) {
            return;
        }
        RewardTracker storage tracker = poolRewardTrackers[poolId][rewardToken];
        tracker.accumulatedRewardsPerShare += (rewardAmount * PRECISION_FACTOR) / totalPledgeInPool;
    }

    /**
     * @notice Allows a user to claim their pending rewards for a specific token in a pool.
     * @dev Called by the RiskManager on behalf of a user.
     * @param user The user for whom to claim rewards.
     * @param poolId The pool to claim from.
     * @param rewardToken The reward token to claim.
     * @param userPledge The user's current capital pledge.
     * @return The amount of rewards claimed.
     */
    function claim(address user, uint256 poolId, address rewardToken, uint256 userPledge) external override onlyRiskManager nonReentrant returns (uint256) {
        uint256 rewards = pendingRewards(user, poolId, rewardToken, userPledge);
        
        if (rewards > 0) {
            UserRewardState storage userState = userRewardStates[user][poolId][rewardToken];
            RewardTracker storage tracker = poolRewardTrackers[poolId][rewardToken];
            userState.rewardDebt = (userPledge * tracker.accumulatedRewardsPerShare) / PRECISION_FACTOR;
            
            IERC20(rewardToken).safeTransfer(user, rewards);
        }
        return rewards;
    }

    function claimForCatPool(address user, uint256 poolId, address rewardToken, uint256 userPledge) external override onlyCatPool nonReentrant returns (uint256) {
        uint256 rewards = pendingRewards(user, poolId, rewardToken, userPledge);
        if (rewards > 0) {
            UserRewardState storage userState = userRewardStates[user][poolId][rewardToken];
            RewardTracker storage tracker = poolRewardTrackers[poolId][rewardToken];
            userState.rewardDebt = (userPledge * tracker.accumulatedRewardsPerShare) / PRECISION_FACTOR;
            IERC20(rewardToken).safeTransfer(user, rewards);
        }
        return rewards;
    }

    /**
     * @notice Updates a user's state, typically after they deposit or withdraw.
     * @dev This "snapshots" their debt so future reward calculations are correct.
     * @param user The user whose state is being updated.
     * @param poolId The relevant pool ID.
     * @param rewardToken The relevant reward token.
     * @param userPledge The user's new capital pledge amount.
     */
    function updateUserState(address user, uint256 poolId, address rewardToken, uint256 userPledge) external override onlyRiskManager {
        RewardTracker storage tracker = poolRewardTrackers[poolId][rewardToken];
        UserRewardState storage userState = userRewardStates[user][poolId][rewardToken];
        userState.rewardDebt = (userPledge * tracker.accumulatedRewardsPerShare) / PRECISION_FACTOR;
    }

    /* ───────────────────────── View Functions ──────────────────────── */
    
    /**
     * @notice Calculates the pending rewards for a user for a specific token in a pool.
     * @param user The user's address.
     * @param poolId The pool ID.
     * @param rewardToken The reward token address.
     * @param userPledge The user's current capital pledge.
     * @return The amount of claimable rewards.
     */
    function pendingRewards(address user, uint256 poolId, address rewardToken, uint256 userPledge) public view override returns (uint256) {
        RewardTracker storage tracker = poolRewardTrackers[poolId][rewardToken];
        UserRewardState storage userState = userRewardStates[user][poolId][rewardToken];

        uint256 accumulated = (userPledge * tracker.accumulatedRewardsPerShare) / PRECISION_FACTOR;
        return accumulated - userState.rewardDebt;
    }
}