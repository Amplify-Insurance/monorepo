// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IRiskManagerPMHook.sol";

contract MockRiskManagerHook is IRiskManagerPMHook {
    event CoverageUpdated(uint256 poolId, uint256 amount, bool isSale);

    function updateCoverageSold(uint256 poolId, uint256 amount, bool isSale) external override {
        emit CoverageUpdated(poolId, amount, isSale);
    }
}
