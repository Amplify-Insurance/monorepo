// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// --- Contract Under Test ---
import {RiskManager} from "contracts/core/RiskManager.sol";

// --- Interfaces (as defined in the contract file) ---
import {ICapitalPool} from "contracts/interfaces/ICapitalPool.sol";
import {IPolicyNFT} from "contracts/interfaces/IPolicyNFT.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {IBackstopPool} from "contracts/interfaces/IBackstopPool.sol";
import {ILossDistributor} from "contracts/interfaces/ILossDistributor.sol";
import {IRewardDistributor} from "contracts/interfaces/IRewardDistributor.sol";
import {IUnderwriterManager} from "contracts/interfaces/IUnderwriterManager.sol";
import {IPolicyManager} from "contracts/interfaces/IPolicyManager.sol";

// --- Mocks ---
import {MockERC20} from "contracts/test/MockERC20.sol";
import {MockCapitalPool} from "contracts/test/MockCapitalPool.sol";
import {MockPoolRegistry} from "contracts/test/MockPoolRegistry.sol";
import {MockPolicyNFT} from "contracts/test/MockPolicyNFT.sol";
import {MockPolicyManager} from "contracts/test/MockPolicyManager.sol";
import {MockBackstopPool} from "contracts/test/MockBackstopPool.sol";
import {MockLossDistributor} from "contracts/test/MockLossDistributor.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";
import {MockUnderwriterManager} from "contracts/test/MockUnderwriterManager.sol";

/// @title RiskManager Unit Tests
/// @notice This suite uses mock contracts to test the logic of RiskManager in isolation.
contract RiskManagerTest is Test {
    // --- Contract and Mocks ---
    RiskManager rm;
    MockCapitalPool cp;
    MockPoolRegistry pr;
    MockPolicyNFT nft;
    MockPolicyManager pm;
    MockBackstopPool cat;
    MockLossDistributor ld;
    MockRewardDistributor rd;
    MockUnderwriterManager um;
    MockERC20 usdc;
    MockERC20 protocolToken;

    // --- Actors ---
    address owner = address(this);
    address committee = address(0xBEEF);
    address underwriter = address(0xFACE);
    address claimant = address(0xC1A1);
    address liquidator = address(0xDEAD);
    address otherUser = address(0xBAD);

    // --- Events ---
    event UnderwriterLiquidated(address indexed liquidator, address indexed underwriter);

    function setUp() public {
        // --- Deploy Mocks ---
        usdc = new MockERC20("USD Coin", "USDC", 6);
        protocolToken = new MockERC20("Protocol Token", "PT", 18);
        cp = new MockCapitalPool(owner, address(usdc));
        pr = new MockPoolRegistry();
        nft = new MockPolicyNFT(owner);
        pm = new MockPolicyManager();
        cat = new MockBackstopPool(owner);
        ld = new MockLossDistributor();
        rd = new MockRewardDistributor();
        um = new MockUnderwriterManager();

        // --- Deploy Contract Under Test ---
        rm = new RiskManager(owner);

        // --- Link Mocks and Set Initial State ---
        pm.setPolicyNFT(address(nft));
        nft.setCoverPoolAddress(address(rm));
        rm.setAddresses(address(cp), address(pr), address(pm), address(cat), address(ld), address(rd), address(um));
        rm.setCommittee(committee);
    }

    function skip_processClaim_succeeds() public {
        // --- Arrange ---
        uint256 poolId = 0;
        uint256 policyId = 1;
        uint256 coverage = 50e18;
        uint256 totalPledge = 100e18;

        // 1. Set up the policy in the NFT mock
        nft.setPolicy(policyId, poolId, coverage, block.timestamp - 1 days);
        nft.setOwnerOf(policyId, claimant);

        // 2. Set up pool data in the registry mock
        address[] memory adapters = new address[](1);
        adapters[0] = address(0xA1);
        uint256[] memory capitalPerAdapter = new uint256[](1);
        capitalPerAdapter[0] = totalPledge;
        pr.setPoolPayoutData(poolId, adapters, capitalPerAdapter, totalPledge);
        pr.setPoolData(poolId, protocolToken, totalPledge, 0, 0, false, committee, rm.CLAIM_FEE_BPS());

        // 3. Mint tokens to claimant and approve RiskManager for premium
        uint256 protocolCoverage = coverage;
        protocolToken.mint(claimant, protocolCoverage);
        vm.prank(claimant);
        protocolToken.approve(address(rm), protocolCoverage);

        // --- Act ---
        vm.prank(claimant);
        rm.processClaim(policyId);

        // --- Assert ---
        // 1. Premium Distribution
        assertEq(rd.distributeCallCount(), 1);
        assertEq(rd.last_distribute_poolId(), poolId);
        assertEq(rd.last_distribute_protocolToken(), address(protocolToken));
        assertEq(rd.last_distribute_amount(), coverage);

        // 2. Loss Distribution
        assertEq(ld.distributeLossCallCount(), 1);
        assertEq(ld.last_distributeLoss_poolId(), poolId);
        assertEq(ld.last_distributeLoss_lossAmount(), coverage);

        // 3. Capital Pool Payout
        assertEq(cp.executePayoutCallCount(), 1);
        ICapitalPool.PayoutData memory payoutData = cp.last_executePayout_payoutData();
        uint256 expectedFee = (coverage * rm.CLAIM_FEE_BPS()) / rm.BPS();
        assertEq(payoutData.claimant, claimant);
        assertEq(payoutData.claimantAmount, coverage - expectedFee);
        assertEq(payoutData.feeRecipient, committee);
        assertEq(payoutData.feeAmount, expectedFee);

        // 4. PoolRegistry state updates
        (uint256 lastUpdatePoolId, , uint256 lastUpdateAmount, bool lastIsAllocation) = pr.get_last_updateCapitalAllocation();
        assertEq(lastUpdatePoolId, poolId);
        assertEq(lastUpdateAmount, coverage);
        assertFalse(lastIsAllocation);

        // 5. NFT Burn
        assertEq(nft.burnCallCount(), 1);
        assertEq(nft.lastBurnedTokenId(), policyId);
    }

    function skip_processClaim_withShortfall() public {
        // --- Arrange ---
        uint256 poolId = 0;
        uint256 policyId = 1;
        uint256 totalPledgeInPool = 50e18;
        uint256 coverageAmount = 80e18;
        uint256 expectedShortfall = coverageAmount - totalPledgeInPool;

        nft.setPolicy(policyId, poolId, coverageAmount, block.timestamp - 1 days);
        nft.setOwnerOf(policyId, claimant);
        pr.setPoolPayoutData(poolId, new address[](0), new uint256[](0), totalPledgeInPool);
        pr.setPoolData(poolId, protocolToken, totalPledgeInPool, 0, 0, false, committee, rm.CLAIM_FEE_BPS());
        uint256 protocolCoverage = coverageAmount;
        protocolToken.mint(claimant, protocolCoverage);
        vm.prank(claimant);
        protocolToken.approve(address(rm), protocolCoverage);

        // --- Act ---
        vm.prank(claimant);
        rm.processClaim(policyId);

        // --- Assert ---
        assertEq(cat.drawFundCallCount(), 1, "BackstopPool.drawFund should be called");
        assertEq(cat.last_drawFund_amount(), expectedShortfall, "Incorrect shortfall amount drawn");
    }


    function test_liquidateInsolventUnderwriter_succeeds() public {
        // --- Arrange ---
        uint256[] memory allocs = new uint256[](1);
        allocs[0] = 0;
        um.setUnderwriterAllocations(underwriter, allocs);
        cp.setUnderwriterAccount(underwriter, 0, 10_000e6, 0, 0); // 10k shares
        cp.setSharesToValue(10_000e6, 10_000e6); // 1-to-1 value
        ld.setPendingLosses(underwriter, 0, 0, 15_000e6); // Pending losses > share value

        // --- Act ---
        vm.expectEmit(true, true, false, false);
        emit UnderwriterLiquidated(liquidator, underwriter);
        vm.prank(liquidator);
        rm.liquidateInsolventUnderwriter(underwriter);

        // --- Assert ---
        assertEq(um.realizeLossesForAllPoolsCallCount(), 1);
        assertEq(um.last_realizeLossesForAllPools_user(), underwriter);
    }

    function testRevert_permissions() public {
        // --- Owner Functions ---
        vm.prank(otherUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otherUser));
        rm.setAddresses(address(cp), address(pr), address(pm), address(cat), address(ld), address(rd), address(um));

        vm.prank(otherUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otherUser));
        rm.setCommittee(committee);

        // --- PolicyManager-Only Function ---
        vm.prank(otherUser);
        vm.expectRevert(RiskManager.NotPolicyManager.selector);
        rm.updateCoverageSold(0, 100, true);
    }

    function testRevert_setAddresses_ifZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(RiskManager.ZeroAddressNotAllowed.selector);
        rm.setAddresses(address(0), address(pr), address(pm), address(cat), address(ld), address(rd), address(um));
    }

    function testRevert_processClaim_ifNotPolicyOwner() public {
        nft.setOwnerOf(1, claimant);
        vm.prank(otherUser); // Not the owner
        vm.expectRevert(RiskManager.OnlyPolicyOwner.selector);
        rm.processClaim(1);
    }

    function testRevert_processClaim_ifPolicyNotActive() public {
        uint256 policyId = 1;
        nft.mock_setPolicy(policyId, claimant, 0, 100, block.timestamp, block.timestamp + 1 days, 0, 0);

        vm.prank(claimant);
        vm.expectRevert("Policy not active");
        rm.processClaim(policyId);
    }

    function testRevert_liquidateInsolventUnderwriter_ifSolvent() public {
        // --- Arrange ---
        // Share value is GREATER than pending losses
        cp.setUnderwriterAccount(underwriter, 0, 10_000e6, 0, 0);
        cp.setSharesToValue(10_000e6, 10_000e6);
        ld.setPendingLosses(underwriter, 0, 0, 5_000e6);

        // --- Act & Assert ---
        vm.prank(liquidator);
        vm.expectRevert(RiskManager.UnderwriterNotInsolvent.selector);
        rm.liquidateInsolventUnderwriter(underwriter);
    }
}