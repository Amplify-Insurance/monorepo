// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface ILossDistributor {
    function distributeLoss(uint256 poolId, uint256 lossAmount, uint256 totalPledgeInPool) external;
    function getPendingLosses(address user, uint256 poolId, uint256 userPledge) external view returns (uint256);
    function realizeAggregateLoss(
    address user,
    uint256 totalLossValue,
    uint256[] calldata poolIds
) external;

    function getProspectiveLosses(
        address user,
        uint256 poolId,
        uint256 userPledge
    ) external view returns (uint256);

    function recordPledgeUpdate(
    address user,
    uint256 poolId
) external;


}
