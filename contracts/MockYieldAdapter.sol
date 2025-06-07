// contracts/test/MockYieldAdapter.sol (or contracts/mocks/MockYieldAdapter.sol)
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IYieldAdapter.sol"; // Adjust path if your IYieldAdapter.sol is elsewhere

/**
 * @title MockYieldAdapter
 * @notice A mock implementation of IYieldAdapter for testing purposes.
 * @dev This adapter is designed to be used by a single primary depositor (e.g., CoverPool contract).
 * It allows simulating deposits, withdrawals, and yield/loss, and forcing reverts for testing.
 */
contract MockYieldAdapter is IYieldAdapter, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlyingToken;
    address public depositorContract; 

    uint256 public totalValueHeld; 
    bool public revertOnGetCurrentValueHeldNextCall = false; // Flag to control reverting

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

    // Removed getAdapterTotalValueHeldForTest() as totalValueHeld is public.

    /**
     * @inheritdoc IYieldAdapter
     * @dev Returns the value held by the depositor. Can be set to revert for testing.
     */
    function getCurrentValueHeld() external view override onlyDepositorContract returns (uint256 currentValue) {
        if (revertOnGetCurrentValueHeldNextCall) {
            revert("MockAdapter: getCurrentValueHeld deliberately reverted for test");
        }
        return totalValueHeld;
    }
    
    /**
     * @notice Owner function to make the next call to getCurrentValueHeld revert or succeed.
     * @param _revert True to make it revert, false for normal operation.
     */
    function setRevertOnNextGetCurrentValueHeld(bool _revert) external onlyOwner {
        revertOnGetCurrentValueHeldNextCall = _revert;
        emit RevertFlagSet(_revert);
    }

    function setDepositor(address _newDepositorAddress) external onlyOwner {
        require(_newDepositorAddress != address(0), "MockAdapter: New depositor cannot be zero address");
        depositorContract = _newDepositorAddress;
        emit DepositorSet(_newDepositorAddress);
    }

    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    function deposit(uint256 _amountToDeposit) external override onlyDepositorContract {
        require(_amountToDeposit > 0, "MockAdapter: Deposit amount must be > 0");
        underlyingToken.safeTransferFrom(msg.sender, address(this), _amountToDeposit);
        totalValueHeld += _amountToDeposit;
        emit Deposited(msg.sender, _amountToDeposit);
    }

    function withdraw(
        uint256 _targetAmountOfUnderlyingToWithdraw,
        address _to
    ) external override onlyDepositorContract returns (uint256 actuallyWithdrawn) {
        require(_to != address(0), "MockAdapter: Cannot withdraw to zero address");
        if (_targetAmountOfUnderlyingToWithdraw == 0) {
            return 0;
        }

        uint256 actualBalance = underlyingToken.balanceOf(address(this));
        actuallyWithdrawn = Math.min(_targetAmountOfUnderlyingToWithdraw, totalValueHeld);
        actuallyWithdrawn = Math.min(actuallyWithdrawn, actualBalance); // Cannot withdraw more than contract holds

        if (actuallyWithdrawn > 0) {
            totalValueHeld = totalValueHeld - actuallyWithdrawn; // totalValueHeld can be > actualBalance if yield was simulated without actual tokens
            underlyingToken.safeTransfer(_to, actuallyWithdrawn);
        }
        
        emit Withdrawn(msg.sender, _to, _targetAmountOfUnderlyingToWithdraw, actuallyWithdrawn);
        return actuallyWithdrawn;
    }

    function simulateYieldOrLoss(int256 _yieldOrLossAmount) external onlyOwner {
        if (_yieldOrLossAmount > 0) {
            totalValueHeld += uint256(_yieldOrLossAmount);
        } else if (_yieldOrLossAmount < 0) {
            uint256 loss = uint256(-_yieldOrLossAmount);
            if (totalValueHeld >= loss) {
                totalValueHeld -= loss;
            } else {
                totalValueHeld = 0; 
            }
        }
        // Adjust physical balance if simulating loss below current holdings for more realism in withdraw tests
        // This part is tricky: if totalValueHeld is just an accounting variable for NAV, it doesn't need to match physical balance.
        // But for withdraw to be realistic, it should.
        // For simplicity, simulateYieldOrLoss only affects totalValueHeld.
        // The withdraw function already caps by `underlyingToken.balanceOf(address(this))`.
        emit ValueAdjusted(msg.sender, _yieldOrLossAmount, totalValueHeld);
    }

    function setTotalValueHeld(uint256 _newValue) external onlyOwner {
        totalValueHeld = _newValue;
        // This also does not touch physical balance, only the reported value.
        // To make withdraw work correctly after this, one might need to also mint/burn tokens to this adapter.
        emit ValueAdjusted(msg.sender, 0, totalValueHeld); // 0 yield to indicate direct set
    }
    
    // Allow owner to deposit funds directly into the mock adapter to back the totalValueHeld if needed for tests
    function fundAdapter(uint256 _amount) external onlyOwner {
        underlyingToken.safeTransferFrom(msg.sender, address(this), _amount);
    }


    receive() external payable {}
}