// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IRewardDistributor.sol";

contract MockRewardDistributor is IRewardDistributor {
    address public catPool;

    mapping(uint256 => mapping(address => uint256)) public totalRewards;
    mapping(uint256 => mapping(address => uint256)) public totalShares;
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
        last_distribute_poolId = poolId;
        last_distribute_protocolToken = rewardToken;
        last_distribute_amount = rewardAmount;
        last_distribute_totalPledge = totalPledgeInPool;
        totalRewards[poolId][rewardToken] += rewardAmount;
        totalShares[poolId][rewardToken] = totalPledgeInPool;
        distributeCallCount++;
    }

    function claimForCatPool(address user, uint256 poolId, address rewardToken, uint256 userPledge)
        external
        override
        returns (uint256)
    {
        uint256 reward = pendingRewards(user, poolId, rewardToken, userPledge);
        if (reward > 0) {
            totalRewards[poolId][rewardToken] -= reward;
        }
        return reward;
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
        return 0;
    }

    function updateUserState(address user, uint256 poolId, address rewardToken, uint256 userPledge) external override {
        last_updateUserState_user = user;
        last_updateUserState_poolId = poolId;
        last_updateUserState_token = rewardToken;
        last_updateUserState_pledge = userPledge;
        updateUserStateCallCount++;
    }

    function pendingRewards(address, uint256 poolId, address rewardToken, uint256 userPledge)
        public
        view
        override
        returns (uint256)
    {
        uint256 total = totalRewards[poolId][rewardToken];
        uint256 shares = totalShares[poolId][rewardToken];
        if (shares == 0) return 0;
        return total * userPledge / shares;
    }
}
