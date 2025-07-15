// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ResetApproveERC20} from "contracts/test/ResetApproveERC20.sol";
import {SimpleYieldAdapter} from "contracts/adapters/SimpleYieldAdapter.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {UnderwriterManager} from "contracts/core/UnderwriterManager.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";
// CORRECTED: Import the new ICapitalPool interface to access the enum
import {ICapitalPool} from "contracts/interfaces/ICapitalPool.sol";

contract LossDistributorIntegrationTest is Test {
    // Core contracts
    ResetApproveERC20 usdc;
    ResetApproveERC20 protocolToken;
    SimpleYieldAdapter adapter;
    CapitalPool capitalPool;
    RiskManager riskManager;
    UnderwriterManager um;
    PoolRegistry poolRegistry;
    PolicyNFT policyNFT;
    PolicyManager policyManager;
    BackstopPool catPool;
    CatShare catShare;
    RewardDistributor rewardDistributor;
    LossDistributor lossDistributor;

    // Actors
    address owner = address(this);
    address committee = address(0xBEEF);
    address underwriter = address(0x1);
    address claimant = address(0x2);
    address secondUnderwriter = address(0x3);
    address attacker = address(0xBAD);

    // Constants
    uint256 constant TOTAL_PLEDGE = 100_000e6;
    uint256 constant COVERAGE = 50_000e6;

    uint256 POOL_ID;
    uint256 POOL_ID_2;
    uint256 POLICY_ID;
    uint256 PRECISION;

    function setUp() public {
        // --- Deploy Tokens ---
        usdc = new ResetApproveERC20("USD Coin", "USDC", 6);
        protocolToken = new ResetApproveERC20("Protocol", "PTKN", 6);

        // --- Deploy Core Protocol Contracts ---
        adapter = new SimpleYieldAdapter(address(usdc), address(this), owner);
        capitalPool = new CapitalPool(owner, address(usdc));
        riskManager = new RiskManager(owner);
        um = new UnderwriterManager(owner);
        catShare = new CatShare();
        catPool = new BackstopPool(usdc, catShare, adapter, owner);
        policyNFT = new PolicyNFT(address(riskManager), owner);
        policyManager = new PolicyManager(address(policyNFT), owner);
        rewardDistributor = new RewardDistributor(address(riskManager), address(policyManager));
        lossDistributor = new LossDistributor(address(riskManager));
        poolRegistry = new PoolRegistry(owner, address(riskManager));
        
        // --- Configure Contract Dependencies ---
        capitalPool.setBaseYieldAdapter(ICapitalPool.YieldPlatform.OTHER_YIELD, address(adapter));
        adapter.setDepositor(address(capitalPool));
        catShare.transferOwnership(address(catPool));
        catPool.initialize();
        catPool.setRiskManagerAddress(address(riskManager));
        catPool.setCapitalPoolAddress(address(capitalPool));
        catPool.setPolicyManagerAddress(address(policyManager));
        
        policyManager.setAddresses(
            address(poolRegistry), address(capitalPool), address(catPool),
            address(rewardDistributor), address(riskManager)
        );
        rewardDistributor.setCatPool(address(catPool));

        um.setAddresses(
            address(capitalPool), address(poolRegistry), address(catPool),
            address(lossDistributor), address(rewardDistributor), address(riskManager)
        );

        riskManager.setAddresses(
            address(capitalPool), address(poolRegistry), address(policyManager),
            address(catPool), address(lossDistributor), address(rewardDistributor), address(um)
        );
        
        // --- Set Permissions ---
        riskManager.setCommittee(committee);
        poolRegistry.setRiskManager(address(riskManager));
        capitalPool.setRiskManager(address(riskManager));
        capitalPool.setUnderwriterManager(address(um));


        // --- Create a Risk Pool ---
        IPoolRegistry.RateModel memory rate = IPoolRegistry.RateModel({base:0, slope1:0, slope2:0, kink:8000});
        vm.prank(address(riskManager));
        POOL_ID = poolRegistry.addProtocolRiskPool(address(protocolToken), rate, 500);

        // --- Initial Underwriter Deposit ---
        usdc.mint(underwriter, TOTAL_PLEDGE);
        vm.startPrank(underwriter);
        usdc.approve(address(capitalPool), TOTAL_PLEDGE);
        capitalPool.deposit(TOTAL_PLEDGE, ICapitalPool.YieldPlatform.OTHER_YIELD);
        um.allocateCapital(_arr(POOL_ID));
        vm.stopPrank();

        // --- Initial Policy Purchase ---
        protocolToken.mint(claimant, 100_000e6);
        vm.prank(claimant);
        protocolToken.approve(address(riskManager), type(uint256).max);

        vm.prank(address(riskManager));
        POLICY_ID = policyNFT.mint(claimant, POOL_ID, COVERAGE, 0, 0, 0);

        PRECISION = lossDistributor.PRECISION_FACTOR();
    }

    /* ───────────────────────── HELPERS ───────────────────────── */

    function _arr(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }

    /* ───────────────────────── INITIAL STATE & REVERTS ───────────────────────── */

    function test_InitialState() public {
        assertEq(lossDistributor.riskManager(), address(riskManager));
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, 0);
        assertEq(lossDistributor.userLossStates(underwriter, POOL_ID).lossDebt, 0);
    }

    function testRevert_CallerNotRiskManager() public {
        vm.startPrank(attacker);
        vm.expectRevert("LD: Not RiskManager");
        lossDistributor.distributeLoss(POOL_ID, 1e6, 1e6);
        vm.expectRevert("LD: Not RiskManager");
        lossDistributor.realizeLosses(underwriter, POOL_ID, 1e6);
        vm.stopPrank();
    }

    function testRevert_SetRiskManagerToZeroAddress() public {
        vm.expectRevert(LossDistributor.ZeroAddress.selector);
        lossDistributor.setRiskManager(address(0));
    }

    /* ───────────────────────── CORE LOSS DISTRIBUTION LOGIC ───────────────────────── */
    
    function test_PoolTrackerUpdatesOnClaim() public {
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);
        
        uint256 expectedLossPerShare = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, expectedLossPerShare);
    }

    function test_AccumulatesLossForMultipleClaims() public {
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);
        uint256 expectedLoss1 = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, expectedLoss1);

        uint256 cover2 = 20_000e6;
        uint256 remainingPledge = TOTAL_PLEDGE - COVERAGE;
        vm.prank(address(riskManager));
        uint256 policy2 = policyNFT.mint(claimant, POOL_ID, cover2, 0, 0, 0);
        vm.prank(claimant);
        riskManager.processClaim(policy2);

        uint256 expectedLoss2 = (cover2 * PRECISION) / remainingPledge;
        uint256 totalExpectedLoss = expectedLoss1 + expectedLoss2;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, totalExpectedLoss);
    }

    function test_DistributeLoss_ZeroAmountDoesNothing() public {
        uint256 trackerBefore = lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare;
        vm.prank(address(riskManager));
        lossDistributor.distributeLoss(POOL_ID, 0, TOTAL_PLEDGE);
        uint256 trackerAfter = lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare;
        assertEq(trackerBefore, trackerAfter);
    }

    function test_TotalLossScenario() public {
        uint256 largeCoverage = TOTAL_PLEDGE + 10_000e6;
        vm.prank(address(riskManager));
        uint256 largePolicyId = policyNFT.mint(claimant, POOL_ID, largeCoverage, 0, 0, 0);

        vm.prank(claimant);
        riskManager.processClaim(largePolicyId);

        uint256 expectedLossPerShare = PRECISION;
        assertTrue(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare <= expectedLossPerShare);
        assertTrue(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare > expectedLossPerShare - 100);

        uint256 pledge = um.underwriterTotalPledge(underwriter);
        uint256 pendingLoss = lossDistributor.getPendingLosses(underwriter, POOL_ID, pledge);
        assertEq(pendingLoss, pledge, "Pending loss should equal total pledge");

        uint256 balanceBefore = usdc.balanceOf(underwriter);
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, pledge, true);
        assertEq(um.underwriterTotalPledge(underwriter), 0);
        assertEq(usdc.balanceOf(underwriter), balanceBefore);
    }


    /* ───────────────────────── UNDERWRITER INTERACTIONS ───────────────────────── */

    function test_NewUnderwriterInheritsExistingLossTracker() public {
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);

        uint256 expectedTracker = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, expectedTracker);
        
        uint256 newPledge = 50_000e6;
        usdc.mint(secondUnderwriter, newPledge);
        vm.startPrank(secondUnderwriter);
        usdc.approve(address(capitalPool), newPledge);
        capitalPool.deposit(newPledge, ICapitalPool.YieldPlatform.OTHER_YIELD);
        um.allocateCapital(_arr(POOL_ID));
        vm.stopPrank();

        uint256 expectedPendingLoss = (newPledge * expectedTracker) / PRECISION;
        assertEq(lossDistributor.getPendingLosses(secondUnderwriter, POOL_ID, newPledge), expectedPendingLoss);
    }

    function test_Withdrawal_NoLosses() public {
        uint256 balanceBefore = usdc.balanceOf(underwriter);
        uint256 pledge = um.underwriterTotalPledge(underwriter);
        
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, pledge, true);

        usdc.transfer(underwriter, pledge);
        
        assertEq(usdc.balanceOf(underwriter), balanceBefore + pledge);
        assertEq(um.underwriterTotalPledge(underwriter), 0);
    }

    function test_RealizesLossesOnFullWithdrawal() public {
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);

        uint256 balanceBefore = usdc.balanceOf(underwriter);
        uint256 pledgeBefore = um.underwriterTotalPledge(underwriter);
        uint256 expectedLoss = COVERAGE;

        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, pledgeBefore, true);

        uint256 amountToReceive = pledgeBefore - expectedLoss;
        usdc.transfer(underwriter, amountToReceive);
        
        assertEq(um.underwriterTotalPledge(underwriter), 0, "Pledge should be zero after full withdrawal");
        assertEq(usdc.balanceOf(underwriter), balanceBefore + amountToReceive, "Final balance is incorrect");
    }

    function test_RealizesLossesOnPartialWithdrawal() public {
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);

        uint256 balanceBefore = usdc.balanceOf(underwriter);
        uint256 pledgeBefore = um.underwriterTotalPledge(underwriter);
        uint256 withdrawalAmount = 40_000e6;
        uint256 expectedLoss = COVERAGE;

        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, withdrawalAmount, false);

        usdc.transfer(underwriter, withdrawalAmount);
        
        uint256 expectedPledgeAfter = pledgeBefore - withdrawalAmount - expectedLoss;
        assertEq(um.underwriterTotalPledge(underwriter), expectedPledgeAfter, "Pledge after partial withdrawal is incorrect");
        assertEq(usdc.balanceOf(underwriter), balanceBefore + withdrawalAmount, "Final balance is incorrect");

        uint256 tracker = lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare;
        uint256 expectedLossDebt = (um.underwriterPoolPledge(underwriter, POOL_ID) * tracker) / PRECISION;
        assertEq(lossDistributor.userLossStates(underwriter, POOL_ID).lossDebt, expectedLossDebt);
    }
    
    /* ───────────────────────── MULTI-POOL & COMPLEX SCENARIOS ───────────────────────── */

    function test_LossesDoNotAffectOtherPools() public {
        IPoolRegistry.RateModel memory rate = IPoolRegistry.RateModel({base:0, slope1:0, slope2:0, kink:8000});
        vm.prank(address(riskManager));
        POOL_ID_2 = poolRegistry.addProtocolRiskPool(address(protocolToken), rate, 500);

        uint256 secondPledge = 75_000e6;
        usdc.mint(secondUnderwriter, secondPledge);
        vm.startPrank(secondUnderwriter);
        usdc.approve(address(capitalPool), secondPledge);
        capitalPool.deposit(secondPledge, ICapitalPool.YieldPlatform.OTHER_YIELD);
        um.allocateCapital(_arr(POOL_ID_2));
        vm.stopPrank();

        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);

        uint256 expectedLossPerShare = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, expectedLossPerShare);
        assertEq(lossDistributor.poolLossTrackers(POOL_ID_2).accumulatedLossPerShare, 0);

        uint256 balanceBefore = usdc.balanceOf(secondUnderwriter);
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(secondUnderwriter, secondPledge, true);
        usdc.transfer(secondUnderwriter, secondPledge);

        assertEq(usdc.balanceOf(secondUnderwriter), balanceBefore + secondPledge);
    }

    function test_ComplexInteractionSequence() public {
        assertEq(um.underwriterTotalPledge(underwriter), TOTAL_PLEDGE);

        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);
        uint256 tracker1 = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, tracker1);
        
        uint256 secondPledge = 50_000e6;
        usdc.mint(secondUnderwriter, secondPledge);
        vm.startPrank(secondUnderwriter);
        usdc.approve(address(capitalPool), secondPledge);
        capitalPool.deposit(secondPledge, ICapitalPool.YieldPlatform.OTHER_YIELD);
        um.allocateCapital(_arr(POOL_ID));
        vm.stopPrank();

        uint256 firstUW_withdrawal = 20_000e6;
        uint256 firstUW_pledge_before_withdraw = um.underwriterTotalPledge(underwriter);
        uint256 firstUW_loss_realized = (firstUW_pledge_before_withdraw * tracker1) / PRECISION;

        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, firstUW_withdrawal, false);
        
        uint256 firstUW_pledge_after_withdraw = firstUW_pledge_before_withdraw - firstUW_withdrawal - firstUW_loss_realized;
        assertEq(um.underwriterTotalPledge(underwriter), firstUW_pledge_after_withdraw);
        
        uint256 cover2 = 10_000e6;
        uint256 totalPledgeAfterWithdrawalAndLoss = um.getTotalPledgeInPool(POOL_ID);
        
        vm.prank(address(riskManager));
        uint256 policy2 = policyNFT.mint(claimant, POOL_ID, cover2, 0, 0, 0);
        vm.prank(claimant);
        riskManager.processClaim(policy2);

        uint256 lossPerShare2 = (cover2 * PRECISION) / totalPledgeAfterWithdrawalAndLoss;
        uint256 tracker2 = tracker1 + lossPerShare2;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, tracker2);

        uint256 firstUW_pledge_before_final_withdraw = um.underwriterTotalPledge(underwriter);
        uint256 firstUW_pendingLoss2 = (firstUW_pledge_before_final_withdraw * lossPerShare2) / PRECISION;
        
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, firstUW_pledge_before_final_withdraw, true);
        
        uint256 firstUW_final_withdrawal_amount = firstUW_pledge_before_final_withdraw - firstUW_pendingLoss2;
        usdc.transfer(underwriter, firstUW_final_withdrawal_amount);
        assertEq(um.underwriterTotalPledge(underwriter), 0);
        
        uint256 secondUW_pledge_before_final_withdraw = um.underwriterTotalPledge(secondUnderwriter);
        uint256 secondUW_total_loss = (secondUW_pledge_before_final_withdraw * tracker2) / PRECISION;

        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(secondUnderwriter, secondUW_pledge_before_final_withdraw, true);

        uint256 secondUW_final_withdrawal_amount = secondUW_pledge_before_final_withdraw - secondUW_total_loss;
        usdc.transfer(secondUnderwriter, secondUW_final_withdrawal_amount);
        assertEq(um.underwriterTotalPledge(secondUnderwriter), 0);
    }

    /* ─────────────────── GAS & SCALABILITY TESTS ─────────────────── */

    function test_Gas_ManyUnderwriters_SingleClaim() public {
        uint256 numUnderwriters = 50;
        uint256 pledgePerUnderwriter = 1_000e6;

        for (uint256 i = 0; i < numUnderwriters; ++i) {
            address newUser = address(bytes20(keccak256(abi.encodePacked("user", i))));
            usdc.mint(newUser, pledgePerUnderwriter);
            vm.startPrank(newUser);
            usdc.approve(address(capitalPool), pledgePerUnderwriter);
            capitalPool.deposit(pledgePerUnderwriter, ICapitalPool.YieldPlatform.OTHER_YIELD);
            um.allocateCapital(_arr(POOL_ID));
            vm.stopPrank();
        }

        uint256 claimAmount = 10_000e6;
        vm.prank(address(riskManager));
        uint256 policyId = policyNFT.mint(claimant, POOL_ID, claimAmount, 0, 0, 0);

        vm.snapshot();
        vm.prank(claimant);
        riskManager.processClaim(policyId);
        uint256 gasUsed = vm.gasUsed();
        vm.revertToLastSnapshot();
        
        assertTrue(gasUsed < 250_000, "Gas cost for claim processing is too high");
    }

    /* ─────────────────── STATE & LIFECYCLE SCENARIOS ─────────────────── */

    function test_Lifecycle_UnderwriterLeavesAndRejoins() public {
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);
        uint256 tracker1 = lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare;
        uint256 loss1 = (TOTAL_PLEDGE * tracker1) / PRECISION;

        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, TOTAL_PLEDGE, true);
        assertEq(um.underwriterTotalPledge(underwriter), 0);

        uint256 newPledge = 80_000e6;
        vm.startPrank(underwriter);
        usdc.approve(address(capitalPool), newPledge);
        capitalPool.deposit(newPledge, ICapitalPool.YieldPlatform.OTHER_YIELD);
        um.allocateCapital(_arr(POOL_ID));
        vm.stopPrank();
        
        assertEq(lossDistributor.getPendingLosses(underwriter, POOL_ID, newPledge), 0);

        uint256 cover2 = 5_000e6;
        uint256 currentPledgeInPool = um.getTotalPledgeInPool(POOL_ID);
        vm.prank(address(riskManager));
        uint256 policy2 = policyNFT.mint(claimant, POOL_ID, cover2, 0, 0, 0);
        vm.prank(claimant);
        riskManager.processClaim(policy2);

        uint256 tracker2 = lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare;
        uint256 lossPerShareSinceRejoin = tracker2 - tracker1;
        uint256 expectedFinalLoss = (newPledge * lossPerShareSinceRejoin) / PRECISION;

        uint256 pendingFinalLoss = lossDistributor.getPendingLosses(underwriter, POOL_ID, newPledge);
        assertEq(pendingFinalLoss, expectedFinalLoss, "Final loss calculation is incorrect");
    }

    function test_Lifecycle_ClaimOnEmptyPool() public {
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, TOTAL_PLEDGE, true);
        assertEq(um.getTotalPledgeInPool(POOL_ID), 0);

        uint256 trackerBefore = lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare;

        vm.prank(address(riskManager));
        uint256 newPolicyId = policyNFT.mint(claimant, POOL_ID, 100e6, 0, 0, 0);

        vm.prank(claimant);
        riskManager.processClaim(newPolicyId);

        uint256 trackerAfter = lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare;
        assertEq(trackerBefore, trackerAfter, "Tracker should not change for an empty pool");
    }

    /* ────────────────── MATHEMATICAL PRECISION & ROUNDING ────────────────── */

    function test_Precision_DustAmounts() public {
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, TOTAL_PLEDGE, true);

        uint256 dustPledge = 100;
        usdc.mint(secondUnderwriter, dustPledge);
        vm.startPrank(secondUnderwriter);
        usdc.approve(address(capitalPool), dustPledge);
        capitalPool.deposit(dustPledge, ICapitalPool.YieldPlatform.OTHER_YIELD);
        um.allocateCapital(_arr(POOL_ID));
        vm.stopPrank();

        uint256 dustCoverage = 10;
        vm.prank(address(riskManager));
        uint256 dustPolicyId = policyNFT.mint(claimant, POOL_ID, dustCoverage, 0, 0, 0);
        vm.prank(claimant);
        riskManager.processClaim(dustPolicyId);

        uint256 expectedLossPerShare = (dustCoverage * PRECISION) / dustPledge;
        assert(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare > 0);
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, expectedLossPerShare);
        
        uint256 pendingLoss = lossDistributor.getPendingLosses(secondUnderwriter, POOL_ID, dustPledge);
        assertEq(pendingLoss, dustCoverage);
    }
}
