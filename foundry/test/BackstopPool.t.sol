// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {MockYieldAdapter} from "contracts/test/MockYieldAdapter.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";

contract BackstopPoolTest is Test {
    BackstopPool pool;
    CatShare share;
    MockERC20 usdc;
    MockYieldAdapter adapter;
    MockRewardDistributor distributor;

    address user = address(0x1);
    address riskManager = address(0x2);
    address capitalPool = address(0x3);
    address policyManager = address(0x4);

    uint256 constant STARTING_BALANCE = 10_000e6;
    uint256 constant DEPOSIT_AMOUNT = 1_000e6; // 1000 USDC

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        share = new CatShare();
        adapter = new MockYieldAdapter(address(usdc), address(0), address(this));
        distributor = new MockRewardDistributor();

        usdc.mint(user, STARTING_BALANCE);

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
    }

    function testDepositAndWithdrawFromAdapter() public {
        vm.prank(user);
        pool.depositLiquidity(DEPOSIT_AMOUNT);
        assertEq(share.balanceOf(user), DEPOSIT_AMOUNT);
        assertEq(pool.idleUSDC(), DEPOSIT_AMOUNT);

        pool.flushToAdapter(DEPOSIT_AMOUNT);
        assertEq(pool.idleUSDC(), 0);
        assertEq(adapter.totalValueHeld(), DEPOSIT_AMOUNT);

        uint256 shares = share.balanceOf(user);
        vm.prank(user);
        pool.withdrawLiquidity(shares);

        // expected withdrawal = shares * totalValue / (totalShares - locked)
        uint256 expectedWithdraw = shares * DEPOSIT_AMOUNT / shares;
        assertEq(usdc.balanceOf(user), STARTING_BALANCE - DEPOSIT_AMOUNT + expectedWithdraw);
        assertEq(adapter.totalValueHeld(), 0); // adapter fully drained
        assertEq(share.totalSupply(), 1_000); // locked shares remain
    }

    function testSubsequentDepositWithYield() public {
        vm.prank(user);
        pool.depositLiquidity(DEPOSIT_AMOUNT);
        pool.flushToAdapter(DEPOSIT_AMOUNT);
        adapter.setTotalValueHeld(DEPOSIT_AMOUNT * 110 / 100); // 10% yield

        address user2 = address(0x5);
        usdc.mint(user2, STARTING_BALANCE);
        vm.prank(user2);
        usdc.approve(address(pool), type(uint256).max);

        vm.prank(user2);
        pool.depositLiquidity(DEPOSIT_AMOUNT);

        uint256 totalShares = share.totalSupply();
        uint256 totalValue = pool.liquidUsdc();
        uint256 expectedShares = DEPOSIT_AMOUNT * (totalShares - 1_000) / totalValue;
        assertEq(share.balanceOf(user2), expectedShares);
    }

    function testDepositBelowMinimumReverts() public {
        vm.prank(user);
        vm.expectRevert("CIP: Amount below minimum");
        pool.depositLiquidity(999);
    }
}
