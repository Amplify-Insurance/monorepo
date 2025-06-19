// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/ICatInsurancePool.sol";

interface IPM {
    function addPremium(uint256 id, uint256 amount) external;
}

contract MaliciousCatReentrant is ICatInsurancePool {
    IPM public pm;
    uint256 public policyId;

    function setTargets(address _pm, uint256 _policyId) external {
        pm = IPM(_pm);
        policyId = _policyId;
    }

    function receiveUsdcPremium(uint256) external override {
        pm.addPremium(policyId, 1);
    }

    function drawFund(uint256) external override {}

    function claimProtocolAssetRewards(address) external override {}
}
