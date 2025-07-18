// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IRewardDistributor.sol";
import "../interfaces/IPoolRegistry.sol";
import "../interfaces/IUnderwriterManager.sol";
import "../interfaces/ICapitalPool.sol";


/**
 * @title RewardDistributor
 * @author Gemini
 * @notice Manages the scalable distribution of rewards to underwriters using the "pull-over-push" pattern.
 * @dev Access control has been updated to support multiple, isolated reward streams.
 */
contract RewardDistributor is IRewardDistributor, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- System Contracts ---
    IPoolRegistry public poolRegistry;
    address public policyManager;
    address public capitalPool;
    address public underwriterManager;
    address public catPool;
    address public riskManager;

    // --- Events ---
    event PoolRegistrySet(address indexed newPoolRegistry);
    event PolicyManagerSet(address indexed newPolicyManager);
    event CapitalPoolSet(address indexed newCapitalPool);
    event UnderwriterManagerSet(address indexed newUnderwriterManager);
    event CatPoolSet(address indexed newCatPool);
    event RiskManagerSet(address indexed newCatPool);

    // --- Accounting Structs ---
    struct RewardTracker {
        uint256 accumulatedRewardsPerShare;
    }

    struct UserRewardState {
        uint256 rewardDebt;
    }

    // --- State Variables ---
    mapping(uint256 => mapping(address => RewardTracker)) public poolRewardTrackers;
    mapping(address => mapping(uint256 => mapping(address => UserRewardState))) public userRewardStates;
    
    uint256 public constant PRECISION_FACTOR = 1e18;

    /* ───────────────────────── Modifiers & Errors ──────────────────────── */
    modifier onlyDistributors() {
        require(msg.sender == policyManager || msg.sender == capitalPool ||  msg.sender == riskManager  ||  msg.sender == catPool , "RD: Not an authorized distributor");
        _;
    }
    
    modifier onlyUnderwriterManager() {
        require(msg.sender == underwriterManager, "RD: Not UnderwriterManager");
        _;
    }

    modifier onlyStateUpdaters() {
        require(msg.sender == capitalPool || msg.sender == underwriterManager, "RD: Not CapitalPool or UnderwriterManager");
        _;
    }

    modifier onlyCatPool() {
        require(msg.sender == catPool, "RD: Not CatPool");
        _;
    }

    error ZeroAddress();

    /* ───────────────────────── Constructor & Setup ──────────────────────── */

    constructor(
        address _poolRegistry,
        address _policyManager,
        address _capitalPool,
        address _underwriterManager,
        address _riskManager

    ) Ownable(msg.sender) {
        if (_poolRegistry == address(0) || _policyManager == address(0) || _capitalPool == address(0) || _underwriterManager == address(0)) {
            revert ZeroAddress();
        }
        poolRegistry = IPoolRegistry(_poolRegistry);
        policyManager = _policyManager;
        capitalPool = _capitalPool;
        underwriterManager = _underwriterManager;
        riskManager = _riskManager;

    }

    function setPoolRegistry(address newPoolRegistry) external onlyOwner {
        if (newPoolRegistry == address(0)) revert ZeroAddress();
        poolRegistry = IPoolRegistry(newPoolRegistry);
        emit PoolRegistrySet(newPoolRegistry);
    }

    function setPolicyManager(address newPolicyManager) external onlyOwner {
        if (newPolicyManager == address(0)) revert ZeroAddress();
        policyManager = newPolicyManager;
        emit PolicyManagerSet(newPolicyManager);
    }

    function setCapitalPool(address newCapitalPool) external onlyOwner {
        if (newCapitalPool == address(0)) revert ZeroAddress();
        capitalPool = newCapitalPool;
        emit CapitalPoolSet(newCapitalPool);
    }

    function setRiskManager(address newRiskManager) external onlyOwner {
        if (newRiskManager == address(0)) revert ZeroAddress();
        riskManager = newRiskManager;
        emit RiskManagerSet(newRiskManager);
    }

    function setUnderwriterManager(address newUnderwriterManager) external onlyOwner {
        if (newUnderwriterManager == address(0)) revert ZeroAddress();
        underwriterManager = newUnderwriterManager;
        emit UnderwriterManagerSet(newUnderwriterManager);
    }

    function setCatPool(address newCatPool) external onlyOwner {
        if (newCatPool == address(0)) revert ZeroAddress();
        catPool = newCatPool;
        emit CatPoolSet(newCatPool);
    }

    /* ───────────────────────── Core Logic ──────────────────────── */

    function distribute(
        uint256 poolId,
        address rewardToken,
        uint256 rewardAmount,
        uint256 totalPledgeInPool
    ) external override onlyDistributors {
        if (rewardAmount == 0 || totalPledgeInPool == 0) {
            return;
        }
        RewardTracker storage tracker = poolRewardTrackers[poolId][rewardToken];
        tracker.accumulatedRewardsPerShare += (rewardAmount * PRECISION_FACTOR) / totalPledgeInPool;
    }

    function claim(
        address user,
        uint256 poolId,
        address rewardToken,
        uint256 userPledge
    ) external override onlyUnderwriterManager nonReentrant returns (uint256) {
        uint256 rewards = pendingRewards(user, poolId, rewardToken, userPledge);
        
        if (rewards > 0) {
            UserRewardState storage userState = userRewardStates[user][poolId][rewardToken];
            RewardTracker storage tracker = poolRewardTrackers[poolId][rewardToken];
            userState.rewardDebt = (userPledge * tracker.accumulatedRewardsPerShare) / PRECISION_FACTOR;
            
            IERC20(rewardToken).safeTransfer(user, rewards);
        }
        return rewards;
    }

    function claimForCatPool(
        address user,
        uint256 poolId,
        address rewardToken,
        uint256 userPledge
    ) external override onlyCatPool nonReentrant returns (uint256) {
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
     * @dev FIX: This function NO LONGER transfers tokens. It only updates the user's
     * reward debt. This prevents a potential cross-contract reentrancy attack.
     * Users must now explicitly call `claim` to receive their rewards.
     */
    function updateUserState(
        address user,
        uint256 poolId,
        address rewardToken,
        uint256 newUserPledge
    ) external override onlyStateUpdaters {
        // 1. Get the user's OLD pledge before the state change.
        uint256 oldPledge = userPledgeFor(user, poolId);

        // 2. Calculate pending rewards based on the OLD pledge.
        uint256 rewards = pendingRewards(user, poolId, rewardToken, oldPledge);

        // 3. Update the user's debt based on the NEW pledge.
        // The total accumulated rewards for the user is their old debt + new pending rewards.
        RewardTracker storage tracker = poolRewardTrackers[poolId][rewardToken];
        UserRewardState storage userState = userRewardStates[user][poolId][rewardToken];
        uint256 newTotalRewardsEarned = userState.rewardDebt + rewards;
        
        // Calculate what the new debt *should* be based on the new pledge, and adjust.
        // This ensures that if the user's pledge changes, their debt reflects what they've
        // already earned, plus what they would owe at the current rate with their new pledge.
        uint256 newDebtFromRate = (newUserPledge * tracker.accumulatedRewardsPerShare) / PRECISION_FACTOR;
        userState.rewardDebt = newDebtFromRate - (newTotalRewardsEarned - userState.rewardDebt);
    }


    /* ───────────────────────── View Functions ──────────────────────── */
    
    function pendingRewards(
        address user,
        uint256 poolId,
        address rewardToken,
        uint256 userPledge
    ) public view override returns (uint256) {
        RewardTracker storage tracker = poolRewardTrackers[poolId][rewardToken];
        UserRewardState storage userState = userRewardStates[user][poolId][rewardToken];
        uint256 totalRewardsEarned = (userPledge * tracker.accumulatedRewardsPerShare) / PRECISION_FACTOR;
        return totalRewardsEarned > userState.rewardDebt ? totalRewardsEarned - userState.rewardDebt : 0;
    }

    function userPledgeFor(address user, uint256 poolId) internal view returns (uint256) {
        if (poolRegistry.isYieldRewardPool(poolId)) {
            (,,uint256 shares,) = ICapitalPool(capitalPool).getUnderwriterAccount(user);
            return shares;
        } else {
            return IUnderwriterManager(underwriterManager).underwriterPoolPledge(user, poolId);
        }
    }
}
