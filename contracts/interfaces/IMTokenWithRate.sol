// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "./IMToken.sol";

interface IMTokenWithRate is IMToken {
    function supplyRatePerBlock() external view returns (uint256);
}
