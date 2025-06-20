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

    address public lastUpdateUser;
    uint256 public lastUpdatePoolId;
    address public lastUpdateToken;
    uint256 public lastUpdatePledge;
    uint256 public updateCallCount;

    function setCatPool(address _catPool) external override {
        catPool = _catPool;
    }

    function distribute(uint256 poolId, address rewardToken, uint256 rewardAmount, uint256 totalPledgeInPool) external override {
        totalRewards[poolId][rewardToken] += rewardAmount;
        totalShares[poolId][rewardToken] = totalPledgeInPool;
    }

    function claimForCatPool(address user, uint256 poolId, address rewardToken, uint256 userPledge) external override returns (uint256) {
        uint256 reward = pendingRewards(user, poolId, rewardToken, userPledge);
        if (reward > 0) {
            totalRewards[poolId][rewardToken] -= reward;
        }
        return reward;
    }

    function claim(address user, uint256 poolId, address rewardToken, uint256 userPledge) external override returns (uint256) {
        lastClaimUser = user;
        lastClaimPoolId = poolId;
        lastClaimToken = rewardToken;
        lastClaimPledge = userPledge;
        claimCallCount++;
        return 0;
    }

    function updateUserState(address user, uint256 poolId, address rewardToken, uint256 userPledge) external override {
        lastUpdateUser = user;
        lastUpdatePoolId = poolId;
        lastUpdateToken = rewardToken;
        lastUpdatePledge = userPledge;
        updateCallCount++;
    }

    function pendingRewards(address, uint256 poolId, address rewardToken, uint256 userPledge) public view override returns (uint256) {
        uint256 total = totalRewards[poolId][rewardToken];
        uint256 shares = totalShares[poolId][rewardToken];
        if (shares == 0) return 0;
        return total * userPledge / shares;
    }
}
