// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "./IComet.sol";

interface ICometWithRates is IComet {
    function getUtilization() external view returns (uint256);
    function getSupplyRate(uint256 utilization) external view returns (uint256);
}
