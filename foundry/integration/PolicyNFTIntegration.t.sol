// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {UnderwriterManager} from "contracts/core/UnderwriterManager.sol";
import {ResetApproveERC20} from "contracts/test/ResetApproveERC20.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {SimpleYieldAdapter} from "contracts/adapters/SimpleYieldAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICapitalPool, YieldPlatform} from "contracts/interfaces/ICapitalPool.sol";

contract PolicyNFTIntegrationTest is Test {
    // Core Contracts
    PolicyManager pm;
    PolicyNFT nft;
    PoolRegistry registry;
    CapitalPool capital;
    BackstopPool cat;
    RewardDistributor rewards;
    LossDistributor lossDist;
    RiskManager rm;
    UnderwriterManager um;
    ResetApproveERC20 token; // Using a more standard mock
    CatShare catShare;
    SimpleYieldAdapter yieldAdapter;

    // Actors
    address owner = address(this);
    address user = address(0x1);
    address secondUser = address(0x2);
    address attacker = address(0xBAD);
    address committee = address(0xBEEF);

    // Constants
    uint256 constant POOL_ID = 0; // First pool has ID 0
    uint256 constant INITIAL_PLEDGE = 1_000_000e6;

    function setUp() public {
        token = new ResetApproveERC20("USD Coin", "USDC", 6);
        token.mint(user, 1_000_000e6);
        token.mint(secondUser, 1_000_000e6);
        token.mint(owner, INITIAL_PLEDGE); // For underwriting

        // Deploy Core Protocol
        rm = new RiskManager(owner);
        nft = new PolicyNFT(address(rm), owner); // Initially set to RM, will be updated to PM
        pm = new PolicyManager(address(nft), owner);
        registry = new PoolRegistry(owner, address(rm));
        capital = new CapitalPool(owner, address(token));
        um = new UnderwriterManager(owner);
        catShare = new CatShare();
        yieldAdapter = new SimpleYieldAdapter(address(token), address(this), owner);
        cat = new BackstopPool(IERC20(address(token)), catShare, yieldAdapter, owner);
        lossDist = new LossDistributor(address(rm));
        rewards = new RewardDistributor(address(rm), address(pm));

        // Configure Dependencies
        nft.setPolicyManagerAddress(address(pm));
        catShare.transferOwnership(address(cat));
        cat.initialize();
        rewards.setCatPool(address(cat));
        capital.setRiskManager(address(rm));
        capital.setBaseYieldAdapter(YieldPlatform(3), address(yieldAdapter));
        yieldAdapter.setDepositor(address(capital));
        cat.setRiskManager(address(rm));
        cat.setCapitalPool(address(capital));
        cat.setPolicyManager(address(pm));
        cat.setRewardDistributor(address(rewards));

        um.setAddresses(address(capital), address(registry), address(cat), address(lossDist), address(rewards), address(rm));
        rm.setAddresses(address(capital), address(registry), address(pm), address(cat), address(lossDist), address(rewards), address(um));
        pm.setAddresses(address(registry), address(capital), address(cat), address(rewards), address(rm));
        rm.setCommittee(committee);

        // Create and fund a risk pool
        IPoolRegistry.RateModel memory rate = IPoolRegistry.RateModel({base: 100, slope1: 0, slope2: 0, kink: 8000});
        vm.prank(address(rm));
        registry.addProtocolRiskPool(address(token), rate, 0);
        
        // Underwrite the pool
        vm.prank(owner);
        token.approve(address(capital), INITIAL_PLEDGE);
        capital.deposit(INITIAL_PLEDGE, YieldPlatform(3));
        uint256[] memory poolIds = new uint256[](1);
        poolIds[0] = POOL_ID;
        um.allocateCapital(poolIds);

        // Approve PolicyManager for premium payments
        vm.startPrank(user);
        token.approve(address(pm), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(secondUser);
        token.approve(address(pm), type(uint256).max);
        vm.stopPrank();
    }

    function _minPremium(uint256 coverage) internal view returns (uint256) {
        uint256 annualRate = 100; // 1%
        uint256 premium = (coverage * annualRate * 7 days) / (pm.SECS_YEAR() * pm.BPS());
        return premium == 0 ? 1 : premium;
    }

    /* ───────────────────────── PURCHASE & MINTING TESTS ───────────────────────── */

    function test_PurchaseCover_MintsPolicy() public {
        uint256 coverage = 500e6;
        uint256 premium = _minPremium(coverage);

        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, coverage, premium);

        assertEq(id, 1, "Policy ID should be 1");
        assertEq(nft.ownerOf(id), user, "Owner should be the user");

        PolicyNFT.Policy memory pol = nft.getPolicy(id);
        assertEq(pol.coverage, coverage, "Coverage mismatch");
        assertEq(pol.poolId, POOL_ID, "Pool ID mismatch");
        assertEq(pol.premiumDeposit, premium, "Premium deposit mismatch");
        assertEq(pol.start, block.timestamp, "Start time mismatch");
    }

    function testRevert_Purchase_ZeroCoverage() public {
        vm.prank(user);
        vm.expectRevert(PolicyManager.InvalidAmount.selector);
        pm.purchaseCover(POOL_ID, 0, 100e6);
    }

    function testRevert_Purchase_InsufficientPremium() public {
        uint256 coverage = 500e6;
        uint256 premium = _minPremium(coverage);
        
        vm.prank(user);
        vm.expectRevert(PolicyManager.DepositTooLow.selector);
        pm.purchaseCover(POOL_ID, coverage, premium - 1);
    }

    /* ───────────────────────── CANCEL & BURN TESTS ───────────────────────── */

    function test_CancelCover_BurnsPolicy() public {
        uint256 coverage = 500e6;
        uint256 premium = _minPremium(coverage);

        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, coverage, premium);

        vm.warp(block.timestamp + 1); // Ensure not in cooldown
        vm.prank(user);
        pm.cancelCover(id);

        vm.expectRevert(abi.encodeWithSignature("ERC721NonexistentToken(uint256)", id));
        nft.ownerOf(id);

        // Policy data should be cleared after burning
        PolicyNFT.Policy memory pol = nft.getPolicy(id);
        assertEq(pol.coverage, 0, "Coverage should be zero after burn");
        assertEq(pol.start, 0, "Start time should be zero after burn");
    }

    function testRevert_Cancel_NotOwner() public {
        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, 500e6, _minPremium(500e6));
        
        vm.warp(block.timestamp + 1);
        vm.prank(attacker);
        vm.expectRevert("PM: Not owner or approved");
        pm.cancelCover(id);
    }

    /* ───────────────────────── LAPSE & COOLDOWN TESTS ───────────────────────── */

    function test_LapsePolicy_BurnsAfterPremiumExhausted() public {
        uint256 coverage = 500e6;
        uint256 premium = _minPremium(coverage);

        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, coverage, premium);

        // Warp time far into the future so premium is definitely exhausted
        vm.warp(block.timestamp + pm.SECS_YEAR() * 2);
        
        // Anyone can call lapse on an expired policy
        vm.prank(attacker);
        pm.lapsePolicy(id);

        vm.expectRevert(abi.encodeWithSignature("ERC721NonexistentToken(uint256)", id));
        nft.ownerOf(id);
    }

    function testRevert_Lapse_PolicyStillActive() public {
        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, 500e6, _minPremium(500e6));
        
        // Not enough time has passed for the policy to lapse
        vm.warp(block.timestamp + 1);
        vm.prank(attacker);
        vm.expectRevert(PolicyManager.PolicyIsActive.selector);
        pm.lapsePolicy(id);
    }

    function test_CannotCancel_DuringCooldown() public {
        pm.setCoverCooldownPeriod(7 days);
        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, 500e6, _minPremium(500e6));

        // Still within the cooldown period
        vm.warp(block.timestamp + 1 days);
        vm.prank(user);
        vm.expectRevert(PolicyManager.CooldownActive.selector);
        pm.cancelCover(id);

        // After cooldown period
        vm.warp(block.timestamp + 7 days);
        vm.prank(user);
        pm.cancelCover(id); // Should succeed now
    }

    /* ─────────────────── PREMIUM MANAGEMENT ─────────────────── */
    


    /* ─────────────────── COVERAGE INCREASE & FINALIZATION ─────────────────── */

    function test_FinalizeIncrease_OnCancel() public {
        pm.setCoverCooldownPeriod(1 days);
        uint256 initialCoverage = 500e6;
        uint256 increaseAmount = 200e6;
        uint256 premium = _minPremium(initialCoverage + increaseAmount);

        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, initialCoverage, premium);
        vm.prank(user);
        pm.increaseCover(id, increaseAmount);

        // Warp time past the cooldown for the increase
        vm.warp(block.timestamp + 1 days + 1);

        // The increase is finalized upon the next interaction, like cancelCover.
        // We expect the event from the NFT contract confirming the coverage increase.
        vm.expectEmit(true, true, true, true, address(nft));
        emit PolicyNFT.PolicyCoverageIncreased(id, initialCoverage + increaseAmount);

        vm.prank(user);
        pm.cancelCover(id);
    }

    function test_MultipleIncreases_FinalizeCorrectly() public {
        pm.setCoverCooldownPeriod(1 days);
        uint256 initialCoverage = 500e6;
        uint256 increase1 = 100e6;
        uint256 increase2 = 150e6;
        uint256 premium = _minPremium(initialCoverage + increase1 + increase2);

        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, initialCoverage, premium);
        
        vm.prank(user);
        pm.increaseCover(id, increase1);
        
        vm.warp(block.timestamp + 2 hours); // Not past cooldown yet

        vm.prank(user);
        pm.increaseCover(id, increase2);

        // Warp past the cooldown for both increases
        vm.warp(block.timestamp + 1 days + 1);
        
        vm.expectEmit(true, true, true, true, address(nft));
        emit PolicyNFT.PolicyCoverageIncreased(id, initialCoverage + increase1 + increase2);

        vm.prank(user);
        pm.cancelCover(id);
    }

    function testRevert_FinalizeIncrease_CalledByNonPolicyManager() public {
        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, 500e6, _minPremium(500e6));
        
        vm.prank(attacker);
        vm.expectRevert("PolicyNFT: Caller is not the authorized PolicyManager");
        nft.finalizeIncreases(id, 100e6);
    }

    /* ─────────────────── OWNERSHIP & TRANSFER TESTS ─────────────────── */

    function test_TransferPolicy_UpdatesOwner() public {
        uint256 coverage = 500e6;
        uint256 premium = _minPremium(coverage);

        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, coverage, premium);
        assertEq(nft.ownerOf(id), user);

        vm.prank(user);
        nft.transferFrom(user, secondUser, id);
        
        assertEq(nft.ownerOf(id), secondUser, "New owner should be secondUser");
    }

    function test_NewOwnerCanCancelPolicy() public {
        uint256 coverage = 500e6;
        uint256 premium = _minPremium(coverage);

        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, coverage, premium);
        
        vm.prank(user);
        nft.transferFrom(user, secondUser, id);

        vm.warp(block.timestamp + 1); // Pass cooldown
        
        // The original owner can no longer cancel
        vm.prank(user);
        vm.expectRevert("PM: Not owner or approved");
        pm.cancelCover(id);

        // The new owner can cancel
        vm.prank(secondUser);
        pm.cancelCover(id);

        vm.expectRevert(abi.encodeWithSignature("ERC721NonexistentToken(uint256)", id));
        nft.ownerOf(id);
    }

    /* ─────────────────── CLAIM INTERACTION ─────────────────── */

    function test_PolicyCannotBeInteractedWith_AfterClaim() public {
        uint256 coverage = 500e6;
        uint256 premium = _minPremium(coverage);
        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, coverage, premium);

        // Process a claim against the policy
        vm.prank(committee); // The committee processes claims in this setup
        rm.processClaim(id);

        // The policy should now be burned and non-existent
        vm.expectRevert(abi.encodeWithSignature("ERC721NonexistentToken(uint256)", id));
        nft.ownerOf(id);

        // Attempting to cancel should fail because the token doesn't exist
        vm.prank(user);
        vm.expectRevert("PM: Policy does not exist");
        pm.cancelCover(id);

        // Attempting to lapse should also fail
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSignature("ERC721NonexistentToken(uint256)", id));
        pm.lapsePolicy(id);
    }
}
