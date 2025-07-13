// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IRewardDistributor.sol";

contract MockRewardDistributor is IRewardDistributor {
    using SafeERC20 for IERC20;

    address public catPool;

    // --- NEW: State variables to accurately mimic the real contract ---
    uint256 public constant PRECISION_FACTOR = 1e18;
    mapping(uint256 => mapping(address => uint256)) public accumulatedRewardsPerShare;
    mapping(address => mapping(uint256 => mapping(address => uint256))) public rewardDebt;
    
    mapping(uint256 => mapping(address => uint256)) public totalRewards;
    mapping(uint256 => mapping(address => uint256)) public totalShares;
    
    // --- Test helper variables ---
    address public lastClaimUser;
    uint256 public lastClaimPoolId;
    address public lastClaimToken;
    uint256 public lastClaimPledge;
    uint256 public claimCallCount;

    uint256 public last_distribute_poolId;
    address public last_distribute_protocolToken;
    uint256 public last_distribute_amount;
    uint256 public last_distribute_totalPledge;

    uint256 public distributeCallCount;

    address public last_updateUserState_user;
    uint256 public last_updateUserState_poolId;
    address public last_updateUserState_token;
    uint256 public last_updateUserState_pledge;
    uint256 public updateUserStateCallCount;

    function setCatPool(address _catPool) external override {
        catPool = _catPool;
    }

    function distribute(uint256 poolId, address rewardToken, uint256 rewardAmount, uint256 totalPledgeInPool)
        external
        override
    {
        if (totalPledgeInPool > 0) {
            accumulatedRewardsPerShare[poolId][rewardToken] += (rewardAmount * PRECISION_FACTOR) / totalPledgeInPool;
        }
    }

// In MockRewardDistributor.sol

function claimForCatPool(address user, uint256 poolId, address rewardToken, uint256 userPledge)
    external
    override
    returns (uint256)
{
    // 1. Calculate the user's pending rewards based on the current state.
    uint256 reward = pendingRewards(user, poolId, rewardToken, userPledge);

    if (reward > 0) {
        // 2. Update the user's "reward debt" to prevent re-claiming.
        // This snapshots their state so they cannot claim the same rewards again.
        rewardDebt[user][poolId][rewardToken] =
            (userPledge * accumulatedRewardsPerShare[poolId][rewardToken]) / PRECISION_FACTOR;
        
        // 3. Transfer the claimed reward tokens FROM THIS CONTRACT'S BALANCE TO the user.
        IERC20(rewardToken).safeTransfer(user, reward);
    }

    // 4. Return the amount of rewards successfully claimed.
    return reward;
}
    function claim(address user, uint256 poolId, address rewardToken, uint256 userPledge)
        external
        override
        returns (uint256)
    {
        // Update test trackers
        lastClaimUser = user;
        lastClaimPoolId = poolId;
        lastClaimToken = rewardToken;
        lastClaimPledge = userPledge;
        claimCallCount++;

        // Perform the actual claim logic
        uint256 reward = pendingRewards(user, poolId, rewardToken, userPledge);
        if (reward > 0) {
            rewardDebt[user][poolId][rewardToken] = (userPledge * accumulatedRewardsPerShare[poolId][rewardToken]) / PRECISION_FACTOR;
            IERC20(rewardToken).safeTransfer(user, reward);
        }
        return reward;
    }

    function updateUserState(address user, uint256 poolId, address rewardToken, uint256 userPledge) external override {
        uint256 accumulated = accumulatedRewardsPerShare[poolId][rewardToken];
        rewardDebt[user][poolId][rewardToken] = (userPledge * accumulated) / PRECISION_FACTOR;
    }


    function pendingRewards(address user, uint256 poolId, address rewardToken, uint256 userPledge)
        public
        view
        override
        returns (uint256)
    {
        uint256 accumulated = (userPledge * accumulatedRewardsPerShare[poolId][rewardToken]) / PRECISION_FACTOR;
        return accumulated - rewardDebt[user][poolId][rewardToken];
    }
}
