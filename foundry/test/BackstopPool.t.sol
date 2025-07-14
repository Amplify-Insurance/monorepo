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

        uint256 totalShares = share.totalSupply();
        uint256 expectedRewardsPerShare = amount * distributor.PRECISION_FACTOR() / totalShares;
        
        // Assert that the mock's internal rewards-per-share tracker was updated correctly.
        assertEq(distributor.accumulatedRewardsPerShare(pool.CAT_POOL_REWARD_ID(), address(token)), expectedRewardsPerShare);
    }


// In BackstopPoolFuzz.t.sol// In BackstopPoolFuzz.t.sol
function testFuzz_claimProtocolRewards(uint96 depositAmount, uint96 reward) public {
    vm.assume(depositAmount > 0);
    uint256 min = pool.MIN_USDC_AMOUNT();
    depositAmount = uint96(bound(uint256(depositAmount), min, STARTING_BALANCE));
    reward = uint96(bound(uint256(reward), 1, STARTING_BALANCE));

    _deposit(depositAmount);

    MockERC20 rwdToken = new MockERC20("RWD", "RWD", 18);
    // Fund the distributor so it can pay the final claim
    rwdToken.mint(address(distributor), reward);
    
    // FIX: The Risk Manager must have the tokens and give the pool an allowance
    // before the pool can pull the funds in `receiveProtocolAssetsForDistribution`.
    rwdToken.mint(riskManager, reward);
    vm.startPrank(riskManager);
    rwdToken.approve(address(pool), reward);
    pool.receiveProtocolAssetsForDistribution(address(rwdToken), reward);
    vm.stopPrank();

    uint256 pending = pool.getPendingProtocolAssetRewards(user, address(rwdToken));
    vm.assume(pending > 0);
    
    uint256 balBefore = rwdToken.balanceOf(user);
    vm.prank(user);
    pool.claimProtocolAssetRewards(address(rwdToken));
    uint256 balAfter = rwdToken.balanceOf(user);
    
    assertEq(balAfter - balBefore, pending, "User did not receive the correct pending amount");
    uint256 remaining = pool.getPendingProtocolAssetRewards(user, address(rwdToken));
    assertApproxEqAbs(remaining, 0, 1, "Remaining rewards should be zero after claim");
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


    // Add these test functions to your existing BackstopPoolFuzz contract

function testRevert_initialize_ifAlreadyInitialized() public {
    // The pool is already initialized in the setUp() function.
    // Attempting to call it again should revert.
    vm.expectRevert("CIP: Already initialized");
    pool.initialize();
}

function testRevert_initialize_ifNotShareTokenOwner() public {
    // --- Setup ---
    // Deploy a new set of contracts where the pool is NOT the owner of the share token.
    CatShare newShare = new CatShare();
    BackstopPool newPool = new BackstopPool(usdc, newShare, adapter, address(this));

    // --- Action & Assertion ---
    // The call to initialize should fail because ownership of `newShare` was not transferred to `newPool`.
    vm.expectRevert("CIP: Pool must be owner of share token");
    newPool.initialize();
}

// Add this new test to BackstopPoolFuzz.t.sol
function test_MockRewardDistributor_Directly() public {
    // --- Setup: Interact ONLY with the mock ---
    uint256 rewardAmount = 1000;
    uint256 poolId = 99;
    uint256 userPledge = 100;
    MockERC20 rewardToken = new MockERC20("RWD", "RWD", 18);

    // 1. Fund the MockRewardDistributor so it has tokens to send.
    rewardToken.mint(address(distributor), rewardAmount);
    assertEq(rewardToken.balanceOf(address(distributor)), rewardAmount);
    assertEq(rewardToken.balanceOf(user), 0);

    // 2. Set up the mock's internal state to simulate a pending reward.
    distributor.distribute(poolId, address(rewardToken), rewardAmount, userPledge);

    // Sanity check: user should have a pending reward.
    uint256 pending = distributor.pendingRewards(user, poolId, address(rewardToken), userPledge);
    assertEq(pending, rewardAmount);

    // --- Action ---
    // 3. Call the function that is causing the error.
    distributor.claimForCatPool(user, poolId, address(rewardToken), userPledge);

    // --- Assertions ---
    // 4. If the mock is correct, the user's balance should have increased.
    assertEq(rewardToken.balanceOf(user), rewardAmount, "User should have received the rewards");
    assertEq(rewardToken.balanceOf(address(distributor)), 0, "Distributor should have sent the tokens");
}

// In BackstopPoolFuzz.t.sol

    function test_claimProtocolAssetRewardsFor_byRiskManager() public {
        uint96 depositAmount = 5_000e6;
        uint96 rewardAmount = 1_000e18;
        MockERC20 rewardToken = new MockERC20("Reward", "RWD", 18);
        _deposit(depositAmount);

        // --- Test the `receive` logic ---
        rewardToken.mint(riskManager, rewardAmount);
        vm.startPrank(riskManager);
        rewardToken.approve(address(pool), rewardAmount);
        pool.receiveProtocolAssetsForDistribution(address(rewardToken), rewardAmount);
        vm.stopPrank();
        assertEq(rewardToken.balanceOf(address(pool)), rewardAmount, "Pool should have received the tokens");

        // --- Test the `claim` logic ---
        // Ensure the mock distributor is funded so it can pay the claim
        rewardToken.mint(address(distributor), rewardAmount);

        uint256 userBalanceBefore = rewardToken.balanceOf(user);
        uint256 expectedReward = pool.getPendingProtocolAssetRewards(user, address(rewardToken));
        vm.prank(riskManager);
        pool.claimProtocolAssetRewardsFor(user, address(rewardToken));
        uint256 userBalanceAfter = rewardToken.balanceOf(user);

        assertEq(userBalanceAfter, userBalanceBefore + expectedReward, "User did not receive rewards");
    }

function testRevert_setters_ifZeroAddress() public {
    // This test checks that admin functions correctly revert when given the zero address.
    vm.expectRevert("CIP: Address cannot be zero");
    pool.setRiskManagerAddress(address(0));

    vm.expectRevert("CIP: Address cannot be zero");
    pool.setCapitalPoolAddress(address(0));

    vm.expectRevert("CIP: Address cannot be zero");
    pool.setPolicyManagerAddress(address(0));

    vm.expectRevert("CIP: Address cannot be zero");
    pool.setRewardDistributor(address(0));
}
}
