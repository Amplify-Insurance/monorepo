// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./MockERC20.sol";

interface IMintableERC20 is IERC20 {
    function mint(address to, uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
}

/// @title Mock Aave V3 Pool
/// @notice Minimal mock of the Aave V3 pool for adapter testing
contract MockAaveV3Pool is Ownable {
    IERC20 public immutable asset;
    IMintableERC20 public immutable aToken;

    constructor(IERC20 _asset, IMintableERC20 _aToken) Ownable(msg.sender) {
        asset = _asset;
        aToken = _aToken;
    }

    function supply(address asset_, uint256 amount, address onBehalfOf, uint16) external {
        require(asset_ == address(asset), "MockAaveV3Pool: wrong asset");
        require(amount > 0, "MockAaveV3Pool: amount zero");
        asset.transferFrom(msg.sender, address(this), amount);
        aToken.mint(onBehalfOf, amount);
    }

    function withdraw(address asset_, uint256 amount, address to) external returns (uint256) {
        require(asset_ == address(asset), "MockAaveV3Pool: wrong asset");
        uint256 bal = asset.balanceOf(address(this));
        uint256 withdrawAmount = amount > bal ? bal : amount;
        if (withdrawAmount > 0) {
            aToken.burnFrom(msg.sender, withdrawAmount);
            asset.transfer(to, withdrawAmount);
        }
        return withdrawAmount;
    }
}
