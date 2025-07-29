// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IYieldAdapter.sol";

/**
 * @title MockYieldAdapter
 * @notice A mock implementation of IYieldAdapter for testing purposes.
 */
contract MockYieldAdapter is IYieldAdapter, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlyingToken;
    address public depositorContract;

    uint256 public totalValueHeld;
    bool public shouldRevert = false; // Generic revert flag for all functions

    // --- State variables for tracking calls ---
    uint256 public depositCallCount;
    uint256 public last_deposit_amount;

    uint256 public withdrawCallCount;
    uint256 public last_withdraw_amount;
    address public last_withdraw_recipient;
    
    uint256 public emergencyTransferCallCount;
    uint256 public last_emergencyTransfer_amount;
    address public last_emergencyTransfer_recipient;


    event Deposited(address indexed caller, uint256 amount);
    event Withdrawn(address indexed caller, address indexed to, uint256 amountRequested, uint256 amountTransferred);
    event ValueAdjusted(address indexed caller, int256 yieldOrLossAmount, uint256 newTotalValue);
    event DepositorSet(address indexed newDepositor);
    event RevertFlagSet(bool revertNext);


    modifier onlyDepositorContract() {
        require(msg.sender == depositorContract, "MockAdapter: Caller is not the designated depositor");
        _;
    }

    constructor(address _underlyingTokenAddress, address _initialDepositorAddress, address _initialOwner) Ownable(_initialOwner) {
        require(_underlyingTokenAddress != address(0), "MockAdapter: Invalid underlying token address");
        underlyingToken = IERC20(_underlyingTokenAddress);
        if (_initialDepositorAddress != address(0)) {
            depositorContract = _initialDepositorAddress;
        }
    }

    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    function getCurrentValueHeld() external view override onlyDepositorContract returns (uint256) {
        if (shouldRevert) {
            revert("MockAdapter: Deliberate revert");
        }
        return totalValueHeld;
    }

    function deposit(uint256 _amountToDeposit) external override onlyDepositorContract {
        if (shouldRevert) {
            revert("MockAdapter: Deliberate revert");
        }
        require(_amountToDeposit > 0, "MockAdapter: Deposit amount must be > 0");
        underlyingToken.safeTransferFrom(msg.sender, address(this), _amountToDeposit);
        totalValueHeld += _amountToDeposit;
        
        // Track calls
        depositCallCount++;
        last_deposit_amount = _amountToDeposit;

        emit Deposited(msg.sender, _amountToDeposit);
    }

    /**
     * @notice CORRECTED: This function now updates the tracking variables.
     */
    function withdraw(
        uint256 _targetAmountOfUnderlyingToWithdraw,
        address _to
    ) external override onlyDepositorContract returns (uint256 actuallyWithdrawn) {
        if (shouldRevert) {
            revert("MockAdapter: Deliberate revert");
        }
        require(_to != address(0), "MockAdapter: Cannot withdraw to zero address");
        
        // --- Call Tracking Logic ---
        withdrawCallCount++;
        last_withdraw_amount = _targetAmountOfUnderlyingToWithdraw;
        last_withdraw_recipient = _to;
        // --- End Tracking Logic ---

        if (_targetAmountOfUnderlyingToWithdraw == 0) {
            return 0;
        }

        uint256 actualBalance = underlyingToken.balanceOf(address(this));
        actuallyWithdrawn = Math.min(_targetAmountOfUnderlyingToWithdraw, totalValueHeld);
        actuallyWithdrawn = Math.min(actuallyWithdrawn, actualBalance);

        if (actuallyWithdrawn > 0) {
            totalValueHeld -= actuallyWithdrawn;
            underlyingToken.safeTransfer(_to, actuallyWithdrawn);
        }
        
        emit Withdrawn(msg.sender, _to, _targetAmountOfUnderlyingToWithdraw, actuallyWithdrawn);
        return actuallyWithdrawn;
    }

    // --- Mock Control Functions ---

    function setShouldRevert(bool _revert) external onlyOwner {
        shouldRevert = _revert;
        emit RevertFlagSet(_revert);
    }

    function setDepositor(address _newDepositorAddress) external onlyOwner {
        require(_newDepositorAddress != address(0), "MockAdapter: New depositor cannot be zero address");
        depositorContract = _newDepositorAddress;
        emit DepositorSet(_newDepositorAddress);
    }

    function simulateYieldOrLoss(int256 _yieldOrLossAmount) external onlyOwner {
        if (_yieldOrLossAmount > 0) {
            totalValueHeld += uint256(_yieldOrLossAmount);
        } else if (_yieldOrLossAmount < 0) {
            uint256 loss = uint256(-_yieldOrLossAmount);
            totalValueHeld = totalValueHeld > loss ? totalValueHeld - loss : 0;
        }
        emit ValueAdjusted(msg.sender, _yieldOrLossAmount, totalValueHeld);
    }
    
    // --- Emergency Functions for IYieldAdapterEmergency interface ---
    function emergencyTransfer(address recipient, uint256 amount) external returns (uint256) {
        emergencyTransferCallCount++;
        last_emergencyTransfer_recipient = recipient;
        last_emergencyTransfer_amount = amount;
        
        uint256 toSend = Math.min(amount, underlyingToken.balanceOf(address(this)));
        if (toSend > 0) {
            underlyingToken.safeTransfer(recipient, toSend);
        }
        return toSend;
    }
}