// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {MockRiskManager} from "contracts/test/MockRiskManager.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";
import {MockBackstopPool} from "contracts/test/MockBackstopPool.sol";
import {MockUnderwriterManager} from "contracts/test/MockUnderwriterManager.sol"; // FIX: Import the mock
import {IYieldAdapterEmergency} from "contracts/interfaces/IYieldAdapterEmergency.sol";
import {ICapitalPool, YieldPlatform} from "contracts/interfaces/ICapitalPool.sol";
import {IYieldAdapter} from "contracts/interfaces/IYieldAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";


/// @dev A self-contained mock yield adapter for testing purposes.
contract MockYieldAdapter is IYieldAdapter {
    IERC20 public immutable underlyingAsset;
    address public depositor;
    address public owner;
    uint256 public _valueHeld;

    uint256 public depositCallCount;
    uint256 public withdrawCallCount;
    uint256 public last_withdraw_amount;
    address public last_withdraw_recipient;

    constructor(IERC20 _token, address _depositor, address _owner) {
        underlyingAsset = _token;
        depositor = _depositor;
        owner = _owner;
    }

    function asset() external view virtual override returns (IERC20) {
        return underlyingAsset;
    }

    function setDepositor(address _depositor) external {
        depositor = _depositor;
    }

    function getCurrentValueHeld() external view virtual override returns (uint256) {
        return _valueHeld;
    }

    function deposit(uint256 amount) external virtual override {
        require(msg.sender == depositor, "MockAdapter: Invalid depositor");
        _valueHeld += amount;
        depositCallCount++;
    }

    function withdraw(uint256 amount, address recipient) public virtual override returns (uint256) {
        require(underlyingAsset.balanceOf(address(this)) >= amount, "MockAdapter: Insufficient funds");
        if (_valueHeld < amount) {
             _valueHeld = 0;
        } else {
            _valueHeld -= amount;
        }
        withdrawCallCount++;
        last_withdraw_amount = amount;
        last_withdraw_recipient = recipient;
        underlyingAsset.transfer(recipient, amount);
        return amount;
    }

    function simulateYieldOrLoss(int256 amount) external {
        if (amount >= 0) {
            _valueHeld += uint256(amount);
        } else {
            uint256 lossAmount = uint256(-amount);
            if (_valueHeld >= lossAmount) {
                _valueHeld -= lossAmount;
            } else {
                _valueHeld = 0;
            }
        }
    }
}


/// @dev A special mock adapter that can be configured to fail.
contract MockRevertingYieldAdapter is MockYieldAdapter, IYieldAdapterEmergency {
    bool public withdrawWillFail;
    bool public emergencyTransferWillFail;

    constructor(IERC20 token, address depositor, address owner) MockYieldAdapter(token, depositor, owner) {}

    function setWithdrawWillFail(bool _willFail) external {
        withdrawWillFail = _willFail;
    }

    function setEmergencyTransferWillFail(bool _willFail) external {
        emergencyTransferWillFail = _willFail;
    }

    function withdraw(uint256 amount, address recipient) public override returns (uint256) {
        if (withdrawWillFail) {
            revert("Simulated withdraw failure");
        }
        return super.withdraw(amount, recipient);
    }

    function emergencyTransfer(address recipient, uint256 amount) external override returns (uint256) {
        if (emergencyTransferWillFail) {
            revert("Simulated emergency transfer failure");
        }
        if (withdrawWillFail) {
            return 0;
        }
        require(underlyingAsset.balanceOf(address(this)) >= amount, "MockAdapter: Insufficient funds for emergency transfer");
        if (_valueHeld < amount) {
             _valueHeld = 0;
        } else {
            _valueHeld -= amount;
        }
        underlyingAsset.transfer(recipient, amount);
        return amount;
    }
}


contract CapitalPoolTest is Test {
    // --- Contracts and Mocks ---
    CapitalPool pool;
    MockERC20 token;
    MockYieldAdapter adapter;
    MockRiskManager rm;
    MockRewardDistributor rd;
    MockBackstopPool catPool;
    MockUnderwriterManager um; // FIX: Added UnderwriterManager mock

    // --- Actors ---
    address owner = address(this);
    address userA = vm.addr(0xA);
    address userB = vm.addr(0xB);
    address harvester = vm.addr(0x48);
    address unauthorizedUser = vm.addr(0xBAD);

    uint256 constant INITIAL_SUPPLY = 1_000_000e6;
    uint256 constant INITIAL_SHARES_LOCKED = 1000;

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        token.mint(owner, INITIAL_SUPPLY);
        token.mint(userA, INITIAL_SUPPLY);
        token.mint(userB, INITIAL_SUPPLY);

        rm = new MockRiskManager();
        rd = new MockRewardDistributor();
        catPool = new MockBackstopPool(owner);
        rm.setCatPool(address(catPool));
        um = new MockUnderwriterManager(); // FIX: Deploy the mock

        pool = new CapitalPool(owner, address(token));
        pool.setRiskManager(address(rm));
        pool.setRewardDistributor(address(rd));
        pool.setUnderwriterManager(address(um)); // FIX: Set the address in the CapitalPool
        pool.setUnderwriterNoticePeriod(0);

        adapter = new MockYieldAdapter(token, address(pool), owner);
        token.mint(address(adapter), INITIAL_SUPPLY * 2);

        pool.setBaseYieldAdapter(YieldPlatform.AAVE, address(adapter));

        vm.startPrank(userA);
        token.approve(address(pool), type(uint256).max);
        vm.stopPrank();
        
        vm.startPrank(userB);
        token.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* CORE FUNCTION TESTS                               */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function test_deposit_and_full_withdraw() public {
        uint256 depositAmount = 10_000e6;
        
        vm.prank(userA);
        vm.expectEmit(true, true, true, true);
        emit CapitalPool.Deposit(userA, depositAmount, depositAmount, YieldPlatform.AAVE);
        pool.deposit(depositAmount, YieldPlatform.AAVE);

        (uint256 principal, , uint256 shares, ) = pool.getUnderwriterAccount(userA);
        assertEq(principal, depositAmount, "Principal mismatch after deposit");
        assertEq(shares, depositAmount, "Shares mismatch after deposit");
        assertEq(pool.totalSystemValue(), depositAmount, "Total system value incorrect");
        assertEq(pool.totalMasterSharesSystem(), depositAmount + INITIAL_SHARES_LOCKED, "Total shares incorrect");
        assertEq(pool.principalInAdapter(address(adapter)), depositAmount, "Principal in adapter not tracked");
        assertEq(rd.updateUserStateCallCount(), 1, "updateUserState should be called on deposit");
        assertEq(rd.last_updateUserState_user(), userA, "Incorrect user for updateUserState");

        vm.prank(userA);
        pool.requestWithdrawal(shares);
        
        vm.prank(userA);
        vm.expectEmit(true, true, true, true);
        emit CapitalPool.WithdrawalExecuted(userA, depositAmount, shares, 0);
        pool.executeWithdrawal(0);
        
        (principal, , shares, ) = pool.getUnderwriterAccount(userA);
        assertEq(principal, 0, "Principal should be 0 after full withdrawal");
        assertEq(shares, 0, "Shares should be 0 after full withdrawal");
        assertEq(pool.getUnderwriterAdapterAddress(userA), address(0), "Account not deleted");

        assertEq(pool.principalInAdapter(address(adapter)), 0, "Principal in adapter should be 0");
        assertEq(pool.totalSystemValue(), 0, "Total system value should be 0");
        assertEq(pool.totalMasterSharesSystem(), INITIAL_SHARES_LOCKED, "Total shares should be reset");
        assertEq(rd.updateUserStateCallCount(), 2, "updateUserState should be called on withdrawal");
    }

    function test_partial_withdraw() public {
        uint256 depositAmount = 10_000e6;
        uint256 withdrawShares = 4_000e6;

        vm.prank(userA);
        pool.deposit(depositAmount, YieldPlatform.AAVE);
        
        vm.prank(userA);
        pool.requestWithdrawal(withdrawShares);

        uint256 withdrawValue = pool.sharesToValue(withdrawShares);

        vm.prank(userA);
        pool.executeWithdrawal(0);

        (uint256 principal, , uint256 shares, ) = pool.getUnderwriterAccount(userA);
        uint256 expectedPrincipal = depositAmount - withdrawValue;
        uint256 expectedShares = depositAmount - withdrawShares;

        assertEq(principal, expectedPrincipal, "Principal incorrect after partial withdrawal");
        assertEq(shares, expectedShares, "Shares incorrect after partial withdrawal");
        assertEq(pool.principalInAdapter(address(adapter)), expectedPrincipal, "Adapter principal incorrect");
        assertEq(token.balanceOf(userA), INITIAL_SUPPLY - depositAmount + withdrawValue, "User balance incorrect");
    }

    function test_applyLosses_partial() public {
        uint256 depositAmount = 20_000e6;
        uint256 lossAmount = 5_000e6;

        vm.prank(userA);
        pool.deposit(depositAmount, YieldPlatform.AAVE);
        
        // FIX: Prank as the UnderwriterManager, not the RiskManager
        vm.prank(address(um));
        vm.expectEmit(true, true, true, true);
        emit CapitalPool.LossesApplied(userA, lossAmount, false);
        pool.applyLosses(userA, lossAmount);

        (uint256 principal, , uint256 shares, ) = pool.getUnderwriterAccount(userA);
        uint256 expectedPrincipal = depositAmount - lossAmount;
        uint256 expectedShares = depositAmount;
        
        assertEq(principal, expectedPrincipal, "Principal not reduced correctly after loss");
        assertEq(shares, expectedShares, "Shares should not change after loss");
        assertEq(pool.principalInAdapter(address(adapter)), expectedPrincipal, "Principal in adapter not reduced after loss");
        assertEq(rd.updateUserStateCallCount(), 2, "updateUserState should be called on applyLosses");
    }

    function test_applyLosses_fullWipeout() public {
        uint256 depositAmount = 20_000e6;
        uint256 lossAmount = 25_000e6;

        vm.prank(userA);
        pool.deposit(depositAmount, YieldPlatform.AAVE);
        
        // FIX: Prank as the UnderwriterManager, not the RiskManager
        vm.prank(address(um));
        vm.expectEmit(true, true, true, true);
        emit CapitalPool.LossesApplied(userA, depositAmount, true);
        pool.applyLosses(userA, lossAmount);

        (uint256 principal, , uint256 shares, ) = pool.getUnderwriterAccount(userA);
        assertEq(principal, 0, "Principal should be 0 after wipeout");
        assertEq(shares, 0, "Shares should be 0 after wipeout");
        assertEq(pool.getUnderwriterAdapterAddress(userA), address(0), "User account not deleted after wipeout");
        assertEq(pool.principalInAdapter(address(adapter)), 0, "Adapter principal should be 0 after wipeout");
        assertEq(pool.totalSystemValue(), 0, "System value should be 0 after wipeout");
    }

    function test_cancelWithdrawalRequest() public {
        uint96 amount = 10_000e6;
        vm.prank(userA);
        pool.deposit(amount, YieldPlatform.AAVE);
        
        vm.prank(userA);
        pool.requestWithdrawal(2_000e6);
        vm.prank(userA);
        pool.requestWithdrawal(3_000e6);
        
        assertEq(pool.getWithdrawalRequestCount(userA), 2);
        (,, , uint256 pendingSharesBefore) = pool.getUnderwriterAccount(userA);
        assertEq(pendingSharesBefore, 5_000e6);
        
        vm.prank(userA);
        vm.expectEmit(true, true, true, true);
        emit CapitalPool.WithdrawalRequestCancelled(userA, 2_000e6, 0);
        pool.cancelWithdrawalRequest(0);

        assertEq(pool.getWithdrawalRequestCount(userA), 1, "Request count not updated");
        (uint256 shares, ) = pool.withdrawalRequests(userA, 0);
        assertEq(shares, 3_000e6, "The wrong request was removed");
        (,, , uint256 pendingSharesAfter) = pool.getUnderwriterAccount(userA);
        assertEq(pendingSharesAfter, 3_000e6, "Pending shares not updated");
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* YIELD & PAYOUT TESTS                              */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function test_harvestAndDistributeYield_succeeds() public {
        uint256 depositAmount = 50_000e6;
        uint256 yieldAmount = 5_000e6;

        vm.prank(userA);
        pool.deposit(depositAmount, YieldPlatform.AAVE);
        
        token.transfer(address(adapter), yieldAmount);
        adapter.simulateYieldOrLoss(int256(yieldAmount));

        vm.prank(harvester);
        vm.expectEmit(true, true, true, true);
        emit CapitalPool.YieldHarvested(address(adapter), yieldAmount);
        pool.harvestAndDistributeYield(address(adapter));

        assertEq(adapter.withdrawCallCount(), 1);
        assertEq(adapter.last_withdraw_amount(), yieldAmount);
        assertEq(token.balanceOf(address(rd)), yieldAmount);
        assertEq(rd.distributeCallCount(), 1);
    }

    function test_executePayout_adapterFailure_fallbackToCatPool() public {
        MockRevertingYieldAdapter adapterB = new MockRevertingYieldAdapter(token, address(pool), owner);
        token.mint(address(adapterB), INITIAL_SUPPLY);
        pool.setBaseYieldAdapter(YieldPlatform.COMPOUND, address(adapterB));
        adapterB.setWithdrawWillFail(true);
        adapterB.setEmergencyTransferWillFail(false);

        vm.prank(userA);
        pool.deposit(40_000e6, YieldPlatform.COMPOUND);

        CapitalPool.PayoutData memory payout;
        payout.claimant = vm.addr(0xC);
        payout.feeRecipient = vm.addr(0xD);
        payout.claimantAmount = 8_000e6;
        payout.feeAmount = 2_000e6;
        payout.totalCapitalFromPoolLPs = 40_000e6;
        address[] memory adapters = new address[](1);
        adapters[0] = address(adapterB);
        payout.adapters = adapters;
        uint256[] memory capitalPerAdapter = new uint256[](1);
        capitalPerAdapter[0] = 40_000e6;
        payout.capitalPerAdapter = capitalPerAdapter;
        
        vm.prank(address(rm));
        vm.expectEmit(true, true, true, true);
        emit CapitalPool.AdapterCallFailed(address(adapterB), "withdraw", "withdraw failed");
        pool.executePayout(payout);

        assertEq(catPool.drawFundCallCount(), 1, "drawFund should have been called");
        assertEq(catPool.last_drawFund_amount(), 10_000e6, "Incorrect amount drawn from cat pool");

        assertEq(token.balanceOf(payout.claimant), payout.claimantAmount);
        assertEq(token.balanceOf(payout.feeRecipient), payout.feeAmount);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* MULTI-USER & SHARE PRICE TESTS                    */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function test_multiUser_sharePriceChangesWithLoss() public {
        uint256 userADeposit = 100_000e6;
        uint256 userBDeposit = 100_000e6;

        vm.prank(userA);
        pool.deposit(userADeposit, YieldPlatform.AAVE);
        assertEq(pool.sharesToValue(1e6), 1e6, "Share price should be 1:1 initially");

        uint256 lossAmount = 10_000e6;
        // FIX: Prank as the UnderwriterManager, not the RiskManager
        vm.prank(address(um));
        pool.applyLosses(userA, lossAmount);
        
        assertLt(pool.sharesToValue(1e6), 1e6, "Share price should decrease after loss");

        uint256 sharesForB_before = pool.valueToShares(userBDeposit);
        assertTrue(sharesForB_before > userBDeposit, "User B should get more shares for the same value after a loss");

        vm.prank(userB);
        pool.deposit(userBDeposit, YieldPlatform.AAVE);
        (, , uint256 userBShares_after, ) = pool.getUnderwriterAccount(userB);
        assertEq(userBShares_after, sharesForB_before, "User B did not receive the correct number of shares");
    }


    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* REVERT & ACCESS CONTROL TESTS                     */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function testRevert_allSetters_ifNotOwner() public {
        vm.prank(unauthorizedUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, unauthorizedUser));
        pool.setRiskManager(address(0x1));
        
        vm.prank(unauthorizedUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, unauthorizedUser));
        pool.setRewardDistributor(address(0x1));
        
        vm.prank(unauthorizedUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, unauthorizedUser));
        pool.setUnderwriterNoticePeriod(1);
        
        vm.prank(unauthorizedUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, unauthorizedUser));
        pool.setBaseYieldAdapter(YieldPlatform.COMPOUND, address(adapter));
    }

    // FIX: Split the original test into two clearer, more accurate tests.
    function testRevert_applyLosses_ifNotUnderwriterManager() public {
        vm.prank(unauthorizedUser);
        vm.expectRevert("CP: Caller is not the UnderwriterManager");
        pool.applyLosses(userA, 1);
    }

    function testRevert_executePayout_ifNotRiskManager() public {
        CapitalPool.PayoutData memory payout; // Dummy data
        vm.prank(unauthorizedUser);
        vm.expectRevert("CP: Caller is not the RiskManager");
        pool.executePayout(payout);
    }

    function testRevert_deposit_ifZeroAmount() public {
        vm.prank(userA);
        vm.expectRevert(CapitalPool.InvalidAmount.selector);
        pool.deposit(0, YieldPlatform.AAVE);
    }

    function testRevert_deposit_ifChangeYieldPlatform() public {
        vm.prank(userA);
        pool.deposit(10_000e6, YieldPlatform.AAVE);

        MockYieldAdapter adapterB = new MockYieldAdapter(token, address(pool), owner);
        pool.setBaseYieldAdapter(YieldPlatform.COMPOUND, address(adapterB));

        vm.prank(userA);
        vm.expectRevert("CP: Cannot change yield platform; withdraw first.");
        pool.deposit(1_000e6, YieldPlatform.COMPOUND);
    }

    function testRevert_executeWithdrawal_ifNoticePeriodActive() public {
        uint256 noticePeriod = 7 days;
        pool.setUnderwriterNoticePeriod(noticePeriod);
        
        vm.prank(userA);
        pool.deposit(10_000e6, YieldPlatform.AAVE);
        vm.prank(userA);
        pool.requestWithdrawal(5_000e6);

        vm.prank(userA);
        vm.expectRevert(CapitalPool.NoticePeriodActive.selector);
        pool.executeWithdrawal(0);
        
        vm.warp(block.timestamp + noticePeriod + 1);
        
        vm.prank(userA);
        pool.executeWithdrawal(0);
        assertEq(token.balanceOf(userA), INITIAL_SUPPLY - 10_000e6 + 5_000e6);
    }

    function testRevert_cancelWithdrawal_ifInvalidIndex() public {
        vm.prank(userA);
        pool.deposit(10_000e6, YieldPlatform.AAVE);
        vm.prank(userA);
        pool.requestWithdrawal(5_000e6);

        vm.prank(userA);
        vm.expectRevert(CapitalPool.InvalidRequestIndex.selector);
        pool.cancelWithdrawalRequest(1);
    }
}