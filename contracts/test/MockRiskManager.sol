// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockRiskManager {
    bool public shouldReject;

    event CapitalDeposited(address indexed underwriter, uint256 amount);
    event WithdrawalRequested(address indexed underwriter, uint256 principal);
    event CapitalWithdrawn(address indexed underwriter, uint256 principal, bool isFullWithdrawal);

    function setShouldReject(bool _reject) external {
        shouldReject = _reject;
    }

    function onCapitalDeposited(address _underwriter, uint256 _amount) external {
        emit CapitalDeposited(_underwriter, _amount);
    }

    function onWithdrawalRequested(address _underwriter, uint256 _principal) external {
        if (shouldReject) {
            revert("MockRiskManager: reject");
        }
        emit WithdrawalRequested(_underwriter, _principal);
    }

    function onCapitalWithdrawn(address _underwriter, uint256 _principal, bool _isFullWithdrawal) external {
        emit CapitalWithdrawn(_underwriter, _principal, _isFullWithdrawal);
    }

    function onWithdrawalCancelled(address underwriter, uint256 valueCancelled) external {
    // This function can be empty for the test to pass. Its existence is what matters.
    // You can optionally add state variables to track calls if needed for assertions.
}
}
