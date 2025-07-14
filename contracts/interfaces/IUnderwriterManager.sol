// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IUnderwriterManager {
    function getUnderwriterAllocations(address user) external view returns (uint256[] memory);
    function underwriterPoolPledge(address user, uint256 poolId) external view returns (uint256);
    function realizeLossesForAllPools(address user) external;
}
