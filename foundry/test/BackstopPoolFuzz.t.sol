// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {MockYieldAdapter} from "contracts/test/MockYieldAdapter.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";

contract BackstopPoolFuzz is Test {
    BackstopPool pool;
    CatShare share;
    MockERC20 usdc;
    MockYieldAdapter adapter;
    MockRewardDistributor distributor;

    address user = address(0x1);
    address user2 = address(0x2);
    address riskManager = address(0x3);
    address capitalPool = address(0x4);
    address policyManager = address(0x5);

    uint256 constant STARTING_BALANCE = 1_000_000e6;
    uint256 constant INITIAL_SHARES_LOCKED = 1000;

    function setUp() public {
        usdc = new MockERC20("USD", "USD", 6);
        share = new CatShare();
        adapter = new MockYieldAdapter(address(usdc), address(0), address(this));
        distributor = new MockRewardDistributor();

        usdc.mint(user, STARTING_BALANCE);
        usdc.mint(user2, STARTING_BALANCE);

        pool = new BackstopPool(usdc, share, adapter, address(this));
        share.transferOwnership(address(pool));
        pool.initialize();

        adapter.setDepositor(address(pool));

        pool.setRiskManagerAddress(riskManager);
        pool.setCapitalPoolAddress(capitalPool);
        pool.setPolicyManagerAddress(policyManager);
        pool.setRewardDistributor(address(distributor));

        vm.prank(user);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(user2);
        usdc.approve(address(pool), type(uint256).max);
    }

    function testFuzz_depositWithdraw(uint96 amount) public {
        uint256 min = pool.MIN_USDC_AMOUNT();
        vm.assume(amount >= min && amount <= STARTING_BALANCE);

        vm.prank(user);
        pool.depositLiquidity(amount);

        vm.prank(user);
        pool.requestWithdrawal(amount);
        vm.warp(block.timestamp + pool.NOTICE_PERIOD());
        vm.prank(user);
        pool.withdrawLiquidity(amount);

        assertEq(usdc.balanceOf(user), STARTING_BALANCE);
        assertEq(share.totalSupply(), INITIAL_SHARES_LOCKED);
    }

    function testFuzz_flushAndWithdrawFromAdapter(uint96 depositAmount, uint96 yieldGain) public {
        uint256 min = pool.MIN_USDC_AMOUNT();
        vm.assume(depositAmount >= min && depositAmount < STARTING_BALANCE / 2);
        vm.assume(yieldGain <= depositAmount);

        vm.prank(user);
        pool.depositLiquidity(depositAmount);
        pool.flushToAdapter(depositAmount);

        usdc.mint(address(adapter), yieldGain);
        adapter.setTotalValueHeld(depositAmount + yieldGain);

        uint256 sharesToBurn = share.balanceOf(user);
        vm.prank(user);
        pool.requestWithdrawal(sharesToBurn);
        vm.warp(block.timestamp + pool.NOTICE_PERIOD());
        vm.prank(user);
        pool.withdrawLiquidity(sharesToBurn);

        assertEq(adapter.totalValueHeld(), 0);
        assertEq(usdc.balanceOf(user), STARTING_BALANCE + yieldGain);
    }

    function testFuzz_multipleDeposits(uint96 first, uint96 second) public {
        uint256 min = pool.MIN_USDC_AMOUNT();
        vm.assume(first >= min && second >= min);
        vm.assume(uint256(first) + uint256(second) < STARTING_BALANCE);

        vm.prank(user);
        pool.depositLiquidity(first);
        uint256 supplyBefore = share.totalSupply();
        uint256 valueBefore = pool.liquidUsdc();
        vm.assume(supplyBefore > INITIAL_SHARES_LOCKED);
        vm.assume(valueBefore > 0);

        vm.prank(user2);
        pool.depositLiquidity(second);

        uint256 expected = (second * (supplyBefore - INITIAL_SHARES_LOCKED)) / valueBefore;
        assertEq(share.balanceOf(user2), expected);
    }

    function testFuzz_drawFund(uint96 depositAmount, uint96 drawAmount) public {
        uint256 min = pool.MIN_USDC_AMOUNT();
        vm.assume(depositAmount >= min && drawAmount > 0);
        vm.assume(drawAmount <= depositAmount && depositAmount < STARTING_BALANCE);

        vm.prank(user);
        pool.depositLiquidity(depositAmount);

        vm.prank(riskManager);
        pool.drawFund(drawAmount);

        assertEq(usdc.balanceOf(capitalPool), drawAmount);
    }
}
