// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IUnderwriterManager {
    function getUnderwriterAllocations(address user) external view returns (uint256[] memory);
    function underwriterPoolPledge(address user, uint256 poolId) external view returns (uint256);
    function realizeLossesForAllPools(address user) external;
    function onCapitalDeposited(address underwriter, uint256 amount) external;
    function onWithdrawalRequested(address underwriter, uint256 principalComponent) external;
    function onWithdrawalCancelled(address underwriter, uint256 principalComponent) external;
    function onCapitalWithdrawn(address underwriter, uint256 principalComponentRemoved, bool isFullWithdrawal) external;
    function settleLossesForUser(address user) external;
    function onLossRealized(address underwriter, uint256 valueLost) external;
    function getPoolPayoutData(uint256 poolId) external view returns (address[] memory, uint256[] memory, uint256);
    function capitalPendingWithdrawal(uint256 poolId) external view returns (uint256);
    function getPoolUnderwriters(uint256 poolId) external view returns (address[] memory);
    function recordLossAgainstPledge(address underwriter, uint256 poolId, uint256 lossAmount) external;
    function setMaxAllocationsPerUnderwriter(uint256 _newMax) external;
    function setDeallocationNoticePeriod(uint256 _newPeriod) external;
    function overlapExposure(uint256 claimPoolId, uint256 otherPoolId) external view returns (uint256 exposure);
    function isAllocatedToPool(address underwriter, uint256 poolId) external view returns (bool);
    function getPoolUnderwriterPledges(uint256 poolId)
        external
        view
        returns (address[] memory underwriters, uint256[] memory pledges);
}
