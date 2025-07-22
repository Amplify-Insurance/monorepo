// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IRewardDistributor.sol";

contract MockRewardDistributor is IRewardDistributor {
    using SafeERC20 for IERC20;

    address public catPool;

    // --- State variables to accurately mimic the real contract ---
    uint256 public constant PRECISION_FACTOR = 1e18;
    mapping(uint256 => mapping(address => uint256)) public accumulatedRewardsPerShare;
    mapping(address => mapping(uint256 => mapping(address => uint256))) public rewardDebt;
    
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

        last_distribute_poolId = poolId;
        last_distribute_protocolToken = rewardToken;
        last_distribute_amount = rewardAmount;
        last_distribute_totalPledge = totalPledgeInPool;
        distributeCallCount++;
    }

    function claim(address user, uint256 poolId, address rewardToken, uint256 userPledge)
        external
        override
        returns (uint256)
    {
        lastClaimUser = user;
        lastClaimPoolId = poolId;
        lastClaimToken = rewardToken;
        lastClaimPledge = userPledge;
        claimCallCount++;

        uint256 reward = pendingRewards(user, poolId, rewardToken, userPledge);
        if (reward > 0) {
            rewardDebt[user][poolId][rewardToken] = (userPledge * accumulatedRewardsPerShare[poolId][rewardToken]) / PRECISION_FACTOR;
            // CORRECTED: The mock must perform the transfer to satisfy the test assertions.
            IERC20(rewardToken).safeTransfer(user, reward);
        }
        return reward;
    }

    function claimForCatPool(address user, uint256 poolId, address rewardToken, uint256 userPledge)
        external
        override
        returns (uint256)
    {
        // This mock can share logic with the regular claim function.
        return this.claim(user, poolId, rewardToken, userPledge);
    }

    function updateUserState(address user, uint256 poolId, address rewardToken, uint256 userPledge) external override {
        uint256 accumulated = accumulatedRewardsPerShare[poolId][rewardToken];
        rewardDebt[user][poolId][rewardToken] = (userPledge * accumulated) / PRECISION_FACTOR;

        last_updateUserState_user = user;
        last_updateUserState_poolId = poolId;
        last_updateUserState_token = rewardToken;
        last_updateUserState_pledge = userPledge;
        updateUserStateCallCount++;
    }

    function pendingRewards(address user, uint256 poolId, address rewardToken, uint256 userPledge)
        public
        view
        override
        returns (uint256)
    {
        uint256 accumulated = (userPledge * accumulatedRewardsPerShare[poolId][rewardToken]) / PRECISION_FACTOR;
        if (accumulated < rewardDebt[user][poolId][rewardToken]) {
            return 0;
        }
        return accumulated - rewardDebt[user][poolId][rewardToken];
    }
}