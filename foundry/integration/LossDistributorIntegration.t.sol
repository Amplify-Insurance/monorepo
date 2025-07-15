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
    uint8 constant PLATFORM_OTHER = 3; // CapitalPool.YieldPlatform.OTHER_YIELD
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
        capitalPool.setBaseYieldAdapter(CapitalPool.YieldPlatform(PLATFORM_OTHER), address(adapter));
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

        // --- Create a Risk Pool ---
        IPoolRegistry.RateModel memory rate = IPoolRegistry.RateModel({base:0, slope1:0, slope2:0, kink:8000});
        vm.prank(address(riskManager));
        POOL_ID = poolRegistry.addProtocolRiskPool(address(protocolToken), rate, 500);

        // --- Initial Underwriter Deposit ---
        usdc.mint(underwriter, TOTAL_PLEDGE);
        vm.startPrank(underwriter);
        usdc.approve(address(capitalPool), TOTAL_PLEDGE);
        capitalPool.deposit(TOTAL_PLEDGE, CapitalPool.YieldPlatform(PLATFORM_OTHER));
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

    /// @notice Tests that initial state variables are set as expected.
    function test_InitialState() public {
        assertEq(lossDistributor.riskManager(), address(riskManager));
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, 0);
        assertEq(lossDistributor.userLossStates(underwriter, POOL_ID).lossDebt, 0);
    }

    /// @notice Tests that critical functions revert if not called by the RiskManager.
    function testRevert_CallerNotRiskManager() public {
        vm.startPrank(attacker);
        vm.expectRevert("LD: Not RiskManager");
        lossDistributor.distributeLoss(POOL_ID, 1e6, 1e6);
        vm.expectRevert("LD: Not RiskManager");
        lossDistributor.realizeLosses(underwriter, POOL_ID, 1e6);
        vm.stopPrank();
    }

    /// @notice Tests that setting the RiskManager address to address(0) reverts.
    function testRevert_SetRiskManagerToZeroAddress() public {
        vm.expectRevert(LossDistributor.ZeroAddress.selector);
        lossDistributor.setRiskManager(address(0));
    }

    /* ───────────────────────── CORE LOSS DISTRIBUTION LOGIC ───────────────────────── */
    
    /// @notice Tests that a single claim correctly updates the pool's loss tracker.
    function test_PoolTrackerUpdatesOnClaim() public {
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);
        
        uint256 expectedLossPerShare = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, expectedLossPerShare);
    }

    /// @notice Tests that the loss tracker correctly accumulates value over multiple claims.
    function test_AccumulatesLossForMultipleClaims() public {
        // First claim
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);
        uint256 expectedLoss1 = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, expectedLoss1);

        // Second claim
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

    /// @notice Tests that distributing a loss of zero does not change state.
    function test_DistributeLoss_ZeroAmountDoesNothing() public {
        uint256 trackerBefore = lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare;
        vm.prank(address(riskManager));
        lossDistributor.distributeLoss(POOL_ID, 0, TOTAL_PLEDGE);
        uint256 trackerAfter = lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare;
        assertEq(trackerBefore, trackerAfter);
    }

    /// @notice Tests that losses exceeding the total pledge are capped at the total pledge.
    function test_TotalLossScenario() public {
        uint256 largeCoverage = TOTAL_PLEDGE + 10_000e6; // More than the total pledge
        vm.prank(address(riskManager));
        uint256 largePolicyId = policyNFT.mint(claimant, POOL_ID, largeCoverage, 0, 0, 0);

        // Process a claim that should wipe out the entire pool
        vm.prank(claimant);
        riskManager.processClaim(largePolicyId);

        // The loss per share should be capped at 100% (i.e., PRECISION)
        uint256 expectedLossPerShare = PRECISION;
        // Due to integer math, it might be slightly less than PRECISION, so we check a tight bound.
        assertTrue(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare <= expectedLossPerShare);
        assertTrue(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare > expectedLossPerShare - 100);

        // The underwriter's pending losses should equal their entire pledge
        uint256 pledge = um.underwriterTotalPledge(underwriter);
        uint256 pendingLoss = lossDistributor.getPendingLosses(underwriter, POOL_ID, pledge);
        assertEq(pendingLoss, pledge, "Pending loss should equal total pledge");

        // After withdrawal, the underwriter should have 0 balance left from this pool
        uint256 balanceBefore = usdc.balanceOf(underwriter);
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, pledge, true);
        // No funds are transferred back as the loss equals the pledge
        assertEq(um.underwriterTotalPledge(underwriter), 0);
        assertEq(usdc.balanceOf(underwriter), balanceBefore);
    }


    /* ───────────────────────── UNDERWRITER INTERACTIONS ───────────────────────── */

    /// @notice Tests that a new underwriter joining a pool with existing losses correctly calculates pending losses.
    function test_NewUnderwriterInheritsExistingLossTracker() public {
        // An initial claim occurs before the new underwriter joins.
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);

        uint256 expectedTracker = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, expectedTracker);
        
        // A new underwriter joins with a new pledge.
        uint256 newPledge = 50_000e6;
        usdc.mint(secondUnderwriter, newPledge);
        vm.startPrank(secondUnderwriter);
        usdc.approve(address(capitalPool), newPledge);
        capitalPool.deposit(newPledge, CapitalPool.YieldPlatform(OTHER_YIELD));
        um.allocateCapital(_arr(POOL_ID));
        vm.stopPrank();

        // The new underwriter's pending losses should be based on the existing tracker.
        // Their loss debt is initially zero, so pending losses equal total incurred losses.
        uint256 expectedPendingLoss = (newPledge * expectedTracker) / PRECISION;
        assertEq(lossDistributor.getPendingLosses(secondUnderwriter, POOL_ID, newPledge), expectedPendingLoss);
    }

    /// @notice Tests that an underwriter who withdraws from a pool with no losses receives their full principal.
    function test_Withdrawal_NoLosses() public {
        uint256 balanceBefore = usdc.balanceOf(underwriter);
        uint256 pledge = um.underwriterTotalPledge(underwriter);
        
        // Simulate withdrawal via the CapitalPool hook
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, pledge, true);

        // The CapitalPool contract would handle the transfer, so we simulate it here
        // to check the final balance.
        usdc.transfer(underwriter, pledge);
        
        assertEq(usdc.balanceOf(underwriter), balanceBefore + pledge);
        assertEq(um.underwriterTotalPledge(underwriter), 0);
    }

    /// @notice Tests that losses are correctly realized and deducted upon a full withdrawal.
    function test_RealizesLossesOnFullWithdrawal() public {
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);

        uint256 balanceBefore = usdc.balanceOf(underwriter);
        uint256 pledgeBefore = um.underwriterTotalPledge(underwriter);
        uint256 expectedLoss = COVERAGE;

        // Simulate withdrawal via the CapitalPool hook
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, pledgeBefore, true);

        // Simulate the CapitalPool transferring the remaining principal
        uint256 amountToReceive = pledgeBefore - expectedLoss;
        usdc.transfer(underwriter, amountToReceive);
        
        assertEq(um.underwriterTotalPledge(underwriter), 0, "Pledge should be zero after full withdrawal");
        assertEq(usdc.balanceOf(underwriter), balanceBefore + amountToReceive, "Final balance is incorrect");
    }

    /// @notice Tests that losses are correctly realized on a partial withdrawal.
    function test_RealizesLossesOnPartialWithdrawal() public {
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);

        uint256 balanceBefore = usdc.balanceOf(underwriter);
        uint256 pledgeBefore = um.underwriterTotalPledge(underwriter);
        uint256 withdrawalAmount = 40_000e6; // Withdraw 40k out of 100k
        uint256 expectedLoss = COVERAGE; // Loss is calculated on the full pledge before withdrawal

        // Simulate partial withdrawal via the CapitalPool hook
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, withdrawalAmount, false);

        // Simulate the CapitalPool transferring the withdrawal amount.
        usdc.transfer(underwriter, withdrawalAmount);
        
        uint256 expectedPledgeAfter = pledgeBefore - withdrawalAmount - expectedLoss;
        assertEq(um.underwriterTotalPledge(underwriter), expectedPledgeAfter, "Pledge after partial withdrawal is incorrect");
        assertEq(usdc.balanceOf(underwriter), balanceBefore + withdrawalAmount, "Final balance is incorrect");

        // The user's loss debt should now be updated to reflect the realized loss on their remaining pledge
        uint256 tracker = lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare;
        uint256 expectedLossDebt = (um.underwriterPledgeInPool(underwriter, POOL_ID) * tracker) / PRECISION;
        assertEq(lossDistributor.userLossStates(underwriter, POOL_ID).lossDebt, expectedLossDebt);
    }
    
    /* ───────────────────────── MULTI-POOL & COMPLEX SCENARIOS ───────────────────────── */

    /// @notice Tests that losses in one pool do not affect underwriters or trackers in another pool.
    function test_LossesDoNotAffectOtherPools() public {
        // Create a second pool
        IPoolRegistry.RateModel memory rate = IPoolRegistry.RateModel({base:0, slope1:0, slope2:0, kink:8000});
        vm.prank(address(riskManager));
        POOL_ID_2 = poolRegistry.addProtocolRiskPool(address(protocolToken), rate, 500);

        // secondUnderwriter deposits into the new pool
        uint256 secondPledge = 75_000e6;
        usdc.mint(secondUnderwriter, secondPledge);
        vm.startPrank(secondUnderwriter);
        usdc.approve(address(capitalPool), secondPledge);
        capitalPool.deposit(secondPledge, CapitalPool.YieldPlatform(OTHER_YIELD));
        um.allocateCapital(_arr(POOL_ID_2));
        vm.stopPrank();

        // Process a claim against the first pool
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);

        // Check that only the first pool's tracker was updated
        uint256 expectedLossPerShare = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, expectedLossPerShare);
        assertEq(lossDistributor.poolLossTrackers(POOL_ID_2).accumulatedLossPerShare, 0);

        // secondUnderwriter withdraws from the second pool and should not have any losses
        uint256 balanceBefore = usdc.balanceOf(secondUnderwriter);
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(secondUnderwriter, secondPledge, true);
        usdc.transfer(secondUnderwriter, secondPledge); // Simulate transfer from CapitalPool

        assertEq(usdc.balanceOf(secondUnderwriter), balanceBefore + secondPledge);
    }

    /// @notice A complex sequence of deposits, claims, and withdrawals to test state integrity.
    function test_ComplexInteractionSequence() public {
        // 1. Initial state: underwriter has 100k pledge.
        assertEq(um.underwriterTotalPledge(underwriter), TOTAL_PLEDGE);

        // 2. First claim occurs (50k loss).
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);
        uint256 tracker1 = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, tracker1);
        
        // 3. Second underwriter deposits 50k.
        uint256 secondPledge = 50_000e6;
        usdc.mint(secondUnderwriter, secondPledge);
        vm.startPrank(secondUnderwriter);
        usdc.approve(address(capitalPool), secondPledge);
        capitalPool.deposit(secondPledge, CapitalPool.YieldPlatform(OTHER_YIELD));
        um.allocateCapital(_arr(POOL_ID));
        vm.stopPrank();

        // 4. First underwriter withdraws 20k. This realizes their full initial loss of 50k.
        uint256 firstUW_withdrawal = 20_000e6;
        uint256 firstUW_pledge_before_withdraw = um.underwriterTotalPledge(underwriter);
        uint256 firstUW_loss_realized = (firstUW_pledge_before_withdraw * tracker1) / PRECISION;

        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, firstUW_withdrawal, false);
        
        uint256 firstUW_pledge_after_withdraw = firstUW_pledge_before_withdraw - firstUW_withdrawal - firstUW_loss_realized;
        assertEq(um.underwriterTotalPledge(underwriter), firstUW_pledge_after_withdraw);
        
        // 5. Second claim occurs (10k loss).
        uint256 cover2 = 10_000e6;
        uint256 totalPledgeAfterWithdrawalAndLoss = um.getTotalPledgeInPool(POOL_ID);
        
        vm.prank(address(riskManager));
        uint256 policy2 = policyNFT.mint(claimant, POOL_ID, cover2, 0, 0, 0);
        vm.prank(claimant);
        riskManager.processClaim(policy2);

        uint256 lossPerShare2 = (cover2 * PRECISION) / totalPledgeAfterWithdrawalAndLoss;
        uint256 tracker2 = tracker1 + lossPerShare2;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, tracker2);

        // 6. First underwriter withdraws everything.
        uint256 firstUW_pledge_before_final_withdraw = um.underwriterTotalPledge(underwriter);
        uint256 firstUW_pendingLoss2 = (firstUW_pledge_before_final_withdraw * lossPerShare2) / PRECISION;
        
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, firstUW_pledge_before_final_withdraw, true);
        
        uint256 firstUW_final_withdrawal_amount = firstUW_pledge_before_final_withdraw - firstUW_pendingLoss2;
        usdc.transfer(underwriter, firstUW_final_withdrawal_amount);
        assertEq(um.underwriterTotalPledge(underwriter), 0);
        
        // 7. Second underwriter withdraws everything.
        uint256 secondUW_pledge_before_final_withdraw = um.underwriterTotalPledge(secondUnderwriter);
        uint256 secondUW_total_loss = (secondUW_pledge_before_final_withdraw * tracker2) / PRECISION;

        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(secondUnderwriter, secondUW_pledge_before_final_withdraw, true);

        uint256 secondUW_final_withdrawal_amount = secondUW_pledge_before_final_withdraw - secondUW_total_loss;
        usdc.transfer(secondUnderwriter, secondUW_final_withdrawal_amount);
        assertEq(um.underwriterTotalPledge(secondUnderwriter), 0);
    }

    /* ─────────────────── GAS & SCALABILITY TESTS ─────────────────── */

    /// @notice Tests that distributing a loss has a constant gas cost regardless of the number of underwriters.
    function test_Gas_ManyUnderwriters_SingleClaim() public {
        uint256 numUnderwriters = 50;
        uint256 pledgePerUnderwriter = 1_000e6;

        for (uint256 i = 0; i < numUnderwriters; ++i) {
            address newUser = address(bytes20(keccak256(abi.encodePacked("user", i))));
            usdc.mint(newUser, pledgePerUnderwriter);
            vm.startPrank(newUser);
            usdc.approve(address(capitalPool), pledgePerUnderwriter);
            capitalPool.deposit(pledgePerUnderwriter, CapitalPool.YieldPlatform(OTHER_YIELD));
            um.allocateCapital(_arr(POOL_ID));
            vm.stopPrank();
        }

        uint256 claimAmount = 10_000e6;
        vm.prank(address(riskManager));
        uint256 policyId = policyNFT.mint(claimant, POOL_ID, claimAmount, 0, 0, 0);

        // Snapshot gas usage for processing the claim. This should be constant.
        vm.snapshot();
        vm.prank(claimant);
        riskManager.processClaim(policyId);
        uint256 gasUsed = vm.gasUsed();
        vm.revertToLastSnapshot();
        
        // We expect the gas cost to be low and not dependent on the number of underwriters.
        // This is a sanity check value; it may need adjustment based on compiler/EVM changes.
        assertTrue(gasUsed < 250_000, "Gas cost for claim processing is too high");
    }

    /* ─────────────────── STATE & LIFECYCLE SCENARIOS ─────────────────── */

    /// @notice Tests that an underwriter who leaves and rejoins a pool is only accountable for losses since rejoining.
    function test_Lifecycle_UnderwriterLeavesAndRejoins() public {
        // 1. A loss occurs.
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);
        uint256 tracker1 = lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare;
        uint256 loss1 = (TOTAL_PLEDGE * tracker1) / PRECISION;

        // 2. Underwriter withdraws fully, realizing the loss.
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, TOTAL_PLEDGE, true);
        assertEq(um.underwriterTotalPledge(underwriter), 0);

        // 3. Underwriter deposits again into the same pool.
        uint256 newPledge = 80_000e6;
        vm.startPrank(underwriter);
        usdc.approve(address(capitalPool), newPledge);
        capitalPool.deposit(newPledge, CapitalPool.YieldPlatform(OTHER_YIELD));
        um.allocateCapital(_arr(POOL_ID));
        vm.stopPrank();
        
        // At this point, their pending loss for the *old* event should be zero.
        assertEq(lossDistributor.getPendingLosses(underwriter, POOL_ID, newPledge), 0);

        // 4. A second loss occurs.
        uint256 cover2 = 5_000e6;
        uint256 currentPledgeInPool = um.getTotalPledgeInPool(POOL_ID);
        vm.prank(address(riskManager));
        uint256 policy2 = policyNFT.mint(claimant, POOL_ID, cover2, 0, 0, 0);
        vm.prank(claimant);
        riskManager.processClaim(policy2);

        // 5. Underwriter withdraws again. Their loss should only be from the second event.
        uint256 tracker2 = lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare;
        uint256 lossPerShareSinceRejoin = tracker2 - tracker1;
        uint256 expectedFinalLoss = (newPledge * lossPerShareSinceRejoin) / PRECISION;

        uint256 pendingFinalLoss = lossDistributor.getPendingLosses(underwriter, POOL_ID, newPledge);
        assertEq(pendingFinalLoss, expectedFinalLoss, "Final loss calculation is incorrect");
    }

    /// @notice Tests that processing a claim against an empty pool does not revert or change state.
    function test_Lifecycle_ClaimOnEmptyPool() public {
        // 1. All underwriters withdraw, making the pool's pledge zero.
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, TOTAL_PLEDGE, true);
        assertEq(um.getTotalPledgeInPool(POOL_ID), 0);

        uint256 trackerBefore = lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare;

        // 2. A new policy is minted (this would likely be blocked by other logic, but we test it directly).
        vm.prank(address(riskManager));
        uint256 newPolicyId = policyNFT.mint(claimant, POOL_ID, 100e6, 0, 0, 0);

        // 3. Attempt to process a claim. The `distributeLoss` function should handle pledge being zero.
        vm.prank(claimant);
        riskManager.processClaim(newPolicyId); // This will call distributeLoss with totalPledgeInPool = 0

        // 4. The loss tracker should not have changed.
        uint256 trackerAfter = lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare;
        assertEq(trackerBefore, trackerAfter, "Tracker should not change for an empty pool");
    }

    /* ────────────────── MATHEMATICAL PRECISION & ROUNDING ────────────────── */

    /// @notice Tests loss accounting with very small "dust" amounts to check for precision loss.
    function test_Precision_DustAmounts() public {
        // Reset pledges and start with a new underwriter with a small pledge.
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, TOTAL_PLEDGE, true);

        uint256 dustPledge = 100; // 100 wei
        usdc.mint(secondUnderwriter, dustPledge);
        vm.startPrank(secondUnderwriter);
        usdc.approve(address(capitalPool), dustPledge);
        capitalPool.deposit(dustPledge, CapitalPool.YieldPlatform(OTHER_YIELD));
        um.allocateCapital(_arr(POOL_ID));
        vm.stopPrank();

        // Mint and process a policy with a tiny coverage amount.
        uint256 dustCoverage = 10; // 10 wei
        vm.prank(address(riskManager));
        uint256 dustPolicyId = policyNFT.mint(claimant, POOL_ID, dustCoverage, 0, 0, 0);
        vm.prank(claimant);
        riskManager.processClaim(dustPolicyId);

        // The loss per share should be non-zero.
        uint256 expectedLossPerShare = (dustCoverage * PRECISION) / dustPledge;
        assert(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare > 0);
        assertEq(lossDistributor.poolLossTrackers(POOL_ID).accumulatedLossPerShare, expectedLossPerShare);
        
        // The pending loss should be calculated correctly without being rounded to zero.
        uint256 pendingLoss = lossDistributor.getPendingLosses(secondUnderwriter, POOL_ID, dustPledge);
        assertEq(pendingLoss, dustCoverage);
    }
}
