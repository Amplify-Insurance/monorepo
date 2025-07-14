// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {SimpleYieldAdapter} from "contracts/adapters/SimpleYieldAdapter.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {IYieldAdapter} from "contracts/interfaces/IYieldAdapter.sol";

contract RiskManagerIntegration is Test {
    MockERC20 usdc;
    SimpleYieldAdapter adapter;
    RiskManager rm;
    PoolRegistry registry;
    CapitalPool capitalPool;
    CatShare catShare;
    BackstopPool catPool;
    LossDistributor lossDistributor;
    RewardDistributor rewardDistributor;
    PolicyNFT policyNFT;
    PolicyManager policyManager;

    address owner = address(this);
    address committee = address(0xBEEF);
    address underwriter = address(0xFACE);
    address claimant = address(0xCA11);

    uint8 constant PLATFORM = 1; // CapitalPool.YieldPlatform.AAVE
    uint256 constant POOL_ID = 0;
    uint256 constant PLEDGE_AMOUNT = 10_000e6;
    uint256 constant LOSS_AMOUNT = 1_000e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        usdc.mint(underwriter, PLEDGE_AMOUNT);
        usdc.mint(claimant, 100_000e6);

        adapter = new SimpleYieldAdapter(address(usdc), owner, owner);

        rm = new RiskManager(owner);
        registry = new PoolRegistry(owner, address(rm));
        capitalPool = new CapitalPool(owner, address(usdc));
        capitalPool.setRiskManager(address(rm));
        capitalPool.setBaseYieldAdapter(CapitalPool.YieldPlatform(PLATFORM), address(adapter));
        adapter.setDepositor(address(capitalPool));

        catShare = new CatShare();
        catPool = new BackstopPool(usdc, catShare, IYieldAdapter(address(0)), owner);
        catShare.transferOwnership(address(catPool));
        catPool.initialize();

        policyNFT = new PolicyNFT(address(rm), owner);
        policyManager = new PolicyManager(address(policyNFT), owner);

        rewardDistributor = new RewardDistributor(address(rm), address(policyManager));
        rewardDistributor.setCatPool(address(catPool));
        lossDistributor = new LossDistributor(address(rm));

        policyNFT.setPolicyManagerAddress(address(policyManager));
        catPool.setPolicyManagerAddress(address(policyManager));
        catPool.setCapitalPoolAddress(address(capitalPool));
        catPool.setRiskManagerAddress(address(rm));
        catPool.setRewardDistributor(address(rewardDistributor));
        policyManager.setAddresses(address(registry), address(capitalPool), address(catPool), address(rewardDistributor), address(rm));

        rm.setAddresses(address(capitalPool), address(registry), address(policyManager), address(catPool), address(lossDistributor), address(rewardDistributor));
        rm.setCommittee(committee);

        IPoolRegistry.RateModel memory rateModel = IPoolRegistry.RateModel({base: 100, slope1: 0, slope2: 0, kink: 8000});
        rm.addProtocolRiskPool(address(usdc), rateModel, 0);

        vm.startPrank(underwriter);
        usdc.approve(address(capitalPool), type(uint256).max);
        capitalPool.deposit(PLEDGE_AMOUNT, CapitalPool.YieldPlatform(PLATFORM));
        uint256[] memory pools = new uint256[](1);
        pools[0] = POOL_ID;
        rm.allocateCapital(pools);
        vm.stopPrank();
    }

    function _singlePoolArray(uint256 id) internal pure returns (uint256[] memory arr) {
        arr = new uint256[](1);
        arr[0] = id;
    }

    function testRealizesLossesOnWithdrawal() public {
        vm.prank(address(rm));
        lossDistributor.distributeLoss(POOL_ID, LOSS_AMOUNT, PLEDGE_AMOUNT);
        assertEq(lossDistributor.getPendingLosses(underwriter, POOL_ID, PLEDGE_AMOUNT), LOSS_AMOUNT);

        uint256 withdrawValue = 2_000e6;
        vm.prank(address(capitalPool));
        rm.onCapitalWithdrawn(underwriter, withdrawValue, false);

        uint256 expected = PLEDGE_AMOUNT - LOSS_AMOUNT - withdrawValue;
        assertEq(rm.underwriterTotalPledge(underwriter), expected);
        assertEq(lossDistributor.getPendingLosses(underwriter, POOL_ID, PLEDGE_AMOUNT), 0);
    }

    function testCommitteeCanPauseAndUnpausePool() public {
        vm.prank(committee);
        rm.reportIncident(POOL_ID, true);
        (, , , , bool paused,,) = registry.getPoolData(POOL_ID);
        assertTrue(paused);
        vm.prank(committee);
        rm.reportIncident(POOL_ID, false);
        (, , , , paused,,) = registry.getPoolData(POOL_ID);
        assertFalse(paused);
    }

    function testDeallocateAfterRequest() public {
        rm.setDeallocationNoticePeriod(0);
        vm.startPrank(underwriter);
        rm.requestDeallocateFromPool(POOL_ID, PLEDGE_AMOUNT);
        rm.deallocateFromPool(POOL_ID);
        vm.stopPrank();
        assertFalse(rm.isAllocatedToPool(underwriter, POOL_ID));
    }

    function testClaimPremiumRewardsAfterDistribution() public {
        uint256 reward = 100e6;
        usdc.mint(address(rewardDistributor), reward);
        vm.prank(address(rm));
        rewardDistributor.distribute(POOL_ID, address(usdc), reward, PLEDGE_AMOUNT);
        uint256 beforeBal = usdc.balanceOf(underwriter);
        vm.prank(underwriter);
        rm.claimPremiumRewards(_singlePoolArray(POOL_ID));
        uint256 afterBal = usdc.balanceOf(underwriter);
        assertGt(afterBal, beforeBal);
    }

    function testProcessClaimPaysOut() public {
        uint256 coverage = 2_000e6;
        uint256 premium = 10e6;
        usdc.mint(claimant, coverage + premium);

        vm.startPrank(claimant);
        usdc.approve(address(policyManager), premium);
        uint256 policyId = policyManager.purchaseCover(POOL_ID, coverage, premium);
        vm.stopPrank();
        vm.prank(owner);
        policyNFT.setPolicyManagerAddress(address(rm));
        vm.startPrank(claimant);
        usdc.approve(address(rm), coverage);
        rm.processClaim(policyId);
        vm.stopPrank();

        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, policyId)
        );
        policyNFT.ownerOf(policyId);
        (, , uint256 sold,, , ,) = registry.getPoolData(POOL_ID);
        assertEq(sold, 0);
    }

    // Add these new tests to your existing RiskManagerIntegration contract

    function testRevert_AllocateCapital_NoCapital() public {
        // Underwriter with no funds attempts to allocate
        vm.startPrank(claimant);
        uint256[] memory pools = new uint256[](1);
        pools[0] = POOL_ID;
        vm.expectRevert(abi.encodeWithSelector(RiskManager.NoCapitalToAllocate.selector));
        rm.allocateCapital(pools);
        vm.stopPrank();
    }

    function testRevert_AllocateCapital_AlreadyAllocated() public {
        // Underwriter from setUp already allocated to POOL_ID
        uint256[] memory pools = new uint256[](1);
        pools[0] = POOL_ID;
        vm.startPrank(underwriter);
        vm.expectRevert(abi.encodeWithSelector(RiskManager.AlreadyAllocated.selector));
        rm.allocateCapital(pools);
        vm.stopPrank();
    }

    function testRevert_DeallocateFromPool_NoticePeriodActive() public {
        uint256 noticePeriod = 1 days;
        rm.setDeallocationNoticePeriod(noticePeriod);

        vm.startPrank(underwriter);
        rm.requestDeallocateFromPool(POOL_ID, 1_000e6);

        // Try to deallocate immediately, which should fail
        vm.expectRevert(abi.encodeWithSelector(RiskManager.NoticePeriodActive.selector));
        rm.deallocateFromPool(POOL_ID);

        // Warp time forward and it should succeed
        vm.warp(block.timestamp + noticePeriod + 1);
        rm.deallocateFromPool(POOL_ID);
        vm.stopPrank();
        assertFalse(rm.isAllocatedToPool(underwriter, POOL_ID));
    }

    function testRevert_RequestDeallocate_InsufficientFreeCapital() public {
        // Sell coverage equal to the entire pool pledge, leaving no free capital
        vm.prank(address(policyManager));
        rm.updateCoverageSold(POOL_ID, PLEDGE_AMOUNT, true);

        // Attempting to request deallocation should fail
        vm.startPrank(underwriter);
        vm.expectRevert(abi.encodeWithSelector(RiskManager.InsufficientFreeCapital.selector));
        rm.requestDeallocateFromPool(POOL_ID, 1e6); // Request even a small amount
        vm.stopPrank();
    }

    function testRevert_ReportIncident_NotCommittee() public {
        // Any address other than the committee tries to report an incident
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RiskManager.NotCommittee.selector));
        rm.reportIncident(POOL_ID, true);
    }

function testSetPoolFeeRecipient() public {
        address newRecipient = address(0xDEAD);
        // Should fail if not called by committee
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RiskManager.NotCommittee.selector));
        rm.setPoolFeeRecipient(POOL_ID, newRecipient);

        // Should succeed when called by committee
        vm.prank(committee);
        rm.setPoolFeeRecipient(POOL_ID, newRecipient);

        // Correctly destructure the return values
        (,,,,, address feeRecipient,) = registry.getPoolData(POOL_ID);
        assertEq(feeRecipient, newRecipient);
    }

    function testLiquidateInsolventUnderwriter() public {
        // 1. Distribute a loss greater than the underwriter's pledge
        uint256 lossAmount = PLEDGE_AMOUNT + 5_000e6; // More than the pledge
        vm.prank(address(rm));
        lossDistributor.distributeLoss(POOL_ID, lossAmount, PLEDGE_AMOUNT);

        // 2. The underwriter is now insolvent. Anyone can liquidate them.
        address liquidator = address(0x1111);
        vm.prank(liquidator);
        rm.liquidateInsolventUnderwriter(underwriter);

        // 3. Check that losses have been realized and pledge is zero
        assertEq(rm.underwriterTotalPledge(underwriter), 0);
    }

    function testRevert_LiquidateInsolvent_NotEnoughLosses() public {
        // Distribute a loss that is LESS than the pledge
        vm.prank(address(rm));
        lossDistributor.distributeLoss(POOL_ID, LOSS_AMOUNT, PLEDGE_AMOUNT);

        // Attempting to liquidate should fail as they are not insolvent
        vm.prank(address(0x1111));
        vm.expectRevert(abi.encodeWithSelector(RiskManager.UnderwriterNotInsolvent.selector));
        rm.liquidateInsolventUnderwriter(underwriter);
    }

    function testProcessClaim_WithShortfall() public {
        // Create a claim larger than the pool's capital
        uint256 coverage = PLEDGE_AMOUNT + 5_000e6; // Exceeds pool capacity
        uint256 premium = 10e6;
        usdc.mint(claimant, coverage + premium);
        usdc.mint(address(catPool), 1_000_000e6); // Ensure CatPool has funds

        // Purchase cover
        vm.startPrank(claimant);
        usdc.approve(address(policyManager), premium);
        uint256 policyId = policyManager.purchaseCover(POOL_ID, coverage, premium);
        vm.stopPrank();

        // Process claim
        uint256 catPoolBefore = usdc.balanceOf(address(catPool));
        uint256 claimantBefore = usdc.balanceOf(claimant);

        vm.prank(owner);
        policyNFT.setPolicyManagerAddress(address(rm)); // Hack to allow rm to burn
        vm.startPrank(claimant);
        usdc.approve(address(rm), coverage); // For premium payment
        rm.processClaim(policyId);
        vm.stopPrank();

        // Assertions
        uint256 claimantAfter = usdc.balanceOf(claimant);
        uint256 catPoolAfter = usdc.balanceOf(address(catPool));
        uint256 shortfall = coverage - PLEDGE_AMOUNT;

        // Claimant receives full coverage (minus fee)
        uint256 expectedClaimantPayout = coverage - (coverage * rm.CLAIM_FEE_BPS() / 10_000);
        assertEq(claimantAfter - claimantBefore, expectedClaimantPayout);

        // BackstopPool (catPool) covered the shortfall
        assertEq(catPoolBefore - catPoolAfter, shortfall);

        // Underwriter's pledge is wiped out
        assertEq(rm.underwriterTotalPledge(underwriter), 0);
    }

/// @notice Tests the full lifecycle of an underwriter withdrawing their entire stake,
    ///         ensuring RiskManager state is correctly cleared.
    function testFullWithdrawal() public {
        // ARRANGE: Get the underwriter's initial share balance.
        (,, uint256 initialShares,) = capitalPool.getUnderwriterAccount(underwriter);
        assertTrue(initialShares > 0, "Pre-condition failed: Underwriter should have shares.");

        // ACT:
        // 1. Request a withdrawal for all shares. Since it's the first request, its index is 0.
        vm.prank(underwriter);
        capitalPool.requestWithdrawal(initialShares);

        // 2. Warp time past the withdrawal notice period (if any).
        // Your contract sets this to 0, but this is good practice for robustness.
        vm.warp(block.timestamp + capitalPool.underwriterNoticePeriod() + 1);

        // 3. Execute the withdrawal using the request's index (0).
        uint256 underwriterBalanceBefore = usdc.balanceOf(underwriter);
        vm.prank(underwriter);
        capitalPool.executeWithdrawal(0); // Execute the first (and only) pending request.
        uint256 underwriterBalanceAfter = usdc.balanceOf(underwriter);

        // ASSERT:
        // Check that the underwriter received their funds.
        assertGt(underwriterBalanceAfter, underwriterBalanceBefore, "Underwriter did not receive USDC.");

        // Check that RiskManager state has been cleaned up correctly for the underwriter.
        assertEq(rm.underwriterTotalPledge(underwriter), 0, "RiskManager total pledge should be zero.");
        assertFalse(rm.isAllocatedToPool(underwriter, POOL_ID), "Underwriter should no longer be allocated.");
        assertEq(rm.getUnderwriterAllocations(underwriter).length, 0, "Underwriter's allocations array should be empty.");
    }
}

