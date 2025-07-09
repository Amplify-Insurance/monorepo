// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "./IBackstopPool.sol";

interface IRiskManagerWithBackstop {
    function catPool() external view returns (IBackstopPool);
}
