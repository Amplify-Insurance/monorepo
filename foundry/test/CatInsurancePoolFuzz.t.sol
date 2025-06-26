// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {CatInsurancePool} from "contracts/external/CatInsurancePool.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {MockYieldAdapter} from "contracts/test/MockYieldAdapter.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";

contract CatInsurancePoolFuzz is Test {
    CatInsurancePool pool;
    CatShare share;
    MockERC20 usdc;
    MockYieldAdapter adapter;
    MockRewardDistributor distributor;

    address user = address(0x1);
    address riskManager = address(0x2);
    address capitalPool = address(0x3);
    address policyManager = address(0x4);

    uint256 constant STARTING_BALANCE = 10_000e6;
    uint256 constant MIN_USDC_AMOUNT = 1e3; // matches CatInsurancePool.MIN_USDC_AMOUNT
    uint256 constant NOTICE_PERIOD = 30 days;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        share = new CatShare();
        adapter = new MockYieldAdapter(address(usdc), address(0), address(this));
        distributor = new MockRewardDistributor();

        usdc.mint(user, STARTING_BALANCE);
        // Owner funds for adapter interactions
        usdc.mint(address(this), STARTING_BALANCE);
        usdc.approve(address(adapter), type(uint256).max);

        pool = new CatInsurancePool(usdc, share, adapter, address(this));
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

    function _request(uint256 shares) internal {
        vm.prank(user);
        pool.requestWithdrawal(shares);
        vm.warp(block.timestamp + NOTICE_PERIOD);
    }

    function testFuzz_depositAndWithdraw(uint96 amount) public {
        vm.assume(amount >= MIN_USDC_AMOUNT && amount < STARTING_BALANCE);

        vm.prank(user);
        pool.depositLiquidity(amount);
        assertEq(share.balanceOf(user), amount);

        _request(amount);

        vm.prank(user);
        pool.withdrawLiquidity(amount);

        assertEq(usdc.balanceOf(user), STARTING_BALANCE);
        assertEq(pool.idleUSDC(), 0);
        assertEq(adapter.totalValueHeld(), 0);
        assertEq(share.totalSupply(), 1_000); // only locked shares remain
    }

    function testFuzz_depositFlushYieldWithdraw(uint96 amount, uint96 yield) public {
        vm.assume(amount >= MIN_USDC_AMOUNT && amount < STARTING_BALANCE);
        vm.assume(yield < STARTING_BALANCE);

        vm.prank(user);
        pool.depositLiquidity(amount);
        pool.flushToAdapter(amount);

        // simulate yield in adapter
        adapter.fundAdapter(yield);
        adapter.setTotalValueHeld(amount + yield);

        _request(amount);

        vm.prank(user);
        pool.withdrawLiquidity(amount);

        assertEq(usdc.balanceOf(user), STARTING_BALANCE + yield);
        assertEq(pool.idleUSDC(), 0);
        assertEq(adapter.totalValueHeld(), 0);
        assertEq(share.totalSupply(), 1_000);
    }
}
