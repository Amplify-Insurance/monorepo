// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ICapitalPool} from "contracts/interfaces/ICapitalPool.sol";
import {RiskManager, DeallocationRequested, UnderwriterLiquidated} from "contracts/core/RiskManager.sol";
import {MockCapitalPool} from "contracts/test/MockCapitalPool.sol";
import {MockPoolRegistry} from "contracts/test/MockPoolRegistry.sol";
import {MockPolicyNFT} from "contracts/test/MockPolicyNFT.sol";
import {MockBackstopPool} from "contracts/test/MockBackstopPool.sol";
import {MockLossDistributor} from "contracts/test/MockLossDistributor.sol";
import {MockPolicyManager} from "contracts/test/MockPolicyManager.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
// FIX: Import Ownable to access its custom errors
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract RiskManagerTest is Test {
    // ... (setUp and other variables remain the same) ...
    RiskManager rm;
    MockCapitalPool cp;
    MockPoolRegistry pr;
    MockPolicyNFT nft;
    MockBackstopPool cat;
    MockLossDistributor ld;
    MockPolicyManager pm;
    MockRewardDistributor rd;
    MockERC20 token;

    address committee = address(0xBEEF);
    address underwriter = address(0xFACE);

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        cp = new MockCapitalPool(address(this), address(token));
        pr = new MockPoolRegistry();
        nft = new MockPolicyNFT(address(this));
        pm = new MockPolicyManager();
        pm.setPolicyNFT(address(nft));
        cat = new MockBackstopPool(address(this));
        ld = new MockLossDistributor();
        rd = new MockRewardDistributor();
        rm = new RiskManager(address(this));
        nft.setCoverPoolAddress(address(rm));
        rd.setCatPool(address(cat));

        rm.setAddresses(address(cp), address(pr), address(pm), address(cat), address(ld), address(rd));
        rm.setCommittee(committee);
    }
    

    function testAllocateCapital() public {
        uint256 pledge = 10_000 * 1e6;
        cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
        cp.setUnderwriterAdapterAddress(underwriter, address(1));
        pr.setPoolCount(2);

        uint256[] memory pools = new uint256[](2);
        pools[0] = 0;
        pools[1] = 1;

        vm.prank(underwriter);
        rm.allocateCapital(pools);

        assertTrue(rm.isAllocatedToPool(underwriter, 0));
        assertTrue(rm.isAllocatedToPool(underwriter, 1));
    }

    function testDeallocateFromPool() public {
        uint256 pledge = 5_000 * 1e6;
        cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
        cp.setUnderwriterAdapterAddress(underwriter, address(1));
        pr.setPoolCount(1);
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);

        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        vm.prank(underwriter);
        rm.allocateCapital(pools);

        ld.setPendingLoss(underwriter, 0, 0);
        vm.prank(underwriter);
        rm.requestDeallocateFromPool(0, 5000 * 1e6);
        vm.prank(underwriter);
        rm.deallocateFromPool(0);

        assertFalse(rm.isAllocatedToPool(underwriter, 0));
    }


function testAllocateCapitalRevertsWithoutDeposit() public {
    cp.setUnderwriterAdapterAddress(underwriter, address(1));
    pr.setPoolCount(1);
    uint256[] memory pools = new uint256[](1);
    pools[0] = 0;
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.NoCapitalToAllocate.selector);
    rm.allocateCapital(pools);
}

function testAllocateCapitalRevertsWithoutAdapter() public {
    cp.triggerOnCapitalDeposited(address(rm), underwriter, 1000);
    pr.setPoolCount(1);
    uint256[] memory pools = new uint256[](1);
    pools[0] = 0;
    vm.prank(underwriter);
    vm.expectRevert("User has no yield adapter set in CapitalPool");
    rm.allocateCapital(pools);
}

    function testAllocateCapitalRevertsInvalidPoolId() public {
        cp.triggerOnCapitalDeposited(address(rm), underwriter, 1000);
        cp.setUnderwriterAdapterAddress(underwriter, address(1));
        pr.setPoolCount(1);
        uint256[] memory pools = new uint256[](1);
        pools[0] = 1;
        vm.prank(underwriter);
        // FIX: Use the custom error selector, not a string.
        vm.expectRevert(RiskManager.InvalidPoolId.selector);
        rm.allocateCapital(pools);
    }


function testDeallocateRealizesLoss() public {
    cp.triggerOnCapitalDeposited(address(rm), underwriter, 1000);
    cp.setUnderwriterAdapterAddress(underwriter, address(1));
    pr.setPoolCount(1);
    uint256[] memory pools = new uint256[](1);
    pools[0] = 0;
    vm.prank(underwriter);
    rm.allocateCapital(pools);

    ld.setPendingLoss(underwriter, 0, 200);
    vm.prank(underwriter);
    rm.requestDeallocateFromPool(0, 500);
    vm.prank(underwriter);
    rm.deallocateFromPool(0);

    assertEq(cp.applyLossesCallCount(), 1);
    assertEq(cp.last_applyLosses_underwriter(), underwriter);
    assertEq(cp.last_applyLosses_principalLossAmount(), 200);
    assertEq(rm.underwriterTotalPledge(underwriter), 800);
}

    function testClaimPremiumRewards() public {
        uint256 pledge = 1000;
        cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
        pr.setPoolCount(1);
        pr.setPoolData(0, token, 0, 0, 0, false, address(0), 0);
        pr.setPoolCount(1);
        
        // FIX: The allocateCapital function requires an adapter to be set.
        cp.setUnderwriterAdapterAddress(underwriter, address(1));

        uint256[] memory ids = new uint256[](1);
        ids[0] = 0;
        
        // FIX: The user must first allocate capital to have a pool-specific pledge.
        vm.prank(underwriter);
        rm.allocateCapital(ids);

        vm.prank(underwriter);
        rm.claimPremiumRewards(ids);
    
    assertEq(rd.claimCallCount(), 1);
    assertEq(rd.lastClaimUser(), underwriter);
    assertEq(rd.lastClaimPoolId(), 0);
    assertEq(rd.lastClaimToken(), address(token));
    assertEq(rd.lastClaimPledge(), 1000);
}

function testClaimDistressedAssets() public {
    pr.setPoolData(0, token, 0, 0, 0, false, address(0), 0);
    uint256[] memory ids2 = new uint256[](1);
    ids2[0] = 0;
    vm.prank(underwriter);
    rm.claimDistressedAssets(ids2);
    assertEq(cat.claimProtocolRewardsCallCount(), 1);
    assertEq(cat.last_claimProtocolToken(), address(token));
}

function testUpdateCoverageSoldOnlyPolicyManager() public {
    pr.setPoolData(0, token, 0, 0, 0, false, address(0), 0);
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.NotPolicyManager.selector);
    rm.updateCoverageSold(0, 100, true);

    vm.prank(address(pm));
    rm.updateCoverageSold(0, 100, true);
    (, , uint256 sold,, , ,) = pr.getPoolData(0);
    assertEq(sold, 100);
}

function testReportIncidentOnlyCommittee() public {
    pr.setPoolCount(1);
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.NotCommittee.selector);
    rm.reportIncident(0, true);

    vm.prank(committee);
    rm.reportIncident(0, true);
    (, , , , bool paused,,) = pr.getPoolData(0);
    assertTrue(paused);
}

function testSetPoolFeeRecipientOnlyCommittee() public {
    pr.setPoolCount(1);
    address recipient = address(123);
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.NotCommittee.selector);
    rm.setPoolFeeRecipient(0, recipient);

    vm.prank(committee);
    rm.setPoolFeeRecipient(0, recipient);
    (, , , , , address feeRecipient,) = pr.getPoolData(0);
    assertEq(feeRecipient, recipient);
}

function testOnCapitalDepositedOnlyCapitalPool() public {
    vm.expectRevert(RiskManager.NotCapitalPool.selector);
    rm.onCapitalDeposited(underwriter, 500);

    cp.triggerOnCapitalDeposited(address(rm), underwriter, 500);
    assertEq(rm.underwriterTotalPledge(underwriter), 500);
}

    function test_requestDeallocateFromPool_succeeds() public {
        // --- Setup ---
        uint256 pledge = 10_000 * 1e6;
        uint256 deallocateAmount = 4_000 * 1e6;
        uint256 poolId = 0;

        cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
        cp.setUnderwriterAdapterAddress(underwriter, address(1));
        pr.setPoolCount(1);
        uint256[] memory pools = new uint256[](1);
        pools[0] = poolId;
        vm.prank(underwriter);
        rm.allocateCapital(pools);
        pr.setPoolData(poolId, token, 1_000_000 * 1e6, 500_000 * 1e6, 0, false, address(0), 0);

        // --- Action ---
        // Fix 1: The 'emit' keyword is not used here.
        // vm.expectEmit checks the next external call for this event.
        vm.expectEmit(true, true, true, false);
        emit DeallocationRequested(underwriter, poolId, deallocateAmount, block.timestamp);
        vm.prank(underwriter);
        rm.requestDeallocateFromPool(poolId, deallocateAmount);

        // --- Assertions ---
        assertEq(rm.deallocationRequestTimestamp(underwriter, poolId), block.timestamp);
        assertEq(rm.deallocationRequestAmount(underwriter, poolId), deallocateAmount);
        (uint256 lastPoolId, uint256 lastAmount, bool lastIsRequest) = pr.get_last_updateCapitalPendingWithdrawal();
        assertEq(lastPoolId, poolId);
        assertEq(lastAmount, deallocateAmount);
        assertTrue(lastIsRequest);
    }

function test_requestDeallocate_reverts_ifRequestAlreadyPending() public {
    // --- Setup ---
    // Create an initial, valid deallocation request
    test_requestDeallocateFromPool_succeeds();

    // --- Action & Assertion ---
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.DeallocationRequestPending.selector);
    rm.requestDeallocateFromPool(0, 1_000 * 1e6); // Attempt to request again
}

function test_requestDeallocate_reverts_ifInsufficientFreeCapital() public {
    // --- Setup ---
    uint256 pledge = 10_000 * 1e6;
    uint256 deallocateAmount = 4_000 * 1e6;
    uint256 poolId = 0;
    cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
    cp.setUnderwriterAdapterAddress(underwriter, address(1));
    pr.setPoolCount(1);
    uint256[] memory pools = new uint256[](1);
    pools[0] = poolId;
    vm.prank(underwriter);
    rm.allocateCapital(pools);

    // Pool has INSUFFICIENT free capital (Pledged - Sold < deallocateAmount)
    pr.setPoolData(poolId, token, 1_000_000 * 1e6, 999_000 * 1e6, 0, false, address(0), 0);

    // --- Action & Assertion ---
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.InsufficientFreeCapital.selector);
    rm.requestDeallocateFromPool(poolId, deallocateAmount);
}

    function test_liquidateInsolventUnderwriter_succeeds() public {
        // --- Setup ---
        uint256 pledge = 10_000 * 1e6;
        uint256 poolId = 0;
        address keeper = address(0xDEAD);

        cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
        cp.setUnderwriterAdapterAddress(underwriter, address(1));
        pr.setPoolCount(1);
        uint256[] memory pools = new uint256[](1);
        pools[0] = poolId;
        vm.prank(underwriter);
        rm.allocateCapital(pools);

        uint256 pendingLosses = 5_000 * 1e6;
        uint256 shareValue = 4_000 * 1e6;
        ld.setPendingLosses(underwriter, poolId, pledge, pendingLosses);
        cp.setUnderwriterAccount(underwriter, 0, shareValue, 0, 0);

        // --- Action ---
        // Fix 1: The 'emit' keyword is not used here.
        vm.expectEmit(true, true, false, false);
        emit UnderwriterLiquidated(keeper, underwriter);
        vm.prank(keeper);
        rm.liquidateInsolventUnderwriter(underwriter);

        // --- Assertions ---
        assertEq(cp.applyLossesCallCount(), 1, "applyLosses should be called once");
        assertEq(cp.last_applyLosses_underwriter(), underwriter);
        assertEq(cp.last_applyLosses_principalLossAmount(), pendingLosses);
    }

    function test_liquidateInsolventUnderwriter_reverts_ifNotIntsolvent() public {
        uint256 pledge = 10_000 * 1e6;
        cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
        cp.setUnderwriterAccount(underwriter, 0, 10_000 * 1e6, 0, 0);
        cp.setSharesToValue(10_000 * 1e6, 10_000 * 1e6);
        ld.setPendingLosses(underwriter, 0, pledge, 100 * 1e6);

        // FIX: The underwriter must be allocated to a pool for the loss calculation to run.
        cp.setUnderwriterAdapterAddress(underwriter, address(1));
        pr.setPoolCount(1);
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        vm.prank(underwriter);
        rm.allocateCapital(pools);

        vm.prank(address(0xDEAD));
        vm.expectRevert(RiskManager.UnderwriterNotInsolvent.selector);
        rm.liquidateInsolventUnderwriter(underwriter);
    }


function test_processClaim_succeeds_whenCoverageIsMet() public {
    // --- Setup ---
    uint256 poolId = 0;
    uint256 policyId = 1;
    address claimant = address(0xAD4E);
    uint256 coverageAmount = 50_000 * 1e6; // $50,000 coverage
    uint256 underwriterPledge = 100_000 * 1e6; // Underwriter pledges $100,000

    // 1. Setup Underwriter and Pool Capitalization
    cp.triggerOnCapitalDeposited(address(rm), underwriter, underwriterPledge);
    address adapter = address(0xA1);
    cp.setUnderwriterAdapterAddress(underwriter, adapter);
    pr.setPoolCount(1);
    uint256[] memory pools = new uint256[](1);
    pools[0] = poolId;
    vm.prank(underwriter);
    rm.allocateCapital(pools); // Underwriter is now backing the pool

    // 2. Setup Pool Payout Data
    address[] memory adapters = new address[](1);
    adapters[0] = adapter;
    uint256[] memory capitalPerAdapter = new uint256[](1);
    capitalPerAdapter[0] = underwriterPledge;
    pr.setPoolPayoutData(poolId, adapters, capitalPerAdapter, underwriterPledge);

    // 3. Setup Pool Data (Fees, token, etc.)
    // Let's assume the underlying asset (in CapitalPool) is also USDC (6 decimals)
    // The protocol token is the same as the underlying for simplicity
    cp.setUnderlyingAsset(address(token));
    uint256 claimFeeBps = 500; // 5%
    pr.setPoolData(poolId, token, underwriterPledge, 0, 0, false, committee, claimFeeBps);

    // 4. Setup the Policy NFT
    // Advance time so the policy start timestamp doesn't underflow
    vm.warp(block.timestamp + 1 days);
    nft.setPolicy(policyId, poolId, coverageAmount, block.timestamp - 1 days);
    nft.setOwnerOf(policyId, claimant);
    pm.setPolicyNFT(address(nft)); // Ensure PolicyManager knows the NFT contract

    // 5. Claimant needs to pay the protocol premium, so we mint them tokens and they approve the RM
    uint256 premium = coverageAmount; // In this system, premium seems to be the coverage itself paid in protocol tokens
    token.mint(claimant, premium);
    vm.prank(claimant);
    token.approve(address(rm), premium);

    // --- Action ---
    vm.prank(claimant);
    rm.processClaim(policyId);

    // --- Assertions ---
    // Check every external interaction from processClaim

    // 1. Premium Distribution
    assertEq(rd.distributeCallCount(), 1);
    assertEq(rd.last_distribute_poolId(), poolId);
    assertEq(rd.last_distribute_protocolToken(), address(token));
    assertEq(rd.last_distribute_amount(), premium);

    // 2. Loss Distribution
    assertEq(ld.distributeLossCallCount(), 1);
    assertEq(ld.last_distributeLoss_poolId(), poolId);
    assertEq(ld.last_distributeLoss_lossAmount(), coverageAmount);

    // 3. Capital Pool Payout (The most complex assertion)
    assertEq(cp.executePayoutCallCount(), 1);
    ICapitalPool.PayoutData memory payoutData = cp.last_executePayout_payoutData();
    uint256 expectedFee = (coverageAmount * claimFeeBps) / rm.BPS();
    assertEq(payoutData.claimant, claimant);
    assertEq(payoutData.claimantAmount, coverageAmount - expectedFee);
    assertEq(payoutData.feeRecipient, committee);
    assertEq(payoutData.feeAmount, expectedFee);
    assertEq(payoutData.totalCapitalFromPoolLPs, underwriterPledge);

    // 4. Capital Allocation Update in PoolRegistry (reduced by the loss)
    (uint256 lastUpdatePoolId, , uint256 lastUpdateAmount, bool lastIsAllocation) = pr.get_last_updateCapitalAllocation();
    assertEq(lastUpdatePoolId, poolId);
    assertEq(lastUpdateAmount, coverageAmount); // Capital is reduced by the loss borne by the pool
    assertFalse(lastIsAllocation);

    // 5. NFT Burn
    assertEq(nft.burnCallCount(), 1);
    assertEq(nft.lastBurnedTokenId(), policyId);
}


function test_allocateCapital_reverts_ifExceedsMaxAllocations() public {
    // --- Setup ---
    // 1. Set the max allocations to a small number
    uint256 maxAllocations = 2;
    rm.setMaxAllocationsPerUnderwriter(maxAllocations);

    // 2. Give the underwriter capital and an adapter
    cp.triggerOnCapitalDeposited(address(rm), underwriter, 10_000 * 1e6);
    cp.setUnderwriterAdapterAddress(underwriter, address(1));
    pr.setPoolCount(3); // Ensure enough pools exist

    // 3. Create an array of pools that is larger than the max
    uint256[] memory pools = new uint256[](maxAllocations + 1);
    pools[0] = 0;
    pools[1] = 1;
    pools[2] = 2;

    // --- Action & Assertion ---
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.ExceedsMaxAllocations.selector);
    rm.allocateCapital(pools);
}

function test_allocateCapital_reverts_ifAlreadyAllocated() public {
    // --- Setup ---
    // 1. Give the underwriter capital and an adapter
    cp.triggerOnCapitalDeposited(address(rm), underwriter, 10_000 * 1e6);
    cp.setUnderwriterAdapterAddress(underwriter, address(1));
    pr.setPoolCount(2);

    // 2. Allocate to pool 0 successfully
    uint256[] memory initialPools = new uint256[](1);
    initialPools[0] = 0;
    vm.prank(underwriter);
    rm.allocateCapital(initialPools);

    // 3. Prepare a new allocation that includes the already-allocated pool 0
    uint256[] memory newPools = new uint256[](2);
    newPools[0] = 1; // A new pool
    newPools[1] = 0; // The already-allocated pool

    // --- Action & Assertion ---
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.AlreadyAllocated.selector);
    rm.allocateCapital(newPools);
}

function test_deallocateFromPool_reverts_ifNoDeallocationRequest() public {
    // --- Setup ---
    // User is allocated but has NOT made a deallocation request
    testAllocateCapital(); // Use existing test to set up an allocated state

    // --- Action & Assertion ---
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.NoDeallocationRequest.selector);
    rm.deallocateFromPool(0);
}

function test_deallocateFromPool_reverts_ifNoticePeriodActive() public {
    // --- Setup ---
    // 1. Set a notice period
    uint256 noticePeriod = 7 days;
    rm.setDeallocationNoticePeriod(noticePeriod);

    // 2. Create a valid deallocation request
    test_requestDeallocateFromPool_succeeds();

    // 3. Advance time, but NOT enough to pass the notice period
    vm.warp(block.timestamp + 1 days);

    // --- Action & Assertion ---
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.NoticePeriodActive.selector);
    rm.deallocateFromPool(0);
}

function test_setAddresses_permissions() public {
    // --- Revert Test (Non-Owner) ---
    vm.prank(underwriter);
    vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", underwriter)); // CORRECT
    rm.setAddresses(address(cp), address(pr), address(pm), address(cat), address(ld), address(rd));

    // --- Happy Path (Owner) ---
    // Note: The addresses are already set in setUp(), so we just confirm one.
    assertEq(address(rm.capitalPool()), address(cp));
}

   function test_setCommittee_permissions() public {
        address newCommittee = address(0xC0FFEE);
        vm.prank(underwriter);
        // FIX: Use the custom error from Ownable, not a string.
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", underwriter));
        rm.setCommittee(newCommittee);
    }

    function test_setMaxAllocationsPerUnderwriter_permissions() public {
        uint256 newMax = 10;
        vm.prank(underwriter);
        // FIX: Use the custom error from Ownable, not a string.
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", underwriter));
        rm.setMaxAllocationsPerUnderwriter(newMax);

        vm.expectRevert("Invalid max");
        rm.setMaxAllocationsPerUnderwriter(0);
    }


function test_onWithdrawalRequested_hook() public {
    // --- Setup ---
    uint256 pledge = 10_000 * 1e6;
    uint256[] memory pools = new uint256[](2);
    pools[0] = 0;
    pools[1] = 1;

    // 1. Allocate underwriter to two pools
    cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
    cp.setUnderwriterAdapterAddress(underwriter, address(1));
    pr.setPoolCount(2);
    uint256 principalComponent = 5_000 * 1e6;
    pr.setPoolData(0, token, 0, principalComponent, principalComponent, false, address(0), 0);
    pr.setPoolData(1, token, 0, principalComponent, principalComponent, false, address(0), 0);
    vm.prank(underwriter);
    rm.allocateCapital(pools);

    // --- Action ---
    // 2. Simulate the CapitalPool calling the hook
    cp.triggerOnWithdrawalRequested(address(rm), underwriter, principalComponent);

    // --- Assertions ---
    // Check that PoolRegistry was updated for both pools
    assertEq(pr.updateCapitalPendingWithdrawalCallCount(), 2);
    (uint256 lastPoolId, uint256 lastAmount, bool lastIsRequest) = pr.get_last_updateCapitalPendingWithdrawal();
    assertEq(lastPoolId, 1, "Should update the last pool in the loop");
    assertEq(lastAmount, principalComponent);
    assertTrue(lastIsRequest, "Should be a withdrawal request (true)");

    // Check that RewardDistributor was updated for both pools
    assertEq(rd.updateUserStateCallCount(), 2);
    assertEq(rd.last_updateUserState_user(), underwriter);
    assertEq(rd.last_updateUserState_poolId(), 1, "Should update the last pool in the loop");
}


function test_onWithdrawalCancelled_hook() public {
    // --- Setup ---
    uint256 pledge = 10_000 * 1e6;
    uint256 principalComponent = 5_000 * 1e6;
    uint256[] memory pools = new uint256[](2);
    pools[0] = 0;
    pools[1] = 1;

    cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
    cp.setUnderwriterAdapterAddress(underwriter, address(1));
    pr.setPoolCount(2);
    // This setup correctly creates a state where a pending withdrawal can be cancelled.
    pr.setPoolData(0, token, pledge, 0, principalComponent, false, address(0), 0);
    pr.setPoolData(1, token, pledge, 0, principalComponent, false, address(0), 0);
    vm.prank(underwriter);
    rm.allocateCapital(pools);

    // --- Action ---
    cp.triggerOnWithdrawalCancelled(address(rm), underwriter, principalComponent);

    // --- Assertions ---
    assertEq(pr.updateCapitalPendingWithdrawalCallCount(), 2);
    (uint256 lastPoolId, uint256 lastAmount, bool lastIsRequest) = pr.get_last_updateCapitalPendingWithdrawal();
    assertEq(lastPoolId, 1, "Should update the last pool in the loop");

    // FIX: The amount passed to the mock should be the principalComponent that was cancelled.
    assertEq(lastAmount, principalComponent);
    
    assertFalse(lastIsRequest, "Should be a cancellation (false)");
    assertEq(rd.updateUserStateCallCount(), 2);
}

function test_onCapitalWithdrawn_hook_fullWithdrawal() public {
    // --- Setup ---
    uint256 pledge = 10_000 * 1e6;
    uint256[] memory pools = new uint256[](1);
    pools[0] = 0;

    // 1. Allocate underwriter
    cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
    cp.setUnderwriterAdapterAddress(underwriter, address(1));
    pr.setPoolCount(1);
    pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);
    vm.prank(underwriter);
    rm.allocateCapital(pools);

    // 2. Set a pending loss to test loss realization
    uint256 pendingLoss = 1_000 * 1e6;
    ld.setRealizeLosses(underwriter, 0, pledge, pendingLoss);

    // --- Action ---
    // 3. Simulate a full withdrawal from the CapitalPool
    cp.triggerOnCapitalWithdrawn(address(rm), underwriter, pledge, true);

    // --- Assertions ---
    // Check that losses were realized
    assertEq(cp.applyLossesCallCount(), 1);
    assertEq(cp.last_applyLosses_principalLossAmount(), pendingLoss);

    // Check that the underwriter's total pledge is now 0 (or close to it after loss)
    assertEq(rm.underwriterTotalPledge(underwriter), 0);

    // Check that the underwriter is no longer allocated to the pool
    assertFalse(rm.isAllocatedToPool(underwriter, 0));

    // Check that the underwriter's allocation array is now empty
    uint256[] memory allocations = rm.getUnderwriterAllocations(underwriter);
    assertEq(allocations.length, 0);
}

function test_hooks_revert_ifNotCapitalPool() public {
    // --- onWithdrawalRequested ---
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.NotCapitalPool.selector);
    rm.onWithdrawalRequested(underwriter, 100);

    // --- onWithdrawalCancelled ---
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.NotCapitalPool.selector);
    rm.onWithdrawalCancelled(underwriter, 100);

    // --- onCapitalWithdrawn ---
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.NotCapitalPool.selector);
    rm.onCapitalWithdrawn(underwriter, 100, false);
}

function test_fullLifecycle_deposit_allocate_claim_deallocate_withLoss() public {
    // ───────────────────────── 1. SETUP ──────────────────────────
    // --- Define Actors & Parameters ---
    address claimant = address(0xC1A1);
    uint256 poolId = 0;
    uint256 initialPledge = 100_000 * 1e6; // $100,000
    uint256 coverageAmount = 20_000 * 1e6; // A $20,000 claim will be made
    uint256 deallocateRequestAmount = 30_000 * 1e6; // Request to pull $30,000
    uint256 noticePeriod = 7 days;
    rm.setDeallocationNoticePeriod(noticePeriod);

    // ────────────────── 2. DEPOSIT & ALLOCATE ───────────────────
    // --- The underwriter deposits capital and allocates to a pool ---
    cp.triggerOnCapitalDeposited(address(rm), underwriter, initialPledge);
    address adapter = address(0xA1);
    cp.setUnderwriterAdapterAddress(underwriter, adapter);
    pr.setPoolCount(1);
    uint256[] memory pools = new uint256[](1);
    pools[0] = poolId;
    vm.prank(underwriter);
    rm.allocateCapital(pools);
    assertEq(rm.underwriterPoolPledge(underwriter, poolId), initialPledge, "Initial pledge mismatch");

    // ─────────────────── 3. PROCESS A CLAIM ─────────────────────
    // --- A policy is claimed against the pool, creating a loss for the underwriter ---
    // Setup mocks for the claim processing
    address[] memory adapters = new address[](1);
    adapters[0] = adapter;
    uint256[] memory capitalPerAdapter = new uint256[](1);
    capitalPerAdapter[0] = initialPledge;
    pr.setPoolPayoutData(poolId, adapters, capitalPerAdapter, initialPledge);
    cp.setUnderlyingAsset(address(token));
    pr.setPoolData(poolId, token, initialPledge, 0, 0, false, committee, 500);
    uint256 policyId = 1;
    vm.warp(block.timestamp + 1 days);
    nft.setPolicy(policyId, poolId, coverageAmount, block.timestamp - 1 days);
    nft.setOwnerOf(policyId, claimant);
    token.mint(claimant, coverageAmount);
    vm.prank(claimant);
    token.approve(address(rm), coverageAmount);

    // Process the claim
    vm.prank(claimant);
    rm.processClaim(policyId);
    // After the claim, a loss of `coverageAmount` is now pending for the underwriter.
    // The `lossDistributor` mock needs to reflect this.
    ld.setRealizeLosses(underwriter, poolId, initialPledge, coverageAmount);


    // ────────────────── 4. DEALLOCATE WITH LOSS ──────────────────
    // --- The underwriter requests to deallocate and then completes the withdrawal, realizing their loss ---
    // --- a) Request Deallocation ---
    // The pool needs sufficient free capital for the request to succeed.
    pr.setPoolData(poolId, token, initialPledge - coverageAmount, 0, 0, false, committee, 500);
    vm.prank(underwriter);
    rm.requestDeallocateFromPool(poolId, deallocateRequestAmount);
    assertEq(rm.deallocationRequestAmount(underwriter, poolId), deallocateRequestAmount, "Deallocation request amount mismatch");

    // --- b) Complete Deallocation after notice period ---
    vm.warp(block.timestamp + noticePeriod + 1); // Advance time
    vm.prank(underwriter);
    rm.deallocateFromPool(poolId);

    // ───────────────────── 5. FINAL ASSERTIONS ───────────────────
    // --- Verify the final state of the underwriter and the system ---

    // 1. Check that the loss was applied to the CapitalPool
    assertEq(cp.applyLossesCallCount(), 1, "applyLosses should have been called");
    assertEq(cp.last_applyLosses_underwriter(), underwriter, "Wrong underwriter for loss application");
    assertEq(cp.last_applyLosses_principalLossAmount(), coverageAmount, "Incorrect loss amount applied");

    // 2. Check the underwriter's final pledge in the pool
    uint256 expectedFinalPledge = initialPledge - coverageAmount - deallocateRequestAmount;
    assertEq(rm.underwriterPoolPledge(underwriter, poolId), expectedFinalPledge, "Final pool pledge is incorrect");

    // 3. Check the underwriter's total pledge
    // The total pledge is reduced by both the realized loss and the deallocated amount.
    // Note: `deallocateFromPool` calls `_realizeLossesForAllPools` first, which reduces the total pledge.
    // The deallocation itself doesn't double-dip; it just updates the pool-specific pledge.
    assertEq(rm.underwriterTotalPledge(underwriter), initialPledge - coverageAmount, "Final total pledge is incorrect");

    // 4. Check that the deallocation request is cleared
    assertEq(rm.deallocationRequestTimestamp(underwriter, poolId), 0, "Deallocation request should be cleared");
}

function test_processClaim_withShortfall() public {
    // --- Setup ---
    uint256 poolId = 0;
    uint256 policyId = 1;
    address claimant = address(0xAD4E);
    uint256 totalPledgeInPool = 50_000 * 1e6; // Pool only has $50k
    uint256 coverageAmount = 80_000 * 1e6;    // But the claim is for $80k
    uint256 expectedShortfall = coverageAmount - totalPledgeInPool; // Expect $30k shortfall

    // 1. Setup Underwriter and Pool Capitalization
    cp.triggerOnCapitalDeposited(address(rm), underwriter, totalPledgeInPool);
    address adapter = address(0xA1);
    cp.setUnderwriterAdapterAddress(underwriter, adapter);
    pr.setPoolCount(1);
    uint256[] memory pools = new uint256[](1);
    pools[0] = poolId;
    vm.prank(underwriter);
    rm.allocateCapital(pools);

    // 2. Setup Pool Payout Data to reflect the limited capital
    address[] memory adapters = new address[](1);
    adapters[0] = adapter;
    uint256[] memory capitalPerAdapter = new uint256[](1);
    capitalPerAdapter[0] = totalPledgeInPool;
    pr.setPoolPayoutData(poolId, adapters, capitalPerAdapter, totalPledgeInPool);

    // 3. Setup other mocks
    cp.setUnderlyingAsset(address(token));
    pr.setPoolData(poolId, token, totalPledgeInPool, 0, 0, false, committee, 500);
    vm.warp(block.timestamp + 1 days);
    nft.setPolicy(policyId, poolId, coverageAmount, block.timestamp - 1 days);
    nft.setOwnerOf(policyId, claimant);
    token.mint(claimant, coverageAmount);
    vm.prank(claimant);
    token.approve(address(rm), coverageAmount);

    // --- Action ---
    vm.prank(claimant);
    rm.processClaim(policyId);

    // --- Assertions ---
    // The most important check: Was the backstop pool called to cover the shortfall?
    assertEq(cat.drawFundCallCount(), 1, "catPool.drawFund should be called once");
    assertEq(cat.last_drawFund_amount(), expectedShortfall, "Incorrect shortfall amount drawn");

    // Also check that the loss distributed to the pool LPs is capped at the total pledge
    assertEq(ld.last_distributeLoss_lossAmount(), coverageAmount, "Loss distributor should get full loss amount");
    // The capital pool payout, however, is capped by the pool's pledge
    assertEq(cp.last_executePayout_payoutData().totalCapitalFromPoolLPs, totalPledgeInPool, "Payout data should reflect the pool's total pledge");
}

function test_liquidateInsolventUnderwriter_withMultiplePools() public {
    // --- Setup ---
    uint256 initialPledge = 30_000 * 1e6;
    address keeper = address(0xDEAD);

    // 1. Allocate underwriter to three different pools
    cp.triggerOnCapitalDeposited(address(rm), underwriter, initialPledge);
    cp.setUnderwriterAdapterAddress(underwriter, address(1));
    pr.setPoolCount(3);
    uint256[] memory pools = new uint256[](3);
    pools[0] = 0;
    pools[1] = 1;
    pools[2] = 2;
    vm.prank(underwriter);
    rm.allocateCapital(pools);

    // 2. Assign a pending loss to each pool allocation in the LossDistributor
    uint256 loss1 = 5_000 * 1e6;
    uint256 loss2 = 8_000 * 1e6;
    uint256 loss3 = 2_000 * 1e6;
    ld.setPendingLosses(underwriter, 0, initialPledge, loss1);
    ld.setPendingLosses(underwriter, 1, initialPledge, loss2);
    ld.setPendingLosses(underwriter, 2, initialPledge, loss3);
    uint256 totalPendingLosses = loss1 + loss2 + loss3; // 15,000

    // 3. Make underwriter INSOLVENT: their total share value is less than the sum of all pending losses
    uint256 shareValue = 14_000 * 1e6;
    cp.setUnderwriterAccount(underwriter, 0, shareValue, 0, 0);

    // --- Action ---
    vm.prank(keeper);
    rm.liquidateInsolventUnderwriter(underwriter);

    // --- Assertions ---
    // Check that `_realizeLossesForAllPools` aggregated the losses correctly before calling the CapitalPool
    assertEq(cp.applyLossesCallCount(), 3, "applyLosses should be called for each pool's loss realization");
    // The final total pledge should be reduced by the sum of all realized losses
    assertEq(rm.underwriterTotalPledge(underwriter), initialPledge - totalPendingLosses, "Total pledge not reduced correctly");
}

function test_onCapitalWithdrawn_hook_partialWithdrawal() public {
    // --- Setup ---
    uint256 initialPledge = 50_000 * 1e6;
    uint256 partialWithdrawalAmount = 10_000 * 1e6;
    uint256 poolId = 0;

    // 1. Allocate underwriter
    cp.triggerOnCapitalDeposited(address(rm), underwriter, initialPledge);
    cp.setUnderwriterAdapterAddress(underwriter, address(1));
    pr.setPoolCount(1);
    pr.setPoolData(poolId, token, initialPledge, 0, 0, false, address(0), 0);
    uint256[] memory pools = new uint256[](1);
    pools[0] = poolId;
    vm.prank(underwriter);
    rm.allocateCapital(pools);

    // --- Action ---
    // 2. Simulate a PARTIAL withdrawal from the CapitalPool
    cp.triggerOnCapitalWithdrawn(address(rm), underwriter, partialWithdrawalAmount, false);

    // --- Assertions ---
    // 1. Check that pledges are correctly reduced
    uint256 expectedFinalPledge = initialPledge - partialWithdrawalAmount;
    assertEq(rm.underwriterTotalPledge(underwriter), expectedFinalPledge, "Total pledge not reduced correctly");
    assertEq(rm.underwriterPoolPledge(underwriter, poolId), expectedFinalPledge, "Pool pledge not reduced correctly");

    // 2. Check that the underwriter is STILL allocated to the pool
    assertTrue(rm.isAllocatedToPool(underwriter, poolId), "Underwriter should still be allocated");

    // 3. Check that the underwriter's allocation array still contains the pool
    uint256[] memory allocations = rm.getUnderwriterAllocations(underwriter);
    assertEq(allocations.length, 1, "Allocation array should still have one entry");
    assertEq(allocations[0], poolId, "Incorrect poolId in allocation array");
}


function test_claimPremiumRewards_forSubsetOfPools() public {
    // --- Setup ---
    uint256 pledge = 10_000 * 1e6;
    // 1. Allocate underwriter to pools 0 and 1
    cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
    cp.setUnderwriterAdapterAddress(underwriter, address(1));
    pr.setPoolCount(3); // Pools 0, 1, 2 exist
    pr.setPoolData(0, token, 0, 0, 0, false, address(0), 0); // Pool 0 data
    pr.setPoolData(1, token, 0, 0, 0, false, address(0), 0); // Pool 1 data
    uint256[] memory allocatedPools = new uint256[](2);
    allocatedPools[0] = 0;
    allocatedPools[1] = 1;
    vm.prank(underwriter);
    rm.allocateCapital(allocatedPools);

    // --- Action ---
    // 2. Attempt to claim for pools 0 (valid) and 2 (invalid for this user)
    uint256[] memory claimPools = new uint256[](2);
    claimPools[0] = 0; // User is in this pool
    claimPools[1] = 2; // User is NOT in this pool

    vm.prank(underwriter);
    rm.claimPremiumRewards(claimPools);

    // --- Assertions ---
    // The `if` check should skip the call for pool 2.
    assertEq(rd.claimCallCount(), 1, "RewardDistributor.claim should only be called once");

    // Verify the single call was for the correct pool (pool 0)
    assertEq(rd.lastClaimUser(), underwriter);
    assertEq(rd.lastClaimPoolId(), 0);
    assertEq(rd.lastClaimPledge(), pledge);
}

function test_claimDistressedAssets_withDuplicateTokens() public {
    // --- Setup ---
    // 1. Create a second token address, but set both pools to use the FIRST token
    MockERC20 anotherToken = new MockERC20("FAKE", "FAKE", 18);
    pr.setPoolCount(2);
    pr.setPoolData(0, token, 0, 0, 0, false, address(0), 0); // Pool 0 uses `token`
    pr.setPoolData(1, token, 0, 0, 0, false, address(0), 0); // Pool 1 ALSO uses `token`

    // --- Action ---
    // 2. Call claimDistressedAssets for both pools
    uint256[] memory poolsWithDupes = new uint256[](2);
    poolsWithDupes[0] = 0;
    poolsWithDupes[1] = 1;
    vm.prank(underwriter);
    rm.claimDistressedAssets(poolsWithDupes);

    // --- Assertions ---
    // The deduplication logic in `_prepareDistressedAssets` should ensure the backstop pool is only called once for the unique token.
    assertEq(cat.claimProtocolRewardsCallCount(), 1, "BackstopPool should only be called once for the unique token");
    assertEq(cat.last_claimProtocolToken(), address(token), "Claim was made for the wrong token");
}

}
