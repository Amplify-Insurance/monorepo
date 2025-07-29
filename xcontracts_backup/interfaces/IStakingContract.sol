// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakingContract {
    function slash(address _user, uint256 _amount) external;
    function stakedBalance(address _user) external view returns (uint256);
    function governanceToken() external view returns (IERC20);
    function recordVote(address _voter, uint256 _proposalId) external;
}
