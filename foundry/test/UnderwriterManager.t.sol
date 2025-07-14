// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// --- Contract and Mocks ---
import {UnderwriterManager, DeallocationRequested} from "contracts/UnderwriterManager.sol";
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

    // --- Actors ---
    address owner = address(this);
    address riskManager = address(0xDEAD);
    address underwriter = address(0xFACE);
    address otherUser = address(0xBAD);

    // --- Events ---
    event CapitalAllocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event CapitalDeallocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);

    function setUp() public {
        // --- Deploy Mocks ---
        token = new MockERC20("USD Coin", "USDC", 6);
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

    /// @notice Helper to set up a basic state with one underwriter allocated to pools.
    function _setupAllocatedUnderwriter(uint256 pledge, uint256[] memory pools) internal {
        cp.triggerOnCapitalDeposited(address(um), underwriter, pledge);
        cp.setUnderwriterAdapterAddress(underwriter, address(0xA1));
        pr.setPoolCount(pools.length);
        vm.prank(underwriter);
        um.allocateCapital(pools);
    }

    function test_fullLifecycle_allocateAndDeallocate() public {
        // --- Arrange ---
        uint256 pledge = 10_000e6;
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);
        assertTrue(um.isAllocatedToPool(underwriter, 0));
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);
        um.setDeallocationNoticePeriod(0);

        // --- Act ---
        vm.prank(underwriter);
        um.requestDeallocateFromPool(0, pledge);
        vm.prank(underwriter);
        um.deallocateFromPool(0);

        // --- Assert ---
        assertFalse(um.isAllocatedToPool(underwriter, 0));
        assertEq(um.getUnderwriterAllocations(underwriter).length, 0);
    }

    function test_deallocate_realizesLosses() public {
        // --- Arrange ---
        uint256 pledge = 10_000e6;
        uint256 lossAmount = 2_000e6;
        uint256 deallocateAmount = 3_000e6;
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);
        um.setDeallocationNoticePeriod(0);

        // Set up the mock Loss Distributor to return a loss when called
        ld.setRealizeLosses(underwriter, 0, pledge, lossAmount);

        // --- Act ---
        vm.prank(underwriter);
        um.requestDeallocateFromPool(0, deallocateAmount);
        vm.prank(underwriter);
        um.deallocateFromPool(0);

        // --- Assert ---
        // 1. Loss was realized and sent to CapitalPool
        assertEq(cp.applyLossesCallCount(), 1);
        assertEq(cp.last_applyLosses_principalLossAmount(), lossAmount);

        // 2. Underwriter's total pledge was reduced by the loss
        assertEq(um.underwriterTotalPledge(underwriter), pledge - lossAmount);

        // 3. The pool-specific pledge was reduced by both loss and deallocation
        uint256 expectedPoolPledge = pledge - lossAmount - deallocateAmount;
        assertEq(um.underwriterPoolPledge(underwriter, 0), expectedPoolPledge);
    }

    function test_claimRewards() public {
        // --- Arrange ---
        uint256 pledge = 10_000e6;
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);

        // --- Act ---
        vm.prank(underwriter);
        um.claimPremiumRewards(pools);

        // --- Assert ---
        assertEq(rd.claimCallCount(), 1);
        assertEq(rd.lastClaimUser(), underwriter);
        assertEq(rd.lastClaimPoolId(), 0);
        assertEq(rd.lastClaimToken(), address(token));
        assertEq(rd.lastClaimPledge(), pledge);
    }

    function test_hook_onCapitalDeposited() public {
        // --- Arrange ---
        uint256 initialPledge = 10_000e6;
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(initialPledge, pools);

        // --- Act ---
        uint256 depositAmount = 5_000e6;
        // This call must be pranked as the CapitalPool
        vm.prank(address(cp));
        um.onCapitalDeposited(underwriter, depositAmount);

        // --- Assert ---
        uint256 expectedTotal = initialPledge + depositAmount;
        assertEq(um.underwriterTotalPledge(underwriter), expectedTotal);
        assertEq(um.underwriterPoolPledge(underwriter, 0), expectedTotal);
        assertEq(rd.updateUserStateCallCount(), 1); // Called once during the hook
    }

    function test_hook_onCapitalWithdrawn_fullWithdrawal() public {
        // --- Arrange ---
        uint256 pledge = 10_000e6;
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);

        // --- Act ---
        // Simulate a full withdrawal via the hook
        vm.prank(address(cp));
        um.onCapitalWithdrawn(underwriter, pledge, true);

        // --- Assert ---
        assertEq(um.underwriterTotalPledge(underwriter), 0);
        assertFalse(um.isAllocatedToPool(underwriter, 0));
        assertEq(um.getUnderwriterAllocations(underwriter).length, 0);
    }

    function test_hook_onCapitalWithdrawn_partialWithdrawal() public {
        // --- Arrange ---
        uint256 pledge = 10_000e6;
        uint256 partialWithdrawal = 4_000e6;
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);

        // --- Act ---
        // Simulate a partial withdrawal via the hook
        vm.prank(address(cp));
        um.onCapitalWithdrawn(underwriter, partialWithdrawal, false);

        // --- Assert ---
        uint256 expectedPledge = pledge - partialWithdrawal;
        assertEq(um.underwriterTotalPledge(underwriter), expectedPledge);
        assertEq(um.underwriterPoolPledge(underwriter, 0), expectedPledge);
        assertTrue(um.isAllocatedToPool(underwriter, 0)); // Still allocated
        assertEq(um.getUnderwriterAllocations(underwriter).length, 1);
    }

    function testRevert_permissions() public {
        // --- Owner Functions ---
        vm.prank(otherUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otherUser));
        um.setAddresses(address(cp), address(pr), address(cat), address(ld), address(rd), riskManager);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otherUser));
        um.setMaxAllocationsPerUnderwriter(10);

        // --- RiskManager-Only Function ---
        vm.prank(otherUser);
        vm.expectRevert(UnderwriterManager.NotRiskManager.selector);
        um.realizeLossesForAllPools(underwriter);
    }

    function testRevert_hooks_ifNotCapitalPool() public {
        vm.prank(otherUser);
        vm.expectRevert(UnderwriterManager.NotCapitalPool.selector);
        um.onCapitalDeposited(underwriter, 100);

        vm.expectRevert(UnderwriterManager.NotCapitalPool.selector);
        um.onWithdrawalRequested(underwriter, 100);

        vm.expectRevert(UnderwriterManager.NotCapitalPool.selector);
        um.onWithdrawalCancelled(underwriter, 100);

        vm.expectRevert(UnderwriterManager.NotCapitalPool.selector);
        um.onCapitalWithdrawn(underwriter, 100, false);
    }

    function testRevert_allocate_invalidState() public {
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;

        // Reverts if user has no pledge
        vm.prank(underwriter);
        vm.expectRevert(UnderwriterManager.NoCapitalToAllocate.selector);
        um.allocateCapital(pools);

        // Give pledge but no adapter
        cp.triggerOnCapitalDeposited(address(um), underwriter, 1000);
        vm.prank(underwriter);
        vm.expectRevert("User has no yield adapter");
        um.allocateCapital(pools);
        cp.setUnderwriterAdapterAddress(underwriter, address(0xA1)); // Set adapter

        // Reverts if pool ID is invalid
        pr.setPoolCount(0); // No pools exist
        vm.prank(underwriter);
        vm.expectRevert(UnderwriterManager.InvalidPoolId.selector);
        um.allocateCapital(pools);
        pr.setPoolCount(1); // One pool exists now

        // Reverts if already allocated
        vm.prank(underwriter);
        um.allocateCapital(pools); // First allocation succeeds
        vm.prank(underwriter);
        vm.expectRevert(UnderwriterManager.AlreadyAllocated.selector);
        um.allocateCapital(pools); // Second fails
    }

    function testRevert_deallocate_invalidState() public {
        // Reverts if no request was made
        vm.prank(underwriter);
        vm.expectRevert(UnderwriterManager.NoDeallocationRequest.selector);
        um.deallocateFromPool(0);

        // Setup a valid request
        uint256 pledge = 10_000e6;
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        _setupAllocatedUnderwriter(pledge, pools);
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);
        vm.prank(underwriter);
        um.requestDeallocateFromPool(0, pledge);

        // Reverts if notice period is active
        um.setDeallocationNoticePeriod(1 days);
        vm.prank(underwriter);
        vm.expectRevert(UnderwriterManager.NoticePeriodActive.selector);
        um.deallocateFromPool(0);
        vm.warp(block.timestamp + 2 days); // Pass notice period

        // Reverts if user tries to request again while one is pending
        vm.prank(underwriter);
        vm.expectRevert(UnderwriterManager.DeallocationRequestPending.selector);
        um.requestDeallocateFromPool(0, 100);
    }
}