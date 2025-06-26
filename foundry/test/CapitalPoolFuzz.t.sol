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
        (uint256 principal,, uint256 shares,,) = pool.getUnderwriterAccount(address(this));
        assertEq(principal, amount);
        assertEq(shares, amount);

        pool.requestWithdrawal(shares);
        pool.executeWithdrawal(0);

        (principal,, shares,,) = pool.getUnderwriterAccount(address(this));
        assertEq(principal, 0);
        assertEq(shares, 0);
        assertEq(token.balanceOf(address(this)) + adapter.totalValueHeld(), INITIAL_SUPPLY);
        assertEq(pool.totalSystemValue(), adapter.totalValueHeld());
    }

    function testFuzz_multipleDeposits(uint96 first, uint96 second) public {
        vm.assume(first > 0 && second > 0);
        vm.assume(first + second < INITIAL_SUPPLY);

        pool.deposit(first, CapitalPool.YieldPlatform.AAVE);
        uint256 msBefore = pool.totalMasterSharesSystem();
        uint256 tvBefore = pool.totalSystemValue();

        pool.deposit(second, CapitalPool.YieldPlatform.AAVE);

        uint256 expectedSharesSecond = (second * msBefore) / tvBefore;
        (, , uint256 shares,,) = pool.getUnderwriterAccount(address(this));
        assertEq(shares, first + expectedSharesSecond);
        assertEq(pool.totalSystemValue(), first + second);
    }

    function testFuzz_depositWithYield(uint96 depositAmount, uint96 secondDeposit, uint96 yieldGain) public {
        vm.assume(depositAmount > 0 && secondDeposit > 0);
        vm.assume(depositAmount + secondDeposit + yieldGain < INITIAL_SUPPLY);

        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);

        token.mint(address(adapter), yieldGain);
        adapter.simulateYieldOrLoss(int256(uint256(yieldGain)));
        pool.syncYieldAndAdjustSystemValue();

        uint256 msBefore = pool.totalMasterSharesSystem();
        uint256 tvBefore = pool.totalSystemValue();
        pool.deposit(secondDeposit, CapitalPool.YieldPlatform.AAVE);
        uint256 expectedShares = (secondDeposit * msBefore) / tvBefore;

        (, , uint256 shares,,) = pool.getUnderwriterAccount(address(this));
        assertEq(shares, depositAmount + expectedShares);
        assertEq(pool.totalSystemValue(), depositAmount + secondDeposit + yieldGain);
    }

    function testFuzz_applyLosses(uint96 depositAmount, uint96 loss) public {
        vm.assume(depositAmount > 0 && depositAmount < INITIAL_SUPPLY);
        vm.assume(loss > 0 && loss <= depositAmount);

        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);

        vm.prank(address(rm));
        pool.applyLosses(address(this), loss);

        (uint256 principal,, uint256 shares,,) = pool.getUnderwriterAccount(address(this));
        uint256 expected = depositAmount - loss;
        assertEq(principal, expected);
        assertEq(shares, expected);
        assertEq(pool.totalSystemValue(), expected);
    }

    function testFuzz_partialWithdrawalWithYield(uint96 depositAmount, uint96 withdrawShares, uint96 yieldGain) public {
        vm.assume(depositAmount > 0 && withdrawShares > 0);
        vm.assume(withdrawShares <= depositAmount);
        vm.assume(depositAmount + yieldGain < INITIAL_SUPPLY);

        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);

        token.mint(address(adapter), yieldGain);
        adapter.simulateYieldOrLoss(int256(uint256(yieldGain)));
        pool.syncYieldAndAdjustSystemValue();

        pool.requestWithdrawal(withdrawShares);
        uint256 expectedValue = pool.sharesToValue(withdrawShares);
        pool.executeWithdrawal(0);

        (uint256 principal,, uint256 shares,,) = pool.getUnderwriterAccount(address(this));
        assertEq(principal, depositAmount - withdrawShares);
        assertEq(shares, depositAmount - withdrawShares);
        assertEq(pool.totalSystemValue(), depositAmount + yieldGain - expectedValue);
    }
}
