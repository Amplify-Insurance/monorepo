// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IYieldAdapter.sol";

/**
 * @title MockCompoundV3Adapter
 * @author Gemini
 * @notice A mock yield adapter for the Compound V3 protocol, intended for testnet environments.
 * @dev This contract simulates the behavior of the CompoundV3Adapter for testing purposes.
 * It does not interact with the actual Compound protocol. Instead, it tracks balances
 * internally and includes a helper function to simulate yield generation.
 */
contract MockCompoundV3Adapter is IYieldAdapter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlyingToken;
    address public capitalPoolAddress;

    // Internal accounting to track the total value held by the adapter.
    uint256 private _valueHeld;

    event FundsWithdrawn(address indexed to, uint256 requestedAmount, uint256 actualAmount);
    event CapitalPoolAddressSet(address indexed newCapitalPool);
    event YieldSimulated(uint256 yieldAmount);

    constructor(IERC20 _asset, address _initialOwner) Ownable(_initialOwner) {
        require(address(_asset) != address(0), "MockCompoundV3Adapter: invalid asset");
        underlyingToken = _asset;
    }

    // Modifier to restrict calls to the CapitalPool only
    modifier onlyCapitalPool() {
        require(msg.sender == capitalPoolAddress, "MockCompoundV3Adapter: Caller is not CapitalPool");
        _;
    }

    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    /**
     * @notice Simulates depositing funds into the adapter.
     * @dev Increases the internal value tracker and pulls tokens from the CapitalPool.
     */
    function deposit(uint256 amountToDeposit) external override onlyCapitalPool nonReentrant {
        require(amountToDeposit > 0, "MockCompoundV3Adapter: amount zero");
        
        // Pull funds from the CapitalPool contract
        underlyingToken.safeTransferFrom(msg.sender, address(this), amountToDeposit);
        
        // Update internal accounting
        _valueHeld += amountToDeposit;
    }

    /**
     * @notice Simulates withdrawing funds from the adapter.
     * @dev Decreases the internal value tracker and sends tokens to the recipient.
     */
    function withdraw(uint256 targetAmountOfUnderlyingToWithdraw, address to)
        external
        override
        onlyCapitalPool
        nonReentrant
        returns (uint256 actuallyWithdrawn)
    {
        require(to != address(0), "MockCompoundV3Adapter: zero address");
        if (targetAmountOfUnderlyingToWithdraw == 0) {
            return 0;
        }

        uint256 balance = underlyingToken.balanceOf(address(this));
        actuallyWithdrawn = (targetAmountOfUnderlyingToWithdraw > balance) ? balance : targetAmountOfUnderlyingToWithdraw;

        if (actuallyWithdrawn > 0) {
            if (_valueHeld >= actuallyWithdrawn) {
                _valueHeld -= actuallyWithdrawn;
            } else {
                _valueHeld = 0;
            }
            underlyingToken.safeTransfer(to, actuallyWithdrawn);
            emit FundsWithdrawn(to, targetAmountOfUnderlyingToWithdraw, actuallyWithdrawn);
        }
    }

    // Owner can set the CapitalPool address
    function setCapitalPoolAddress(address capitalPoolAddr) external onlyOwner {
        require(capitalPoolAddr != address(0), "MockCompoundV3Adapter: Zero address");
        capitalPoolAddress = capitalPoolAddr;
        emit CapitalPoolAddressSet(capitalPoolAddr);
    }

    /**
     * @notice Returns the total value tracked by this adapter.
     */
    function getCurrentValueHeld() external view override returns (uint256) {
        return _valueHeld;
    }

    /**
     * @notice Simulates an emergency withdrawal by transferring the underlying token directly.
     */
    function emergencyTransfer(address to, uint256 amount)
        external
        override
        onlyCapitalPool
        nonReentrant
        returns (uint256)
    {
        uint256 bal = underlyingToken.balanceOf(address(this));
        uint256 amt = (amount > bal) ? bal : amount;
        if (amt > 0) {
            underlyingToken.safeTransfer(to, amt);
        }
        return amt;
    }

    /**
     * @notice Test-only function to simulate the generation of yield.
     * @dev This allows you to test the `harvestAndDistributeYield` logic in the CapitalPool
     * by artificially increasing the value held by the adapter.
     * @param yieldAmount The amount of yield to simulate. The caller must also send
     * the corresponding amount of underlying tokens to this contract.
     */
    function simulateYield(uint256 yieldAmount) external {
        _valueHeld += yieldAmount;
        emit YieldSimulated(yieldAmount);
    }
}
