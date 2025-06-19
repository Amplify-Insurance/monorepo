
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract MaliciousERC20 is ERC20 {
    bool public failTransfer = false;
    bool public failTransferFrom = false;
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function setFailTransfer(bool _fail) public {
        failTransfer = _fail;
    }
    function setFailTransferFrom(bool _fail) public {
        failTransferFrom = _fail;
    }
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
    function transfer(address to, uint256 amount) public override returns (bool) {
        require(!failTransfer, "MaliciousERC20: transfer failed");
        return super.transfer(to, amount);
    }
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        require(!failTransferFrom, "MaliciousERC20: transferFrom failed");
        return super.transferFrom(from, to, amount);
    }
}
