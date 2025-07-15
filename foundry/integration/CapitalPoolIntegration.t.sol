// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ResetApproveERC20} from "contracts/test/ResetApproveERC20.sol";
import {SimpleYieldAdapter} from "contracts/adapters/SimpleYieldAdapter.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {UnderwriterManager} from "contracts/core/UnderwriterManager.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {IYieldAdapter} from "contracts/interfaces/IYieldAdapter.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {MockUnderwriterManager} from "contracts/test/MockUnderwriterManager.sol";
import {ICapitalPool} from "contracts/interfaces/ICapitalPool.sol";

contract CapitalPoolIntegration is Test {
    // --- Deployed Contracts ---
    ResetApproveERC20 token;
    SimpleYieldAdapter adapter;
    CapitalPool capitalPool;
    RiskManager riskManager;
    UnderwriterManager um;
    PoolRegistry registry;
    PolicyManager policyManager;
    PolicyNFT policyNFT;
    BackstopPool catPool;
    RewardDistributor rewardDistributor;
    LossDistributor lossDistributor;
    CatShare catShare;

    // --- Actors ---
    address owner = address(this);
    address userA = address(0xA);
    address userB = address(0xB);
    address claimant = address(0xC);
    address liquidator = address(0xD);
    address otherUser = address(0xE);

    // CORRECTED: Removed the constant declaration to fix the compiler error.
    // The full enum path will be used directly in function calls.

    function setUp() public {
        // --- Deploy Tokens ---
        token = new ResetApproveERC20("USD", "USD", 6);
        token.mint(owner, 1_000_000e6);
        token.mint(userA, 1_000_000e6);
        token.mint(userB, 1_000_000e6);
        token.mint(claimant, 1_000_000e6);
        token.mint(address(catPool), 1_000_000e6); // Fund the catpool

        // --- Deploy Adapters & Core Contracts ---
        adapter = new SimpleYieldAdapter(address(token), address(0xdead), owner);
        capitalPool = new CapitalPool(owner, address(token));
        riskManager = new RiskManager(owner);
        registry = new PoolRegistry(owner, address(riskManager));
        policyNFT = new PolicyNFT(address(riskManager), owner);
        policyManager = new PolicyManager(address(policyNFT), owner);
        catShare = new CatShare();
        catPool = new BackstopPool(token, catShare, IYieldAdapter(address(0)), owner);
        rewardDistributor = new RewardDistributor(address(riskManager), address(policyManager));
        lossDistributor = new LossDistributor(address(riskManager));
        um = new UnderwriterManager(owner);

        // --- Link Contracts ---
        // CORRECTED: Use the full enum path directly.
        capitalPool.setBaseYieldAdapter(ICapitalPool.YieldPlatform.OTHER_YIELD, address(adapter));
        adapter.setDepositor(address(capitalPool));
        policyNFT.setPolicyManagerAddress(address(policyManager));
        catShare.transferOwnership(address(catPool));
        catPool.initialize();
        rewardDistributor.setCatPool(address(catPool));

        // Set all addresses
        um.setAddresses(address(capitalPool), address(registry), address(catPool), address(lossDistributor), address(rewardDistributor), address(riskManager));
        riskManager.setAddresses(address(capitalPool), address(registry), address(policyManager), address(catPool), address(lossDistributor), address(rewardDistributor), address(um));
        capitalPool.setRiskManager(address(riskManager));
        capitalPool.setUnderwriterManager(address(um));
        capitalPool.setRewardDistributor(address(rewardDistributor));
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* CORE LIFECYCLE TESTS                              */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function testDepositUpdatesPledge() public {
        vm.prank(userA);
        token.approve(address(capitalPool), type(uint256).max);
        vm.prank(userA);
        capitalPool.deposit(500e6, ICapitalPool.YieldPlatform.OTHER_YIELD);
        assertEq(um.underwriterTotalPledge(userA), 500e6);
    }

    function testFullWithdrawalResetsPledge() public {
        vm.startPrank(userA);
        token.approve(address(capitalPool), type(uint256).max);
        capitalPool.deposit(200e6, ICapitalPool.YieldPlatform.OTHER_YIELD);
        (,, uint256 shares,) = capitalPool.getUnderwriterAccount(userA);
        capitalPool.requestWithdrawal(shares);
        vm.warp(block.timestamp + 1);
        capitalPool.executeWithdrawal(0);
        vm.stopPrank();
        assertEq(um.underwriterTotalPledge(userA), 0);
    }

    function test_fullLifecycle_deposit_allocate_claim() public {
        uint256 depositAmount = 100_000e6;
        uint256 claimAmount = 50_000e6;
        vm.prank(userA);
        token.approve(address(capitalPool), type(uint256).max);
        vm.prank(userA);
        capitalPool.deposit(depositAmount, ICapitalPool.YieldPlatform.OTHER_YIELD);

        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        vm.prank(userA);
        um.allocateCapital(pools);

        registry.createPool(token, 0, 0, 0, 0, address(0), 0);
        vm.prank(claimant);
        token.approve(address(policyManager), type(uint256).max);
        uint256 policyId = policyManager.purchaseCover(0, claimAmount, 100e6);

        vm.prank(claimant);
        token.approve(address(riskManager), type(uint256).max);
        uint256 claimantBalanceBefore = token.balanceOf(claimant);
        riskManager.processClaim(policyId);
        uint256 claimantBalanceAfter = token.balanceOf(claimant);

        uint256 expectedFee = (claimAmount * riskManager.CLAIM_FEE_BPS()) / riskManager.BPS();
        uint256 expectedPayout = claimAmount - expectedFee;
        assertEq(claimantBalanceAfter, claimantBalanceBefore + expectedPayout, "Claimant did not receive correct payout");
        assertEq(adapter.totalValueHeld(), depositAmount - claimAmount, "Adapter value not reduced correctly");
        assertEq(um.underwriterPoolPledge(userA, 0), depositAmount - claimAmount, "Underwriter pledge not reduced");
    }

    function test_harvestYield_and_distribute() public {
        uint256 depositAmount = 100_000e6;
        uint256 yieldAmount = 10_000e6;

        vm.prank(userA);
        token.approve(address(capitalPool), type(uint256).max);
        vm.prank(userA);
        capitalPool.deposit(depositAmount, ICapitalPool.YieldPlatform.OTHER_YIELD);

        adapter.simulateYieldOrLoss(int256(yieldAmount));
        assertEq(adapter.totalValueHeld(), depositAmount + yieldAmount);

        capitalPool.harvestAndDistributeYield(address(adapter));

        assertEq(token.balanceOf(address(rewardDistributor)), yieldAmount);
        assertEq(adapter.totalValueHeld(), depositAmount);
        assertEq(rewardDistributor.distributeCallCount(), 1);
        assertEq(rewardDistributor.last_distribute_amount(), yieldAmount);
    }

    function test_claim_withShortfall_triggersBackstopPool() public {
        uint256 depositAmount = 50_000e6;
        uint256 claimAmount = 80_000e6;
        uint256 expectedShortfall = claimAmount - depositAmount;

        vm.prank(userA);
        token.approve(address(capitalPool), type(uint256).max);
        vm.prank(userA);
        capitalPool.deposit(depositAmount, ICapitalPool.YieldPlatform.OTHER_YIELD);

        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        vm.prank(userA);
        um.allocateCapital(pools);

        registry.createPool(token, 0, 0, 0, 0, address(0), 0);
        vm.prank(claimant);
        token.approve(address(policyManager), type(uint256).max);
        uint256 policyId = policyManager.purchaseCover(0, claimAmount, 100e6);

        vm.prank(claimant);
        token.approve(address(riskManager), type(uint256).max);
        uint256 capitalPoolBalanceBefore = token.balanceOf(address(capitalPool));
        riskManager.processClaim(policyId);
        uint256 capitalPoolBalanceAfter = token.balanceOf(address(capitalPool));

        assertEq(capitalPoolBalanceAfter, capitalPoolBalanceBefore + expectedShortfall - claimAmount);
    }

    function test_multiUser_claim_sharesLossProportionally() public {
        uint256 depositA = 60_000e6; // 60%
        uint256 depositB = 40_000e6; // 40%
        uint256 claimAmount = 50_000e6;

        vm.prank(userA);
        token.approve(address(capitalPool), type(uint256).max);
        vm.prank(userA);
        capitalPool.deposit(depositA, ICapitalPool.YieldPlatform.OTHER_YIELD);

        vm.prank(userB);
        token.approve(address(capitalPool), type(uint256).max);
        vm.prank(userB);
        capitalPool.deposit(depositB, ICapitalPool.YieldPlatform.OTHER_YIELD);

        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        vm.prank(userA);
        um.allocateCapital(pools);
        vm.prank(userB);
        um.allocateCapital(pools);

        registry.createPool(token, 0, 0, 0, 0, address(0), 0);
        vm.prank(claimant);
        token.approve(address(policyManager), type(uint256).max);
        uint256 policyId = policyManager.purchaseCover(0, claimAmount, 100e6);

        vm.prank(claimant);
        token.approve(address(riskManager), type(uint256).max);
        riskManager.processClaim(policyId);

        uint256 lossA = (claimAmount * depositA) / (depositA + depositB);
        uint256 lossB = claimAmount - lossA;

        assertEq(um.underwriterTotalPledge(userA), depositA - lossA, "User A loss incorrect");
        assertEq(um.underwriterTotalPledge(userB), depositB - lossB, "User B loss incorrect");
    }

    function test_liquidateInsolventUnderwriter_fullFlow() public {
        uint256 depositAmount = 100_000e6;
        uint256 lossAmount = 110_000e6; // Loss > deposit, making user insolvent

        vm.prank(userA);
        token.approve(address(capitalPool), type(uint256).max);
        vm.prank(userA);
        capitalPool.deposit(depositAmount, ICapitalPool.YieldPlatform.OTHER_YIELD);
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        vm.prank(userA);
        um.allocateCapital(pools);

        lossDistributor.distributeLoss(0, lossAmount, depositAmount);

        vm.prank(liquidator);
        riskManager.liquidateInsolventUnderwriter(userA);

        (uint256 principal,, uint256 shares,) = capitalPool.getUnderwriterAccount(userA);
        assertEq(principal, 0, "Principal should be zero after liquidation");
        assertEq(shares, 0, "Shares should be zero after liquidation");
        assertEq(um.underwriterTotalPledge(userA), 0, "Total pledge should be zero after liquidation");
    }

    function test_partialLoss_afterWithdrawalRequest() public {
        uint256 depositAmount = 100_000e6;
        uint256 lossAmount = 20_000e6;
        uint256 withdrawShares = 50_000e6;

        vm.prank(userA);
        token.approve(address(capitalPool), type(uint256).max);
        vm.prank(userA);
        capitalPool.deposit(depositAmount, ICapitalPool.YieldPlatform.OTHER_YIELD);
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        vm.prank(userA);
        um.allocateCapital(pools);

        vm.prank(userA);
        capitalPool.requestWithdrawal(withdrawShares);

        lossDistributor.distributeLoss(0, lossAmount, depositAmount);
        vm.prank(riskManager);
        um.realizeLossesForAllPools(userA);

        assertEq(um.underwriterTotalPledge(userA), depositAmount - lossAmount, "Pledge not reduced by loss");
        assertEq(capitalPool.totalSystemValue(), depositAmount - lossAmount, "System value not reduced by loss");

        vm.prank(userA);
        uint256 balanceBefore = token.balanceOf(userA);
        capitalPool.executeWithdrawal(0);
        uint256 balanceAfter = token.balanceOf(userA);

        uint256 expectedWithdrawalValue = (withdrawShares * (depositAmount - lossAmount)) / depositAmount;
        assertEq(balanceAfter, balanceBefore + expectedWithdrawalValue, "Incorrect withdrawal amount after loss");
        
        assertEq(um.underwriterTotalPledge(userA), (depositAmount - lossAmount) / 2, "Final pledge incorrect");
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* REVERT & PERMISSION TESTS                         */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function testRevert_adminFunctions_ifNotOwner() public {
        vm.prank(otherUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otherUser));
        capitalPool.setRiskManager(address(0x1));

        vm.prank(otherUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otherUser));
        capitalPool.setRewardDistributor(address(0x1));

        vm.prank(otherUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otherUser));
        capitalPool.setUnderwriterManager(address(0x1));
    }

    function testRevert_ifHookFails() public {
        MockUnderwriterManager mockUM = new MockUnderwriterManager();
        capitalPool.setUnderwriterManager(address(mockUM));
        mockUM.setShouldReject(true);

        vm.prank(userA);
        token.approve(address(capitalPool), type(uint256).max);
        
        vm.prank(userA);
        vm.expectRevert("MockUM: Reject on hook");
        capitalPool.deposit(500e6, ICapitalPool.YieldPlatform.OTHER_YIELD);
    }

    function test_claim_succeeds_evenIfPoolIsPaused() public {
        uint256 depositAmount = 100_000e6;
        uint256 claimAmount = 50_000e6;
        vm.prank(userA);
        token.approve(address(capitalPool), type(uint256).max);
        vm.prank(userA);
        capitalPool.deposit(depositAmount, ICapitalPool.YieldPlatform.OTHER_YIELD);

        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        vm.prank(userA);
        um.allocateCapital(pools);

        registry.createPool(token, 0, 0, 0, 0, address(0), 0);
        registry.setPoolPauseStatus(0, true);
        assertTrue(registry.isPoolPaused(0), "Pool should be paused");

        vm.prank(claimant);
        token.approve(address(policyManager), type(uint256).max);
        uint256 policyId = policyManager.purchaseCover(0, claimAmount, 100e6);

        vm.prank(claimant);
        token.approve(address(riskManager), type(uint256).max);
        
        riskManager.processClaim(policyId);

        assertEq(um.underwriterPoolPledge(userA, 0), depositAmount - claimAmount, "Underwriter pledge not reduced on claim in paused pool");
    }
}
