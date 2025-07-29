// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IUnderwriterManager.sol";

/**
 * @title MockUnderwriterManager
 * @notice Mock implementing IUnderwriterManager for testing integrations.
 * @dev This version includes all functions required by the interface.
 */
contract MockUnderwriterManager is IUnderwriterManager {
    mapping(address => uint256[]) private _allocations;
    mapping(address => uint256) public underwriterTotalPledge;

    // --- Call tracking for realizeLossesForAllPools ---
    uint256 public realizeLossesForAllPoolsCallCount;
    address public last_realizeLossesForAllPools_user;

    // --- Call tracking for hooks from CapitalPool ---
    uint256 public onCapitalDepositedCallCount;
    uint256 public onCapitalWithdrawnCallCount;
    uint256 public onWithdrawalRequestedCallCount;
    uint256 public onWithdrawalCancelledCallCount;

    // --- Test helpers ---
    function setUnderwriterAllocations(address user, uint256[] memory allocs) external {
        _allocations[user] = allocs;
    }

    // --- IUnderwriterManager Implementation ---

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

    // --- CORRECTED: Added missing hook implementations ---

    function onCapitalDeposited(address underwriter, uint256 amount) external override {
        underwriterTotalPledge[underwriter] += amount;
        onCapitalDepositedCallCount++;
    }

    function onCapitalWithdrawn(address underwriter, uint256 principalComponentRemoved, bool isFullWithdrawal)
        external
        override
    {
        if (underwriterTotalPledge[underwriter] >= principalComponentRemoved) {
            underwriterTotalPledge[underwriter] -= principalComponentRemoved;
        } else {
            underwriterTotalPledge[underwriter] = 0;
        }

        if (isFullWithdrawal) {
            underwriterTotalPledge[underwriter] = 0;
        }
        onCapitalWithdrawnCallCount++;
    }

    function onWithdrawalRequested(address, uint256) external override {
        // This function can be empty for the test to pass.
        // Its existence is what matters.
        onWithdrawalRequestedCallCount++;
    }

    function onWithdrawalCancelled(address, uint256) external override {
        // This function can be empty for the test to pass.
        onWithdrawalCancelledCallCount++;
    }
}