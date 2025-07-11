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
    address riskManager = address(0x2);
    address capitalPool = address(0x3);
    address policyManager = address(0x4);

    uint256 constant STARTING_BALANCE = 10_000e6;

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

    function _deposit(uint256 amount) internal {
        vm.prank(user);
        pool.depositLiquidity(amount);
    }

    function testFuzz_depositLiquidity(uint96 amount) public {
        uint256 min = pool.MIN_USDC_AMOUNT();
        amount = uint96(bound(uint256(amount), min, STARTING_BALANCE));
        _deposit(amount);
        assertEq(share.balanceOf(user), amount);
        assertEq(pool.idleUSDC(), amount);
    }

    function testFuzz_requestAndWithdraw(uint96 amount) public {
        uint256 min = pool.MIN_USDC_AMOUNT();
        amount = uint96(bound(uint256(amount), min, STARTING_BALANCE));

        _deposit(amount);

        vm.prank(user);
        pool.requestWithdrawal(amount);

        vm.warp(block.timestamp + pool.NOTICE_PERIOD());

        uint256 before = usdc.balanceOf(user);

        vm.prank(user);
        pool.withdrawLiquidity(amount);

        assertEq(usdc.balanceOf(user), before + amount);
        assertEq(share.balanceOf(user), 0);
        assertEq(pool.idleUSDC(), 0);
    }

    function testFuzz_flushToAdapter(uint96 amount) public {
        uint256 min = pool.MIN_USDC_AMOUNT();
        amount = uint96(bound(uint256(amount), min, STARTING_BALANCE));
        _deposit(amount);

        pool.flushToAdapter(amount);

        assertEq(adapter.totalValueHeld(), amount);
        assertEq(pool.idleUSDC(), 0);
    }

    function testFuzz_receiveUsdcPremium(uint96 premium) public {
        premium = uint96(bound(uint256(premium), 1, STARTING_BALANCE));
        usdc.mint(policyManager, premium);
        vm.startPrank(policyManager);
        usdc.approve(address(pool), premium);
        pool.receiveUsdcPremium(premium);
        vm.stopPrank();
        assertEq(pool.idleUSDC(), premium);
    }

    function testFuzz_drawFund(uint96 depositAmount, uint96 drawAmount) public {
        uint256 min = pool.MIN_USDC_AMOUNT();
        depositAmount = uint96(bound(uint256(depositAmount), min, STARTING_BALANCE));
        drawAmount = uint96(bound(uint256(drawAmount), 1, depositAmount));

        _deposit(depositAmount);

        vm.prank(riskManager);
        pool.drawFund(drawAmount);

        assertEq(usdc.balanceOf(capitalPool), drawAmount);
        assertEq(pool.idleUSDC(), depositAmount - drawAmount);
    }

    function testFuzz_receiveProtocolAssets(uint96 amount) public {
        amount = uint96(bound(uint256(amount), 1, STARTING_BALANCE));
        MockERC20 token = new MockERC20("RWD", "RWD", 18);
        token.mint(riskManager, amount);
        vm.startPrank(riskManager);
        token.approve(address(pool), amount);
        pool.receiveProtocolAssetsForDistribution(address(token), amount);
        vm.stopPrank();
        uint256 stored = distributor.totalRewards(pool.CAT_POOL_REWARD_ID(), address(token));
        assertEq(stored, amount);
    }

    function testFuzz_claimProtocolRewards(uint96 depositAmount, uint96 reward) public {
        uint256 min = pool.MIN_USDC_AMOUNT();
        depositAmount = uint96(bound(uint256(depositAmount), min, STARTING_BALANCE));
        reward = uint96(bound(uint256(reward), 1, STARTING_BALANCE));

        _deposit(depositAmount);

        MockERC20 token = new MockERC20("RWD", "RWD", 18);
        token.mint(riskManager, reward);
        vm.startPrank(riskManager);
        token.approve(address(pool), reward);
        pool.receiveProtocolAssetsForDistribution(address(token), reward);
        vm.stopPrank();

        uint256 pending = pool.getPendingProtocolAssetRewards(user, address(token));
        vm.assume(pending > 0);
        vm.prank(user);
        pool.claimProtocolAssetRewards(address(token));
        uint256 remaining = pool.getPendingProtocolAssetRewards(user, address(token));
        assertLt(remaining, pending);
    }

    function testFuzz_adminSetters(address newRM, address newCP, address newPM) public {
        vm.assume(newRM != address(0) && newCP != address(0) && newPM != address(0));

        pool.setRiskManagerAddress(newRM);
        assertEq(pool.riskManagerAddress(), newRM);

        pool.setCapitalPoolAddress(newCP);
        assertEq(pool.capitalPoolAddress(), newCP);

        pool.setPolicyManagerAddress(newPM);
        assertEq(pool.policyManagerAddress(), newPM);

        MockRewardDistributor rd = new MockRewardDistributor();
        pool.setRewardDistributor(address(rd));
        assertEq(address(pool.rewardDistributor()), address(rd));

        MockYieldAdapter newAdapter = new MockYieldAdapter(address(usdc), address(0), address(this));
        pool.setAdapter(address(newAdapter));
        assertEq(address(pool.adapter()), address(newAdapter));
    }
}
