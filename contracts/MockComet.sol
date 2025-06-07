// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Mock Compound V3 Comet
/// @notice Minimal mock of Compound's Comet for adapter testing
contract MockComet is Ownable {
    IERC20 public immutable asset;
    mapping(address => uint256) public balanceOf;

    constructor(IERC20 _asset) Ownable(msg.sender) {
        asset = _asset;
    }

    function supply(address asset_, uint256 amount) external {
        require(asset_ == address(asset), "MockComet: wrong asset");
        require(amount > 0, "MockComet: amount zero");
        asset.transferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;
    }

    function withdraw(address asset_, uint256 amount) external {
        require(asset_ == address(asset), "MockComet: wrong asset");
        uint256 bal = balanceOf[msg.sender];
        uint256 withdrawAmount = amount > bal ? bal : amount;
        if (withdrawAmount > 0) {
            balanceOf[msg.sender] -= withdrawAmount;
            asset.transfer(msg.sender, withdrawAmount);
        }
    }

    function baseToken() external view returns (address) {
        return address(asset);
    }
}
