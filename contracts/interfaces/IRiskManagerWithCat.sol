// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "./ICatInsurancePool.sol";

interface IRiskManagerWithCat {
    function catPool() external view returns (ICatInsurancePool);
}
