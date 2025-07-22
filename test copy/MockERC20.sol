// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; // For mint/burn control

contract MockERC20 is ERC20, Ownable {
    uint8 private _mockDecimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) Ownable(msg.sender) {
        _mockDecimals = decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _mockDecimals;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyOwner { // Usually just _burn(account, amount)
        _burn(from, amount);
    }
    
    function burnFrom(address account, uint256 amount) external onlyOwner {
        _burn(account, amount);
    }

    function transferFromAccountByOwner(address from, address to, uint256 amount) external onlyOwner {
        uint256 fromBalance = balanceOf(from);
        require(fromBalance >= amount, "MockERC20: transfer amount exceeds balance from account");
        _transfer(from, to, amount);
    }
}
