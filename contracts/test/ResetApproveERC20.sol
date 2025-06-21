// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ERC20 token that requires allowance to be zero before being changed
contract ResetApproveERC20 is ERC20 {
    uint8 private immutable _mockDecimals;
    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _mockDecimals = decimals_;
    }
    function decimals() public view override returns (uint8) {
        return _mockDecimals;
    }
    function approve(address spender, uint256 amount) public override returns (bool) {
        uint256 current = allowance(_msgSender(), spender);
        if (amount != 0 && current != 0) {
            revert("ResetApproveERC20: must set 0 first");
        }
        return super.approve(spender, amount);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
