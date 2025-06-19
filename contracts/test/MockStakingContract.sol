// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../interfaces/IStakingContract.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
contract MockStakingContract is IStakingContract {
    IERC20 public govToken;
    mapping(address => uint256) public balances;
    constructor(IERC20 _gov) {
        govToken = _gov;
    }
    function slash(address, uint256) external override {}
    function stakedBalance(address user) external view override returns (uint256) {
        return balances[user];
    }
    function governanceToken() external view override returns (IERC20) {
        return govToken;
    }
    function setBalance(address user, uint256 amount) external {
        balances[user] = amount;
    }
}
