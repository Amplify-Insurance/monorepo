// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IYieldAdapterEmergency.sol";

contract RevertingAdapter is IYieldAdapter, IYieldAdapterEmergency {
    IERC20 public immutable override asset;
    constructor(IERC20 _asset) {
        asset = _asset;
    }
    function deposit(uint256 amount) external override {}
    function withdraw(uint256, address) external pure override returns (uint256) {
        revert("RevertingAdapter: withdraw failed");
    }
    function emergencyTransfer(address to, uint256 amount) external override returns (uint256) {
        uint256 bal = asset.balanceOf(address(this));
        uint256 amt = bal < amount ? bal : amount;
        if(amt > 0){
            asset.transfer(to, amt);
        }
        return amt;
    }
    function getCurrentValueHeld() external view override returns (uint256) {
        return asset.balanceOf(address(this));
    }
}
