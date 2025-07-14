// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IUnderwriterManager.sol";

/**
 * @title MockUnderwriterManager
 * @notice Minimal mock implementing the functions used by RiskManager tests.
 */
contract MockUnderwriterManager is IUnderwriterManager {
    mapping(address => uint256[]) private _allocations;
    mapping(address => mapping(uint256 => uint256)) private _pledges;

    uint256 public realizeLossesForAllPoolsCallCount;
    address public last_realizeLossesForAllPools_user;

    function setUnderwriterAllocations(address user, uint256[] memory pools) external {
        _allocations[user] = pools;
    }

    function setUnderwriterPoolPledge(address user, uint256 poolId, uint256 amount) external {
        _pledges[user][poolId] = amount;
    }

    function getUnderwriterAllocations(address user) external view returns (uint256[] memory) {
        return _allocations[user];
    }

    function underwriterPoolPledge(address user, uint256 poolId) external view returns (uint256) {
        return _pledges[user][poolId];
    }

    function realizeLossesForAllPools(address user) external {
        realizeLossesForAllPoolsCallCount += 1;
        last_realizeLossesForAllPools_user = user;
    }
}
