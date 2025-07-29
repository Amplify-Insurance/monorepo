// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IRewardDistributor {
    function distribute(uint256 poolId, address rewardToken, uint256 rewardAmount, uint256 totalPledgeInPool) external;
    function claim(address user, uint256 poolId, address rewardToken, uint256 userPledge) external returns (uint256);
    function claimForCatPool(address user, uint256 poolId, address rewardToken, uint256 userPledge) external returns (uint256);
    function updateUserState(address user, uint256 poolId, address rewardToken, uint256 userPledge) external;
    function pendingRewards(address user, uint256 poolId, address rewardToken, uint256 userPledge) external view returns (uint256);
    function setCatPool(address _catPool) external;
}
