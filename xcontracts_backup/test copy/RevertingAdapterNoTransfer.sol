// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IYieldAdapterEmergency.sol";

contract RevertingAdapterNoTransfer is IYieldAdapter, IYieldAdapterEmergency {
    IERC20 public immutable override asset;
    constructor(IERC20 _asset) { asset = _asset; }
    function deposit(uint256) external override {}
    function withdraw(uint256, address) external pure override returns (uint256) {
        revert("RevertingAdapter: withdraw failed");
    }
    function emergencyTransfer(address, uint256) external pure override returns (uint256) {
        return 0;
    }
    function getCurrentValueHeld() external view override returns (uint256) {
        return asset.balanceOf(address(this));
    }
}
