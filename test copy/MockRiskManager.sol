// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// NEW: Import the IBackstopPool interface
import "../interfaces/IBackstopPool.sol";

contract MockRiskManager {
    bool public shouldReject;

    // --- State variable to hold the address ---
    address public catPoolAddress;

    event CapitalDeposited(address indexed underwriter, uint256 amount);
    event WithdrawalRequested(address indexed underwriter, uint256 principal);
    event CapitalWithdrawn(address indexed underwriter, uint256 principal, bool isFullWithdrawal);
    event WithdrawalCancelled(address indexed underwriter, uint256 valueCancelled);


    /**
    * @notice Mock function to set the address of the Backstop Pool.
    */
    function setCatPool(address _catPoolAddress) external {
        catPoolAddress = _catPoolAddress;
    }

    /**
    * @notice Mock view function to return the configured Backstop Pool address.
    * @dev This mimics the function on the real IRiskManagerWithBackstop interface.
    */
    function catPool() external view returns (IBackstopPool) {
        return IBackstopPool(catPoolAddress);
    }
    
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

    function onWithdrawalCancelled(address _underwriter, uint256 _valueCancelled) external {
        emit WithdrawalCancelled(_underwriter, _valueCancelled);
    }
}
