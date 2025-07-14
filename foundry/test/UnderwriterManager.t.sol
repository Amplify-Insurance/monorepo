// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// --- Contract and Mocks ---
import {UnderwriterManager} from "contracts/core/UnderwriterManager.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {MockCapitalPool} from "contracts/test/MockCapitalPool.sol";
import {MockPoolRegistry} from "contracts/test/MockPoolRegistry.sol";
import {MockBackstopPool} from "contracts/test/MockBackstopPool.sol";
import {MockLossDistributor} from "contracts/test/MockLossDistributor.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";

contract UnderwriterManagerTest is Test {
    // --- Contracts ---
    UnderwriterManager um;
    MockCapitalPool cp;
    MockPoolRegistry pr;
    MockBackstopPool cat;
    MockLossDistributor ld;
    MockRewardDistributor rd;
    MockERC20 token;
    MockERC20 token2; // NEW: For multi-asset tests

    // --- Actors ---
    address owner = address(this);
    address riskManager = address(0xDEAD);
    address underwriter = address(0xFACE);
    address underwriter2 = address(0xFACE2); // NEW: For multi-user tests
    address otherUser = address(0xBAD);

    // --- Events (already declared) ---

    function setUp() public {
        // --- Deploy Mocks ---
        token = new MockERC20("USD Coin", "USDC", 6);
        token2 = new MockERC20("Protocol Token 2", "PT2", 18);
        cp = new MockCapitalPool(owner, address(token));
        pr = new MockPoolRegistry();
        cat = new MockBackstopPool(owner);
        ld = new MockLossDistributor();
        rd = new MockRewardDistributor();

        // --- Deploy Contract Under Test ---
        um = new UnderwriterManager(owner);

        // --- Link Contracts ---
        um.setAddresses(address(cp), address(pr), address(cat), address(ld), address(rd), riskManager);
    }

    /// @notice Helper to set up an underwriter with a capital pledge.
    function _setupPledgedUnderwriter(address _underwriter, uint256 _pledge) internal {
        cp.triggerOnCapitalDeposited(address(um), _underwriter, _pledge);
        cp.setUnderwriterAdapterAddress(_underwriter, address(0xA1));
    }

    /// @notice Helper to set up a basic state with one underwriter allocated to pools.
    function _setupAllocatedUnderwriter(uint256 pledge, uint256[] memory pools) internal {
        _setupPledgedUnderwriter(underwriter, pledge);
        pr.setPoolCount(pools.length);
        vm.prank(underwriter);
        um.allocateCapital(pools);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* HAPPY PATH TESTS                                 */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function test_fullLifecycle_allocateAndDeallocate() public {
        uint256 pledge = 10_000e6;
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);
        assertTrue(um.isAllocatedToPool(underwriter, 0));
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);
        um.setDeallocationNoticePeriod(0);

        vm.prank(underwriter);
        um.requestDeallocateFromPool(0, pledge);
        vm.prank(underwriter);
        um.deallocateFromPool(0);

        assertFalse(um.isAllocatedToPool(underwriter, 0));
        assertEq(um.getUnderwriterAllocations(underwriter).length, 0);
    }

    function test_deallocate_realizesLosses() public {
        uint256 pledge = 10_000e6;
        uint256 lossAmount = 2_000e6;
        uint256 deallocateAmount = 3_000e6;
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);
        um.setDeallocationNoticePeriod(0);
        ld.setRealizeLosses(underwriter, 0, pledge, lossAmount);

        vm.prank(underwriter);
        um.requestDeallocateFromPool(0, deallocateAmount);
        vm.prank(underwriter);
        um.deallocateFromPool(0);

        assertEq(cp.applyLossesCallCount(), 1);
        assertEq(cp.last_applyLosses_principalLossAmount(), lossAmount);
        assertEq(um.underwriterTotalPledge(underwriter), pledge - lossAmount);
        uint256 expectedPoolPledge = pledge - lossAmount - deallocateAmount;
        assertEq(um.underwriterPoolPledge(underwriter, 0), expectedPoolPledge);
    }

    function test_deallocate_withNoLosses() public {
        uint256 pledge = 10_000e6;
        uint256 deallocateAmount = 3_000e6;
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);
        um.setDeallocationNoticePeriod(0);
        ld.setRealizeLosses(underwriter, 0, pledge, 0); // NEW: Explicitly test no loss

        vm.prank(underwriter);
        um.requestDeallocateFromPool(0, deallocateAmount);
        vm.prank(underwriter);
        um.deallocateFromPool(0);

        assertEq(cp.applyLossesCallCount(), 0); // No loss applied
        assertEq(um.underwriterTotalPledge(underwriter), pledge); // Total pledge unaffected by deallocation itself
        assertEq(um.underwriterPoolPledge(underwriter, 0), pledge - deallocateAmount);
    }

    function test_claimPremiumRewards() public {
        uint256 pledge = 10_000e6;
          uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);

        vm.prank(underwriter);
        um.claimPremiumRewards(pools);

        assertEq(rd.claimCallCount(), 1);
        assertEq(rd.lastClaimUser(), underwriter);
        assertEq(rd.lastClaimPoolId(), 0);
        assertEq(rd.lastClaimToken(), address(token));
        assertEq(rd.lastClaimPledge(), pledge);
    }

    function test_claimDistressedAssets() public {
        uint256 pledge = 10_000e6;
        uint256[] memory pools = new uint256[](3);
        pools[0] = 0;
        pools[1] = 1;
        pools[2] = 2;
        _setupAllocatedUnderwriter(pledge, pools);
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);
        pr.setPoolData(1, token2, pledge, 0, 0, false, address(0), 0);
        pr.setPoolData(2, token, pledge, 0, 0, false, address(0), 0); // Duplicate token

        vm.prank(underwriter);
        um.claimDistressedAssets(pools);

        // Should be called twice, once for each unique token
        assertEq(cat.claimProtocolAssetRewardsForCallCount(), 2);
    }

    function test_multiUser_interactions() public {
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;        
        pr.setPoolCount(1);
        pr.setPoolData(0, token, 0, 0, 0, false, address(0), 0);

        // Setup two different underwriters
        _setupPledgedUnderwriter(underwriter, 10_000e6);
        _setupPledgedUnderwriter(underwriter2, 5_000e6);

        // Allocate both to the same pool
        vm.prank(underwriter);
        um.allocateCapital(pools);
        vm.prank(underwriter2);
        um.allocateCapital(pools);

        assertEq(um.underwriterPoolPledge(underwriter, 0), 10_000e6);
        assertEq(um.underwriterPoolPledge(underwriter2, 0), 5_000e6);
        assertEq(pr.last_updateCapitalAllocation_amount(), 5_000e6);
        // Underwriter 1 deallocates
        um.setDeallocationNoticePeriod(0);
        vm.prank(underwriter);
        um.requestDeallocateFromPool(0, 10_000e6);
        vm.prank(underwriter);
        um.deallocateFromPool(0);

        // Assert underwriter 1 is deallocated but underwriter 2 is not
        assertFalse(um.isAllocatedToPool(underwriter, 0));
        assertTrue(um.isAllocatedToPool(underwriter2, 0));
        assertEq(um.underwriterPoolPledge(underwriter2, 0), 5_000e6);
    }


    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* HOOKS TESTS                                   */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function test_hook_onCapitalDeposited() public {
        uint256 initialPledge = 10_000e6;
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(initialPledge, pools);
        pr.setPoolData(0, token, initialPledge, 0, 0, false, address(0), 0);

        uint256 depositAmount = 5_000e6;
        vm.prank(address(cp));
        um.onCapitalDeposited(underwriter, depositAmount);

        uint256 expectedTotal = initialPledge + depositAmount;
        assertEq(um.underwriterTotalPledge(underwriter), expectedTotal);
        assertEq(um.underwriterPoolPledge(underwriter, 0), expectedTotal);
        assertEq(rd.updateUserStateCallCount(), 1);
    }

    function test_hook_onCapitalWithdrawn_fullWithdrawal() public {
        uint256 pledge = 10_000e6;
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);

        vm.prank(address(cp));
        um.onCapitalWithdrawn(underwriter, pledge, true);

        assertEq(um.underwriterTotalPledge(underwriter), 0);
        assertFalse(um.isAllocatedToPool(underwriter, 0));
        assertEq(um.getUnderwriterAllocations(underwriter).length, 0);
    }

    function test_hook_onCapitalWithdrawn_partialWithdrawal() public {
        uint256 pledge = 10_000e6;
        uint256 partialWithdrawal = 4_000e6;
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);

        vm.prank(address(cp));
        um.onCapitalWithdrawn(underwriter, partialWithdrawal, false);

        uint256 expectedPledge = pledge - partialWithdrawal;
        assertEq(um.underwriterTotalPledge(underwriter), expectedPledge);
        assertEq(um.underwriterPoolPledge(underwriter, 0), expectedPledge);
        assertTrue(um.isAllocatedToPool(underwriter, 0));
        assertEq(um.getUnderwriterAllocations(underwriter).length, 1);
    }

    function test_hook_onWithdrawalRequestedAndCancelled() public {
        uint256 pledge = 10_000e6;
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);

        // Request
        vm.prank(address(cp));
        um.onWithdrawalRequested(underwriter, pledge);
        (
            uint256 lastPoolId,
            uint256 lastAmount,
            bool lastIsIncrease
        ) = pr.get_last_updateCapitalPendingWithdrawal();
        assertEq(lastAmount, pledge);
        assertTrue(lastIsIncrease);

        // Cancel
        vm.prank(address(cp));
        um.onWithdrawalCancelled(underwriter, pledge);
        (
            lastPoolId,
            lastAmount,
            lastIsIncrease
        ) = pr.get_last_updateCapitalPendingWithdrawal();
        assertEq(lastAmount, pledge);
        assertFalse(lastIsIncrease);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* REVERT TESTS                                  */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function testRevert_permissions() public {
        vm.prank(otherUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otherUser));
        um.setAddresses(address(cp), address(pr), address(cat), address(ld), address(rd), riskManager);

        vm.prank(otherUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otherUser));
        um.setMaxAllocationsPerUnderwriter(10);

        vm.prank(otherUser);
        vm.expectRevert(UnderwriterManager.NotRiskManager.selector);
        um.realizeLossesForAllPools(underwriter);
    }

    function testRevert_hooks_ifNotCapitalPool() public {
        vm.prank(otherUser);
        vm.expectRevert(UnderwriterManager.NotCapitalPool.selector);
        um.onCapitalDeposited(underwriter, 100);

        vm.prank(otherUser);
        vm.expectRevert(UnderwriterManager.NotCapitalPool.selector);
        um.onWithdrawalRequested(underwriter, 100);

        vm.prank(otherUser);
        vm.expectRevert(UnderwriterManager.NotCapitalPool.selector);
        um.onWithdrawalCancelled(underwriter, 100);

        vm.prank(otherUser);
        vm.expectRevert(UnderwriterManager.NotCapitalPool.selector);
        um.onCapitalWithdrawn(underwriter, 100, false);
    }

    function testRevert_allocate_invalidState() public {
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupPledgedUnderwriter(underwriter, 1000);

        // Exceeds max allocations
        um.setMaxAllocationsPerUnderwriter(1);
        uint256[] memory tooManyPools = new uint256[](2);
        tooManyPools[0] = 0;
        tooManyPools[1] = 1;
        pr.setPoolCount(2);
        vm.prank(underwriter);
        vm.expectRevert(UnderwriterManager.ExceedsMaxAllocations.selector);
        um.allocateCapital(tooManyPools);
        pr.setPoolCount(1);
        um.setMaxAllocationsPerUnderwriter(5);

        // No capital
        vm.prank(otherUser);
        vm.expectRevert(UnderwriterManager.NoCapitalToAllocate.selector);
        um.allocateCapital(pools);

        // No adapter
        cp.setUnderwriterAdapterAddress(underwriter, address(0));
        vm.prank(underwriter);
        vm.expectRevert("User has no yield adapter");
        um.allocateCapital(pools);
        cp.setUnderwriterAdapterAddress(underwriter, address(0xA1));

        // Invalid Pool ID
        pr.setPoolCount(0);
        vm.prank(underwriter);
        vm.expectRevert(UnderwriterManager.InvalidPoolId.selector);
        um.allocateCapital(pools);
        pr.setPoolCount(1);

        // Already allocated
        vm.prank(underwriter);
        um.allocateCapital(pools);
        vm.prank(underwriter);
        vm.expectRevert(UnderwriterManager.AlreadyAllocated.selector);
        um.allocateCapital(pools);
    }

    function testRevert_deallocate_invalidState() public {
        vm.prank(underwriter);
        vm.expectRevert(UnderwriterManager.NoDeallocationRequest.selector);
        um.deallocateFromPool(0);

        uint256 pledge = 10_000e6;
           uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);

        vm.prank(underwriter);
        um.requestDeallocateFromPool(0, pledge);

        um.setDeallocationNoticePeriod(1 days);
        vm.prank(underwriter);
        vm.expectRevert(UnderwriterManager.NoticePeriodActive.selector);
        um.deallocateFromPool(0);

        vm.prank(underwriter);
        vm.expectRevert(UnderwriterManager.DeallocationRequestPending.selector);
        um.requestDeallocateFromPool(0, 100);
    }

    function testRevert_requestDeallocate_insufficientFreeCapital() public {
        uint256 pledge = 10_000e6;
        uint256 coverageSold = 8_000e6; // Leaves 2k free capital
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);
        pr.setPoolData(0, token, pledge, coverageSold, 0, false, address(0), 0);

        // Attempt to deallocate more than is free
        uint256 deallocateAmount = 3_000e6;
        vm.prank(underwriter);
        vm.expectRevert(UnderwriterManager.InsufficientFreeCapital.selector);
        um.requestDeallocateFromPool(0, deallocateAmount);
    }
}
