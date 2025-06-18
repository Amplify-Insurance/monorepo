// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IYieldAdapterEmergency {
    function emergencyTransfer(address recipient, uint256 amount) external returns (uint256);
}
