// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IRiskManager_PM_Hook {
    function updateCoverageSold(uint256 poolId, uint256 amount, bool isSale) external;
}
