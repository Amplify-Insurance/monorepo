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
}
