// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IMorphoCore {
    function supply(address poolToken, address onBehalf, uint256 amount) external returns (uint256);
    function withdraw(address poolToken, uint256 amount) external returns (uint256);
    function supplyBalanceInOf(address poolToken, address user) external view returns (uint256);
}
