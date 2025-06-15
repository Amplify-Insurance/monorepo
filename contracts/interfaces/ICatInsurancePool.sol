// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface ICatInsurancePool {
    function drawFund(uint256 amount) external;
    function receiveUsdcPremium(uint256 amount) external;
}
