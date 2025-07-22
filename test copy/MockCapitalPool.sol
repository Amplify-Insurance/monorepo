// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/ICapitalPool.sol";

/**
 * @title MockCapitalPool
 * @notice A mock implementation of the CapitalPool for testing external contracts like RiskManager.
 * @dev This contract implements the external interface that the RiskManager interacts with.
 * It allows setting mock return values and recording calls to its functions so that
 * tests can assert correct interactions from the contract-under-test.
 */
contract MockCapitalPool is Ownable {
    // --- State for Mocking ---

    IERC20 public immutable underlyingAssetToken;
    bool public shouldRevertOnApplyLosses;

    // Variables to store the last arguments received by `applyLosses` for easy checking in tests
    address public last_applyLosses_underwriter;
    uint256 public last_applyLosses_principalLossAmount;
    uint256 public applyLossesCallCount;

    // --- Events for Testing ---

    event LossesAppliedCalled(address indexed underwriter, uint256 principalLossAmount);
    event RevertOnApplyLossesSet(bool shouldRevert);
    event RiskManagerNotifiedOfDeposit(address indexed underwriter, uint256 amount);
    event RiskManagerNotifiedOfWithdrawal(address indexed underwriter, uint256 principal, bool isFull);

    struct Account {
        uint256 dummy1;
        uint8 dummy2;
        uint256 masterShares;
        uint256 dummy3;
        uint256 dummy4;
    }

    mapping(address => address) private adapterAddresses;
    mapping(address => Account) private accounts;
    mapping(uint256 => uint256) private shareValues;
    ICapitalPool.PayoutData public lastPayout;
    ICapitalPool.PayoutData private _last_executePayout_payoutData;

    function last_executePayout_payoutData() external view returns (ICapitalPool.PayoutData memory) {
        return _last_executePayout_payoutData;
    }

    uint256 public executePayoutCallCount;

    // --- Constructor ---

    constructor(address _initialOwner, address _underlyingAsset) Ownable(_initialOwner) {
        require(_underlyingAsset != address(0), "MockCP: Invalid underlying asset");
        underlyingAssetToken = IERC20(_underlyingAsset);
    }

    // --- Mock Control Functions (Owner-only) ---

    /**
     * @notice Test-only function to control whether the next call to `applyLosses` reverts.
     */
    function setShouldRevertOnApplyLosses(bool _shouldRevert) external onlyOwner {
        shouldRevertOnApplyLosses = _shouldRevert;
        emit RevertOnApplyLossesSet(_shouldRevert);
    }

    // Dummy setter to mimic interface in tests
    function setUnderlyingAsset(address) external {}

    // --- Mocked Functions (Implementing the CapitalPool's external interface for RiskManager) ---

    /**
     * @notice Mocks the `applyLosses` function. Records arguments and emits an event.
     * @dev Will revert if `shouldRevertOnApplyLosses` is set to true.
     */
    function applyLosses(address _underwriter, uint256 _principalLossAmount) external {
        if (shouldRevertOnApplyLosses) {
            revert("MockCP: Deliberate revert from applyLosses");
        }

        last_applyLosses_underwriter = _underwriter;
        last_applyLosses_principalLossAmount = _principalLossAmount;
        applyLossesCallCount++;

        emit LossesAppliedCalled(_underwriter, _principalLossAmount);
    }

    /**
     * @notice Mocks the `underlyingAsset` view function.
     * @return The address of the underlying asset token.
     */
    function underlyingAsset() external view returns (IERC20) {
        return underlyingAssetToken;
    }

    // --- Mocked RiskManager Notification Callbacks ---
    // These functions exist on the REAL RiskManager, but we include them here
    // with events so we can test that the real CapitalPool calls them correctly.
    // In a test where this MockCapitalPool is used to test the RiskManager, these will NOT be called.

    function onCapitalDeposited(address _underwriter, uint256 _amount) external {
        emit RiskManagerNotifiedOfDeposit(_underwriter, _amount);
    }

    function onWithdrawalRequested(address, uint256) external {
        // In a real scenario, this might revert. In a mock, we can just let it pass.
    }

    function onCapitalWithdrawn(address _underwriter, uint256 _principal, bool _isFull) external {
        emit RiskManagerNotifiedOfWithdrawal(_underwriter, _principal, _isFull);
    }

    /* ----------------------- Additional Mock Helpers ----------------------- */

    function setUnderwriterAdapterAddress(address user, address adapter) external {
        adapterAddresses[user] = adapter;
    }

    function setUnderwriterAccount(address user, uint256 masterShares) external {
        accounts[user] = Account(0, 0, masterShares, 0, 0);
    }

    // Overloaded helper to mimic older interface used in tests
    function setUnderwriterAccount(address user, uint256 dummy1, uint256 masterShares, uint256 dummy3, uint256 dummy4)
        external
    {
        accounts[user] = Account(dummy1, 0, masterShares, dummy3, dummy4);
    }

    function setSharesToValue(uint256 shares, uint256 value) external {
        shareValues[shares] = value;
    }

    function getUnderwriterAdapterAddress(address user) external view returns (address) {
        return adapterAddresses[user];
    }

    function getUnderwriterAccount(address user) external view returns (uint256, uint8, uint256, uint256, uint256) {
        Account storage a = accounts[user];
        return (a.dummy1, a.dummy2, a.masterShares, a.dummy3, a.dummy4);
    }

    function sharesToValue(uint256 shares) external view returns (uint256) {
        return shareValues[shares];
    }

    function executePayout(ICapitalPool.PayoutData calldata payoutData) external {
        lastPayout = payoutData;
        _last_executePayout_payoutData = payoutData;
        executePayoutCallCount++;
    }

    // Helper functions to call RiskManager hooks from this contract
    function triggerOnCapitalDeposited(address rm, address u, uint256 amt) external {
        (bool ok,) = rm.call(abi.encodeWithSignature("onCapitalDeposited(address,uint256)", u, amt));
        require(ok, "call failed");
    }

    function triggerOnCapitalWithdrawn(address rm, address u, uint256 amt, bool full) external {
        (bool ok,) = rm.call(abi.encodeWithSignature("onCapitalWithdrawn(address,uint256,bool)", u, amt, full));
        require(ok, "call failed");
    }

    function triggerOnWithdrawalRequested(address rm, address u, uint256 amt) external {
        (bool ok,) = rm.call(abi.encodeWithSignature("onWithdrawalRequested(address,uint256)", u, amt));
        require(ok, "call failed");
    }

    function triggerOnWithdrawalCancelled(address rm, address u, uint256 amt) external {
        (bool ok,) = rm.call(abi.encodeWithSignature("onWithdrawalCancelled(address,uint256)", u, amt));
        require(ok, "call failed");
    }
}
