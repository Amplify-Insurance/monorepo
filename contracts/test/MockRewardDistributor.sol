// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IRewardDistributor.sol";

contract MockRewardDistributor is IRewardDistributor {
    address public catPool;

    mapping(uint256 => mapping(address => uint256)) public totalRewards;
    mapping(uint256 => mapping(address => uint256)) public totalShares;

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

    function claim(address, uint256, address, uint256) external override returns (uint256) {
        return 0;
    }

    function updateUserState(address, uint256, address, uint256) external override {}

    function pendingRewards(address, uint256 poolId, address rewardToken, uint256 userPledge) public view override returns (uint256) {
        uint256 total = totalRewards[poolId][rewardToken];
        uint256 shares = totalShares[poolId][rewardToken];
        if (shares == 0) return 0;
        return total * userPledge / shares;
    }
}
