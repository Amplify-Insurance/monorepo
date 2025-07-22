// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IRiskManagerWithBackstop.sol";
import "../interfaces/IBackstopPool.sol";
import "../core/CapitalPool.sol";

contract MockRiskManagerWithBackstop is IRiskManagerWithBackstop {
    IBackstopPool public override catPool;

    event CapitalDeposited(address indexed underwriter, uint256 amount);
    event WithdrawalRequested(address indexed underwriter, uint256 amount);
    event CapitalWithdrawn(address indexed underwriter, uint256 amount, bool full);

    constructor(address _catPool) {
        catPool = IBackstopPool(_catPool);
    }

    function setCatPool(address _catPool) external {
        catPool = IBackstopPool(_catPool);
    }

    function onCapitalDeposited(address _u, uint256 _amount) external {
        emit CapitalDeposited(_u, _amount);
    }

    function onWithdrawalRequested(address _u, uint256 _principal) external {
        emit WithdrawalRequested(_u, _principal);
    }

    function onCapitalWithdrawn(address _u, uint256 _principal, bool _full) external {
        emit CapitalWithdrawn(_u, _principal, _full);
    }

    function executePayout(address capitalPool, CapitalPool.PayoutData calldata data) external {
        CapitalPool(capitalPool).executePayout(data);
    }

    function applyLossesOnPool(address pool, address underwriter, uint256 amount) external {
        CapitalPool(pool).applyLosses(underwriter, amount);
    }
}
