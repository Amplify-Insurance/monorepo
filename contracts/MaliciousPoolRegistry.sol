
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface IRiskManager {
    function allocateCapital(uint256[] calldata _poolIds) external;
}
contract MaliciousPoolRegistry {
    address public riskManager;
    function setRiskManager(address _rm) external {
        riskManager = _rm;
    }
    function updateCapitalAllocation(uint256, address, uint256, bool) external {
        // Re-enter
        IRiskManager(riskManager).allocateCapital(new uint256[](0));
    }
    function getPoolCount() external pure returns (uint256) {
        return 1;
    }
}
