// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IYieldAdapter {
    /**
     * @notice Returns the underlying ERC20 asset that this adapter primarily manages.
     */
    function asset() external view returns (IERC20);

    /**
     * @notice Deposits a specified amount of the underlying asset from the caller (e.g., CoverPool)
     * into the yield strategy.
     * @dev Caller must have approved this adapter contract to spend its tokens.
     */
    function deposit(uint256 _amountToDeposit) external;

    /**
     * @notice Withdraws a specified value of the underlying asset from the strategy to a recipient.
     * @dev Caller is typically the CoverPool contract.
     * @return actuallyWithdrawn The amount of underlying asset actually withdrawn.
     */
    function withdraw(uint256 _targetAmountOfUnderlyingToWithdraw, address _to) external returns (uint256 actuallyWithdrawn);


    /**
     * @notice Returns the current total market value of the underlying asset managed by this adapter
     * specifically for the caller (e.g., CoverPool contract, which is msg.sender).
     */
    function getCurrentValueHeld() external view returns (uint256 currentValue);

    function emergencyTransfer(address recipient, uint256 amount) external returns (uint256);

}