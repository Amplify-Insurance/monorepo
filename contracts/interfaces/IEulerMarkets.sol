// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IEulerMarkets {
    function interestRate(address underlying) external view returns (uint256 borrowSPY, uint256 supplySPY);
}
