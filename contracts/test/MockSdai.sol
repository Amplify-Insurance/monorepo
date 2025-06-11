// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../test/MockERC20.sol";

/// @title Mock sDAI token
/// @notice Minimal sDAI-like token for testing the SdaiAdapter
contract MockSdai is ERC20, Ownable {
    IERC20 public immutable dai;

    constructor(IERC20 _dai) ERC20("Mock sDAI", "msDAI") Ownable(msg.sender) {
        require(address(_dai) != address(0), "MockSdai: invalid DAI");
        dai = _dai;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        require(assets > 0, "MockSdai: amount zero");
        dai.transferFrom(msg.sender, address(this), assets);
        _mint(receiver, assets);
        return assets;
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256) {
        require(assets > 0, "MockSdai: amount zero");
        uint256 bal = balanceOf(owner);
        uint256 amt = assets > bal ? bal : assets;
        if (amt > 0) {
            _burn(owner, amt);
            dai.transfer(receiver, amt);
        }
        return amt;
    }
}
