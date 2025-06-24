// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockRiskManagerFull {
    bool public rejectRequest;
    bool public revertOnDeposit;
    bool public revertOnCancel;

    event CapitalDeposited(address indexed underwriter, uint256 amount);
    event WithdrawalRequested(address indexed underwriter, uint256 amount);
    event WithdrawalCancelled(address indexed underwriter, uint256 amount);
    event CapitalWithdrawn(address indexed underwriter, uint256 amount, bool full);

    function setRejectRequest(bool _reject) external {
        rejectRequest = _reject;
    }

    function setRevertOnDeposit(bool _revert) external {
        revertOnDeposit = _revert;
    }

    function setRevertOnCancel(bool _revert) external {
        revertOnCancel = _revert;
    }

    function onCapitalDeposited(address _u, uint256 _amount) external {
        if (revertOnDeposit) revert("MockRM: deposit revert");
        emit CapitalDeposited(_u, _amount);
    }

    function onWithdrawalRequested(address _u, uint256 _amount) external {
        if (rejectRequest) revert("MockRM: reject request");
        emit WithdrawalRequested(_u, _amount);
    }

    function onWithdrawalCancelled(address _u, uint256 _amount) external {
        if (revertOnCancel) revert("MockRM: cancel revert");
        emit WithdrawalCancelled(_u, _amount);
    }

    function onCapitalWithdrawn(address _u, uint256 _amount, bool _full) external {
        emit CapitalWithdrawn(_u, _amount, _full);
    }
}
