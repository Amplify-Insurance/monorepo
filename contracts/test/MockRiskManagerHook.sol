// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IRiskManager_PM_Hook.sol";

contract MockRiskManagerHook is IRiskManager_PM_Hook {
    event CoverageUpdated(uint256 poolId, uint256 amount, bool isSale);

    function updateCoverageSold(uint256 poolId, uint256 amount, bool isSale) external override {
        emit CoverageUpdated(poolId, amount, isSale);
    }
}
