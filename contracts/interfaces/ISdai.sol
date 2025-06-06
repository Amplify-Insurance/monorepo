// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISdai {
    function deposit(uint256 assets, address receiver) external returns (uint256);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}
