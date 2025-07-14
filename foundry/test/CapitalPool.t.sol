
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {MockYieldAdapter} from "contracts/test/MockYieldAdapter.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {MockRiskManager} from "contracts/test/MockRiskManager.sol";
import {IYieldAdapterEmergency} from "contracts/interfaces/IYieldAdapterEmergency.sol";


contract CapitalPoolFuzz is Test {
    CapitalPool pool;
    MockERC20 token;
    MockYieldAdapter adapter;
    MockRiskManager rm;

    address owner = address(this);
    // NEW: Define multiple users for better testing
    address userA = vm.addr(0xA);
    address userB = vm.addr(0xB);

    uint256 constant INITIAL_SUPPLY = 1_000_000e6;

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        // Mint to users as well
        token.mint(owner, INITIAL_SUPPLY);
        token.mint(userA, INITIAL_SUPPLY);
        token.mint(userB, INITIAL_SUPPLY);

        rm = new MockRiskManager();
        pool = new CapitalPool(owner, address(token));
        pool.setRiskManager(address(rm));
        pool.setUnderwriterNoticePeriod(0);

        adapter = new MockYieldAdapter(address(token), address(0), owner);
        adapter.setDepositor(address(pool));
        pool.setBaseYieldAdapter(CapitalPool.YieldPlatform.AAVE, address(adapter));

        // Approve for all actors
        vm.prank(owner);
        token.approve(address(pool), type(uint256).max);
        vm.prank(userA);
        token.approve(address(pool), type(uint256).max);
        vm.prank(userB);
        token.approve(address(pool), type(uint256).max);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* EXISTING TESTS (with minor improvements)          */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function testFuzz_depositWithdraw(uint96 amount) public {
        vm.assume(amount > 0 && amount < INITIAL_SUPPLY);
        
        vm.prank(userA);
        pool.deposit(amount, CapitalPool.YieldPlatform.AAVE);
        (uint256 principal,, uint256 shares,) = pool.getUnderwriterAccount(userA);
        assertEq(principal, amount);
        assertEq(shares, amount);

        vm.prank(userA);
        pool.requestWithdrawal(shares);
        vm.prank(userA);
        pool.executeWithdrawal(0);
        
        (principal,, shares,) = pool.getUnderwriterAccount(userA);
        assertEq(principal, 0);
        assertEq(shares, 0);
    }

    function testFuzz_multipleDeposits_twoUsers(uint96 amountA, uint96 amountB) public {
        vm.assume(amountA > 0 && amountB > 0);
        vm.assume(uint256(amountA) + uint256(amountB) < INITIAL_SUPPLY * 2);

        vm.prank(userA);
        pool.deposit(amountA, CapitalPool.YieldPlatform.AAVE);
        uint256 msBefore = pool.totalMasterSharesSystem();
        uint256 tvBefore = pool.totalSystemValue();

        vm.prank(userB);
        pool.deposit(amountB, CapitalPool.YieldPlatform.AAVE);

        uint256 expectedSharesB = (uint256(amountB) * msBefore) / tvBefore;
        (,, uint256 sharesA,) = pool.getUnderwriterAccount(userA);
        (,, uint256 sharesB,) = pool.getUnderwriterAccount(userB);

        assertEq(sharesA, amountA);
        assertEq(sharesB, expectedSharesB);
    }

    function testFuzz_applyLosses(uint96 depositAmount, uint96 loss) public {
        vm.assume(depositAmount > 0 && depositAmount < INITIAL_SUPPLY);
        vm.assume(loss > 0 && loss <= depositAmount);

        vm.prank(userA);
        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);
        
        vm.prank(address(rm));
        pool.applyLosses(userA, loss);

        (uint256 principal,, uint256 shares,) = pool.getUnderwriterAccount(userA);
        uint256 expected = depositAmount - loss;
        assertEq(principal, expected);
        assertEq(shares, expected);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* NEW COMPREHENSIVE TESTS                           */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function test_executePayout() public {
        // --- Setup: Two users deposit into two different adapters ---
        MockYieldAdapter adapterB = new MockYieldAdapter(address(token), address(0), owner);
        adapterB.setDepositor(address(pool));
        pool.setBaseYieldAdapter(CapitalPool.YieldPlatform.COMPOUND, address(adapterB));

        vm.prank(userA);
        pool.deposit(60_000e6, CapitalPool.YieldPlatform.AAVE); // 60% of capital
        vm.prank(userB);
        pool.deposit(40_000e6, CapitalPool.YieldPlatform.COMPOUND); // 40% of capital

        // --- Prepare PayoutData ---
        CapitalPool.PayoutData memory payout;
        payout.claimant = vm.addr(0xC);
        payout.feeRecipient = vm.addr(0xD);
        payout.claimantAmount = 8_000e6;
        payout.feeAmount = 2_000e6;
        payout.totalCapitalFromPoolLPs = 100_000e6;
        address[] memory adapters = new address[](2);
        adapters[0] = address(adapter);
        adapters[1] = address(adapterB);
        payout.adapters = adapters;
        uint256[] memory capitalPerAdapter = new uint256[](2);
        capitalPerAdapter[0] = 60_000e6; // Adapter A has 60k
        capitalPerAdapter[1] = 40_000e6; // Adapter B has 40k
        payout.capitalPerAdapter = capitalPerAdapter;
        
        // --- Action ---
        vm.prank(address(rm));
        pool.executePayout(payout);

        // --- Assert ---
        // Total payout is 10k. 6k from adapter A, 4k from adapter B.
        assertEq(adapter.withdrawCallCount(), 1);
        assertEq(adapter.last_withdraw_amount(), 6_000e6); // 10k * (60k/100k)
        assertEq(adapterB.withdrawCallCount(), 1);
        assertEq(adapterB.last_withdraw_amount(), 4_000e6); // 10k * (40k/100k)

        assertEq(token.balanceOf(payout.claimant), payout.claimantAmount);
        assertEq(token.balanceOf(payout.feeRecipient), payout.feeAmount);
        assertEq(pool.totalSystemValue(), 100_000e6 - 10_000e6);
    }
    
    function test_syncYield_handlesAdapterFailure() public {
        vm.prank(userA);
        pool.deposit(10_000e6, CapitalPool.YieldPlatform.AAVE);
        
        // Setup a second, healthy adapter
        MockYieldAdapter adapterB = new MockYieldAdapter(address(token), address(0), owner);
        adapterB.setDepositor(address(pool));
        pool.setBaseYieldAdapter(CapitalPool.YieldPlatform.COMPOUND, address(adapterB));
        vm.prank(userB);
        pool.deposit(5_000e6, CapitalPool.YieldPlatform.COMPOUND);

        // Make the first adapter revert on the next call
        adapter.setShouldRevert(true);
        
        // Action: sync should not revert, it should just skip the failing adapter
        vm.expectEmit(true, true, false, true);
        emit CapitalPool.AdapterCallFailed(address(adapter), "getCurrentValueHeld", "MockAdapter: Deliberate revert");
        pool.syncYieldAndAdjustSystemValue();

        // Assert: totalSystemValue should equal the value from the healthy adapter only
        assertEq(pool.totalSystemValue(), 5_000e6, "System value should only reflect the healthy adapter");
    }

    function test_applyLosses_wipesOutAccountAndRequests() public {
        uint96 depositAmount = 10_000e6;
        vm.prank(userA);
        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);
        vm.prank(userA);
        pool.requestWithdrawal(2_000e6);

        vm.prank(address(rm));
        pool.applyLosses(userA, depositAmount); // Loss equal to entire deposit

        (uint256 p, , uint256 s, uint256 pend) = pool.getUnderwriterAccount(userA);
        assertEq(p, 0, "Principal should be 0");
        assertEq(s, 0, "Shares should be 0");
        assertEq(pend, 0, "Pending shares should be 0");
        assertEq(pool.getWithdrawalRequestCount(userA), 0, "Requests should be deleted");
    }

    function test_cancelWithdrawalRequest() public {
        uint96 amount = 10_000e6;
        vm.prank(userA);
        pool.deposit(amount, CapitalPool.YieldPlatform.AAVE);
        
        vm.prank(userA);
        pool.requestWithdrawal(2_000e6); // index 0
        vm.prank(userA);
        pool.requestWithdrawal(3_000e6); // index 1
        
        assertEq(pool.getWithdrawalRequestCount(userA), 2);
        
        vm.prank(userA);
        vm.expectEmit(true, true, true, true);
        emit CapitalPool.WithdrawalRequestCancelled(userA, 2_000e6, 0);
        pool.cancelWithdrawalRequest(0);

        assertEq(pool.getWithdrawalRequestCount(userA), 1);
        (uint256 shares, ) = pool.withdrawalRequests(userA, 0);
        assertEq(shares, 3_000e6, "The wrong request was removed");
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* REVERT TESTS                                   */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/
    
    function testRevert_deposit_noSharesToMint() public {
        vm.prank(userA);
        pool.deposit(1_000_000e6, CapitalPool.YieldPlatform.AAVE); // Large initial deposit

        // A second deposit of 1 wei should result in 0 shares, causing a revert
        vm.prank(userB);
        vm.expectRevert(CapitalPool.NoSharesToMint.selector);
        pool.deposit(1, CapitalPool.YieldPlatform.AAVE);
    }

    function testRevert_requestWithdrawal_ifExceedsTotalShares() public {
        uint96 depositAmount = 10_000e6;
        vm.prank(userA);
        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);
        
        vm.prank(userA);
        pool.requestWithdrawal(8_000e6);

        vm.prank(userA);
        vm.expectRevert(CapitalPool.InsufficientShares.selector);
        pool.requestWithdrawal(3_000e6); // 8k + 3k > 10k
    }

    function testRevert_executeWithdrawal_ifNoticePeriodActive() public {
        uint256 noticePeriod = 7 days;
        pool.setUnderwriterNoticePeriod(noticePeriod);
        
        vm.prank(userA);
        pool.deposit(10_000e6, CapitalPool.YieldPlatform.AAVE);
        vm.prank(userA);
        pool.requestWithdrawal(5_000e6);

        vm.prank(userA);
        vm.expectRevert(CapitalPool.NoticePeriodActive.selector);
        pool.executeWithdrawal(0);
        
        vm.warp(block.timestamp + noticePeriod + 1);
        
        vm.prank(userA);
        pool.executeWithdrawal(0); // Should now succeed
    }

    function testRevert_deposit_onChangeOfYieldPlatform() public {
        vm.prank(userA);
        pool.deposit(10_000e6, CapitalPool.YieldPlatform.AAVE);

        MockYieldAdapter anotherAdapter = new MockYieldAdapter(address(token), address(0), owner);
        anotherAdapter.setDepositor(address(pool));
        pool.setBaseYieldAdapter(CapitalPool.YieldPlatform.COMPOUND, address(anotherAdapter));

        vm.prank(userA);
        vm.expectRevert("CP: Cannot change yield platform; withdraw first.");
        pool.deposit(5_000e6, CapitalPool.YieldPlatform.COMPOUND);
    }
// Add these new tests to your existing test file.

    function test_executePayout_withEmergencyFallback() public {
        // --- Setup ---
        // User A deposits into an adapter that will fail its primary withdraw
        adapter.setShouldRevert(true);
        vm.prank(userA);
        pool.deposit(100_000e6, CapitalPool.YieldPlatform.AAVE);

        // --- Prepare PayoutData ---
        CapitalPool.PayoutData memory payout;
        payout.claimant = vm.addr(0xC);
        payout.claimantAmount = 10_000e6;
        payout.totalCapitalFromPoolLPs = 100_000e6;
        address[] memory adapters = new address[](1);
        adapters[0] = address(adapter);
        payout.adapters = adapters;
        uint256[] memory capitalPerAdapter = new uint256[](1);
        capitalPerAdapter[0] = 100_000e6;
        payout.capitalPerAdapter = capitalPerAdapter;
        
        // --- Action ---
        // The pool will try adapter.withdraw(), fail, then call adapter.emergencyTransfer()
        vm.prank(address(rm));
        pool.executePayout(payout);

        // --- Assert ---
        assertEq(adapter.withdrawCallCount(), 1, "withdraw should have been attempted");
        assertEq(adapter.emergencyTransferCallCount(), 1, "emergencyTransfer should have been called");
        assertEq(adapter.last_emergencyTransfer_amount(), 10_000e6, "emergencyTransfer amount is incorrect");
        assertEq(token.balanceOf(payout.claimant), 10_000e6, "Claimant did not receive funds");
    }

    function testFuzz_syncYield_withLoss(uint96 depositAmount, uint96 loss) public {
        vm.assume(depositAmount > 0 && loss > 0 && loss < depositAmount);
        vm.prank(userA);
        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);

        // Simulate a loss in the adapter
        token.transfer(address(adapter), loss); // Ensure adapter has tokens to "lose"
        adapter.simulateYieldOrLoss(-int256(uint256(loss)));
        
        pool.syncYieldAndAdjustSystemValue();
        
        assertEq(pool.totalSystemValue(), depositAmount - loss);
    }

    function testRevert_executeWithdrawal_invalidIndex() public {
        vm.prank(userA);
        pool.deposit(10_000e6, CapitalPool.YieldPlatform.AAVE);
        vm.prank(userA);
        pool.requestWithdrawal(1_000e6);
        
        // Try to execute a request at an index that doesn't exist
        vm.prank(userA);
        vm.expectRevert(CapitalPool.InvalidRequestIndex.selector);
        pool.executeWithdrawal(1);
    }
}