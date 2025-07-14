// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IUnderwriterManager.sol";

/**
 * @title MockUnderwriterManager
 * @notice Minimal mock implementing IUnderwriterManager for testing RiskManager.
 */
contract MockUnderwriterManager is IUnderwriterManager {
    mapping(address => uint256[]) private _allocations;

    uint256 public realizeLossesForAllPoolsCallCount;
    address public last_realizeLossesForAllPools_user;

    // --- Test helpers ---
    function setUnderwriterAllocations(address user, uint256[] memory allocs) external {
        _allocations[user] = allocs;
    }

    // --- IUnderwriterManager ---
    function getUnderwriterAllocations(address user) external view override returns (uint256[] memory) {
        return _allocations[user];
    }

    function underwriterPoolPledge(address, uint256) external pure override returns (uint256) {
        return 0;
    }

    function realizeLossesForAllPools(address user) external override {
        last_realizeLossesForAllPools_user = user;
        realizeLossesForAllPoolsCallCount++;
    }
}
