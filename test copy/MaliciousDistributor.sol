// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPM {
    function cancelCover(uint256 id) external;
}

contract MaliciousDistributor {
    address public pm;
    uint256 public policyId;

    function setTargets(address _pm, uint256 _policyId) external {
        pm = _pm;
        policyId = _policyId;
    }

    function distribute(uint256, address, uint256, uint256) external {
        IPM(pm).cancelCover(policyId);
    }
}
