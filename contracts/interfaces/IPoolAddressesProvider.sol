// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IPoolAddressesProvider {
    function getPool() external view returns (address);
}
