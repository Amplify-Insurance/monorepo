// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {MockYieldAdapter} from "contracts/test/MockYieldAdapter.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {MockRiskManager} from "contracts/test/MockRiskManager.sol";

contract CapitalPoolFuzz is Test {
    CapitalPool pool;
    MockERC20 token;
    MockYieldAdapter adapter;
    MockRiskManager rm;

    uint256 constant INITIAL_SUPPLY = 1_000_000e6; // 1 million tokens with 6 decimals

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        token.mint(address(this), INITIAL_SUPPLY);
        rm = new MockRiskManager();
        pool = new CapitalPool(address(this), address(token));
        pool.setRiskManager(address(rm));
        pool.setUnderwriterNoticePeriod(0);
        adapter = new MockYieldAdapter(address(token), address(0), address(this));
        adapter.setDepositor(address(pool));
        pool.setBaseYieldAdapter(CapitalPool.YieldPlatform.AAVE, address(adapter));
        token.approve(address(pool), type(uint256).max);
    }

    function testFuzz_depositWithdraw(uint96 amount) public {
        vm.assume(amount > 0 && amount < INITIAL_SUPPLY);
        pool.deposit(amount, CapitalPool.YieldPlatform.AAVE);
        (uint256 principal,, uint256 shares,) = pool.getUnderwriterAccount(address(this));
        assertEq(principal, amount);
        assertEq(shares, amount);

        pool.requestWithdrawal(shares);
        pool.executeWithdrawal(0);

        (principal,, shares,) = pool.getUnderwriterAccount(address(this));
        assertEq(principal, 0);
        assertEq(shares, 0);
        assertEq(token.balanceOf(address(this)) + adapter.totalValueHeld(), INITIAL_SUPPLY);
        assertEq(pool.totalSystemValue(), adapter.totalValueHeld());
    }

    function testFuzz_multipleDeposits(uint96 first, uint96 second) public {
        vm.assume(first > 0 && second > 0);
        vm.assume(uint256(first) + uint256(second) < INITIAL_SUPPLY);

        pool.deposit(first, CapitalPool.YieldPlatform.AAVE);
        uint256 msBefore = pool.totalMasterSharesSystem();
        uint256 tvBefore = pool.totalSystemValue();

        pool.deposit(second, CapitalPool.YieldPlatform.AAVE);

        uint256 expectedSharesSecond = (second * msBefore) / tvBefore;
        (,, uint256 shares,) = pool.getUnderwriterAccount(address(this));
        assertEq(shares, first + expectedSharesSecond);
        assertEq(pool.totalSystemValue(), first + second);
    }

    function testFuzz_depositWithYield(uint96 depositAmount, uint96 secondDeposit, uint96 yieldGain) public {
        vm.assume(depositAmount > 0 && secondDeposit > 0);
        vm.assume(uint256(depositAmount) + uint256(secondDeposit) + uint256(yieldGain) < INITIAL_SUPPLY);

        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);

        token.mint(address(adapter), yieldGain);
        adapter.simulateYieldOrLoss(int256(uint256(yieldGain)));
        pool.syncYieldAndAdjustSystemValue();

        uint256 msBefore = pool.totalMasterSharesSystem();
        uint256 tvBefore = pool.totalSystemValue();
        uint256 expectedShares = (uint256(secondDeposit) * msBefore) / tvBefore;
        vm.assume(expectedShares > 0);
        pool.deposit(secondDeposit, CapitalPool.YieldPlatform.AAVE);

        (,, uint256 shares,) = pool.getUnderwriterAccount(address(this));
        assertEq(shares, depositAmount + expectedShares);
        assertEq(pool.totalSystemValue(), depositAmount + secondDeposit + yieldGain);
    }

    function testFuzz_applyLosses(uint96 depositAmount, uint96 loss) public {
        vm.assume(depositAmount > 0 && depositAmount < INITIAL_SUPPLY);
        vm.assume(loss > 0 && loss <= depositAmount);

        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);

        vm.prank(address(rm));
        pool.applyLosses(address(this), loss);

        (uint256 principal,, uint256 shares,) = pool.getUnderwriterAccount(address(this));
        uint256 expected = depositAmount - loss;
        assertEq(principal, expected);
        assertEq(shares, expected);
        assertEq(pool.totalSystemValue(), expected);
    }

    function testFuzz_partialWithdrawalWithYield(uint96 depositAmount, uint96 withdrawShares, uint96 yieldGain)
        public
    {
        vm.assume(depositAmount > 0 && withdrawShares > 0);
        vm.assume(withdrawShares <= depositAmount);
        vm.assume(uint256(depositAmount) + uint256(yieldGain) < INITIAL_SUPPLY);

        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);

        token.mint(address(adapter), yieldGain);
        adapter.simulateYieldOrLoss(int256(uint256(yieldGain)));
        pool.syncYieldAndAdjustSystemValue();

        pool.requestWithdrawal(withdrawShares);
        uint256 expectedValue = pool.sharesToValue(withdrawShares);
        pool.executeWithdrawal(0);

        (uint256 principal,, uint256 shares,) = pool.getUnderwriterAccount(address(this));
        assertEq(principal, depositAmount - withdrawShares);
        assertEq(shares, depositAmount - withdrawShares);
        assertEq(pool.totalSystemValue(), depositAmount + yieldGain - expectedValue);
    }


    function test_cancelWithdrawalRequest() public {
    // --- Setup ---
    uint96 depositAmount = 10_000e6;
    uint96 requestAmount1 = 2_000e6;
    uint96 requestAmount2 = 3_000e6;
    pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);

    // Make two withdrawal requests
    pool.requestWithdrawal(requestAmount1);
    pool.requestWithdrawal(requestAmount2);

    assertEq(pool.getWithdrawalRequestCount(address(this)), 2);
    (,,,uint256 pendingShares) = pool.getUnderwriterAccount(address(this));
    assertEq(pendingShares, requestAmount1 + requestAmount2);

    // --- Action ---
    // Cancel the FIRST request (at index 0)
    pool.cancelWithdrawalRequest(0);

    // --- Assertions ---
    // 1. The number of requests should be 1
    assertEq(pool.getWithdrawalRequestCount(address(this)), 1);

    // 2. The total pending shares should be reduced
    (,,,pendingShares) = pool.getUnderwriterAccount(address(this));
    assertEq(pendingShares, requestAmount2, "Pending shares should only equal the remaining request");

    // 3. The remaining request (originally at index 1) should now be at index 0
    (uint256 shares, ) = pool.withdrawalRequests(address(this), 0);
    assertEq(shares, requestAmount2, "The wrong request was removed from the array");
}

function test_executeWithdrawal_outOfOrder() public {
    // --- Setup ---
    uint96 depositAmount = 10_000e6;
    uint96 requestAmount1 = 1_000e6;
    uint96 requestAmount2 = 2_500e6; // This is the request we will execute
    uint96 requestAmount3 = 4_000e6;
    pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);

    // 1. Make three separate withdrawal requests
    pool.requestWithdrawal(requestAmount1); // index 0
    pool.requestWithdrawal(requestAmount2); // index 1
    pool.requestWithdrawal(requestAmount3); // index 2

    assertEq(pool.getWithdrawalRequestCount(address(this)), 3, "Should have 3 pending requests initially");

    // --- Action ---
    // 2. Execute the request from the MIDDLE of the array (index 1)
    pool.executeWithdrawal(1);

    // --- Assertions ---
    // 3. Check that the request count has decreased
    assertEq(pool.getWithdrawalRequestCount(address(this)), 2, "Should have 2 pending requests after execution");

    // 4. Check that the user's shares were correctly burned
    (,, uint256 shares,) = pool.getUnderwriterAccount(address(this));
    assertEq(shares, depositAmount - requestAmount2, "User shares were not reduced correctly");

    // 5. Verify the swap-and-pop: The request originally at the end (index 2) should now be at the executed slot (index 1)
    (uint256 sharesAtIndex1, ) = pool.withdrawalRequests(address(this), 1);
    assertEq(sharesAtIndex1, requestAmount3, "The last request should have been moved to the executed slot");

    // 6. Verify the first request (index 0) was untouched
    (uint256 sharesAtIndex0, ) = pool.withdrawalRequests(address(this), 0);
    assertEq(sharesAtIndex0, requestAmount1, "The request at index 0 should be unchanged");
}

function test_requestWithdrawal_reverts_ifExceedsTotalShares() public {
    // --- Setup ---
    uint96 depositAmount = 10_000e6;
    pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);

    // 1. Request a withdrawal for a large portion of the shares
    uint96 firstRequestAmount = 8_000e6;
    pool.requestWithdrawal(firstRequestAmount);

    (,,, uint256 pendingShares) = pool.getUnderwriterAccount(address(this));
    assertEq(pendingShares, firstRequestAmount);

    // --- Action & Assertion ---
    // 2. Attempt to request more shares, such that the sum of pending requests
    //    would exceed the user's total shares (8000 + 3000 > 10000)
    uint96 secondRequestAmount = 3_000e6;
    vm.expectRevert(CapitalPool.InsufficientShares.selector);
    pool.requestWithdrawal(secondRequestAmount);
}

function test_applyLosses_wipesOutAccountAndRequests() public {
    // --- Setup ---
    uint96 depositAmount = 10_000e6;
    uint96 lossAmount = 10_000e6; // A loss equal to the entire deposit

    // 1. User deposits and makes a pending withdrawal request
    pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);
    pool.requestWithdrawal(2_000e6);
    assertEq(pool.getWithdrawalRequestCount(address(this)), 1, "Should have 1 pending request before loss");

    // --- Action ---
    // 2. Apply a loss that wipes out the entire principal
    vm.prank(address(rm));
    pool.applyLosses(address(this), lossAmount);

    // --- Assertions ---
    // 3. The user's account should be completely zeroed out
    (uint256 principal, , uint256 shares, uint256 pending) = pool.getUnderwriterAccount(address(this));
    assertEq(principal, 0, "Principal should be zero after wipeout");
    assertEq(shares, 0, "Master shares should be zero after wipeout");
    assertEq(pending, 0, "Pending withdrawal shares should be zero after wipeout");

    // 4. The pending withdrawal request array should also be deleted
    assertEq(pool.getWithdrawalRequestCount(address(this)), 0, "Pending requests should be deleted after wipeout");
}

function test_executeWithdrawal_reverts_ifNoticePeriodActive() public {
    // --- Setup ---
    uint256 noticePeriod = 7 days;
    uint96 depositAmount = 10_000e6;
    uint96 requestAmount = 5_000e6;

    // 1. Set a non-zero notice period
    pool.setUnderwriterNoticePeriod(noticePeriod);

    // 2. User deposits and requests a withdrawal
    pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);
    pool.requestWithdrawal(requestAmount);

    // --- Action & Assertion (Immediate) ---
    // 3. Attempting to execute immediately should fail
    vm.expectRevert(CapitalPool.NoticePeriodActive.selector);
    pool.executeWithdrawal(0);

    // --- Action & Assertion (After Time Warp) ---
    // 4. Advance time past the notice period
    vm.warp(block.timestamp + noticePeriod + 1);

    // 5. Execution should now succeed
    pool.executeWithdrawal(0);
    (uint256 principal,,,) = pool.getUnderwriterAccount(address(this));
    assertEq(principal, depositAmount - requestAmount, "Principal not reduced correctly after successful withdrawal");
}

function test_deposit_reverts_onChangeOfYieldPlatform() public {
    // --- Setup ---
    // 1. Deposit into the first platform (AAVE)
    pool.deposit(10_000e6, CapitalPool.YieldPlatform.AAVE);

    // 2. Set up a second, different yield adapter for another platform
    MockYieldAdapter anotherAdapter = new MockYieldAdapter(address(token), address(0), address(this));
    anotherAdapter.setDepositor(address(pool));
    pool.setBaseYieldAdapter(CapitalPool.YieldPlatform.COMPOUND, address(anotherAdapter));

    // --- Action & Assertion ---
    // 3. Attempt to deposit into the second platform (COMPOUND)
    vm.expectRevert("CP: Cannot change yield platform; withdraw first.");
    pool.deposit(5_000e6, CapitalPool.YieldPlatform.COMPOUND);
}

function test_setBaseYieldAdapter_reverts_onAssetMismatch() public {
    // --- Setup ---
    // 1. Create a new token, different from the pool's underlying asset
    MockERC20 anotherToken = new MockERC20("DAI", "DAI", 18);

    // 2. Create an adapter that uses this incorrect token
    MockYieldAdapter badAdapter = new MockYieldAdapter(address(anotherToken), address(0), address(this));

    // --- Action & Assertion ---
    // 3. Attempt to set this adapter. It should fail because the adapter's asset
    //    does not match the pool's `underlyingAsset`.
    vm.expectRevert("CP: Adapter asset mismatch");
    pool.setBaseYieldAdapter(CapitalPool.YieldPlatform.OTHER_YIELD, address(badAdapter));
}
}
