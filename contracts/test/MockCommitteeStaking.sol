// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../interfaces/IStakingContract.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockCommitteeStaking is IStakingContract {
    IERC20 public immutable override governanceToken;
    mapping(address => uint256) private balances;

    constructor(IERC20 _token) {
        governanceToken = _token;
    }

    function setBalance(address user, uint256 amount) external {
        balances[user] = amount;
    }

    function slash(address, uint256) external override {}

    function stakedBalance(address user) external view override returns (uint256) {
        return balances[user];
    }
}
