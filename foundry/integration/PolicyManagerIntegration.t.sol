// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
// CORRECTED: Added the missing import for Ownable
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {UnderwriterManager} from "contracts/core/UnderwriterManager.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";
import {USDCoin} from "contracts/tokens/USDCoin.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {IYieldAdapter} from "contracts/interfaces/IYieldAdapter.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {IPolicyNFT} from "contracts/interfaces/IPolicyNFT.sol";
import {ICapitalPool, YieldPlatform} from "contracts/interfaces/ICapitalPool.sol";

import {SimpleYieldAdapter} from "contracts/adapters/SimpleYieldAdapter.sol";

contract PolicyManagerIntegration is Test {
    // --- Core Contracts ---
    PolicyManager pm;
    RiskManager rm;
    UnderwriterManager um;
    PoolRegistry registry;
    CapitalPool capital;
    BackstopPool cat;
    PolicyNFT nft;
    MockRewardDistributor rewards;
    LossDistributor losses;
    USDCoin token;
    CatShare catShare;
    SimpleYieldAdapter yieldAdapter;

    // --- Actors ---
    address owner = address(this);
    address user = address(0x1);
    address underwriter = address(0x2);
    address otherUser = address(0x3);

    uint256 constant POOL_ID = 0;

    function setUp() public {
        // --- Deploy Tokens & Mocks ---
        token = new USDCoin();
        token.mint(user, 1_000_000e6);
        token.mint(underwriter, 1_000_000e6);
        yieldAdapter = new SimpleYieldAdapter(address(token), address(this), owner);

        // --- Deploy Core Contracts ---
        // The PolicyNFT needs to know about the PolicyManager, but the PolicyManager also needs the NFT.
        // We deploy the NFT first, giving it temporary addresses, then deploy the PM,
        // and finally update the NFT with the real PM address.
        nft = new PolicyNFT(address(this), address(this)); // Temp owner/manager
        pm = new PolicyManager(address(nft), owner);
        nft.setPolicyManagerAddress(address(pm)); // Correctly link the NFT to the PM

        rm = new RiskManager(owner);
        // CORRECTED: Swapped constructor arguments, assuming the intended order is (riskManager, owner).
        // This ensures the registry correctly stores the RiskManager's address.
        registry = new PoolRegistry(address(rm), owner);
        capital = new CapitalPool(owner, address(token));
        capital.setBaseYieldAdapter(YieldPlatform.OTHER_YIELD, address(yieldAdapter));
        yieldAdapter.setDepositor(address(capital));

        catShare = new CatShare();
        // Deploy BackstopPool (cat) before trying to mint tokens to it.
        cat = new BackstopPool(token, catShare, IYieldAdapter(address(0)), owner);
        cat.setPolicyManagerAddress(address(pm));
        token.mint(address(cat), 1_000_000e6); // Mint tokens to the now-deployed cat pool

        rewards = new MockRewardDistributor();
        losses = new LossDistributor(address(rm));
        um = new UnderwriterManager(owner);

        // --- Link Contracts ---
        // Set all the necessary addresses for inter-contract communication.
        pm.setAddresses(address(registry), address(capital), address(cat), address(rewards), address(rm));
        um.setAddresses(address(capital), address(registry), address(cat), address(losses), address(rewards), address(rm));
        rm.setAddresses(address(capital), address(registry), address(pm), address(cat), address(losses), address(rewards), address(um));
        capital.setRiskManager(address(rm));
        capital.setUnderwriterManager(address(um));
        capital.setRewardDistributor(address(rewards)); // Link reward distributor to capital pool
        catShare.transferOwnership(address(cat)); // Transfer ownership of CatShare to the BackstopPool
        cat.initialize(); // Initialize the BackstopPool

        // --- Setup Initial Pool State ---
        IPoolRegistry.RateModel memory rate = IPoolRegistry.RateModel({base: 100, slope1: 200, slope2: 500, kink: 8000});
        
        // The RiskManager must add the pool, not the owner.
        vm.prank(address(rm));
        registry.addProtocolRiskPool(address(token), rate, 0);

        // Underwriter provides capital to the pool
        vm.startPrank(underwriter);
        token.approve(address(capital), type(uint256).max);
        capital.deposit(1_000_000e6, YieldPlatform.OTHER_YIELD);
        vm.stopPrank();
        
        // Underwriter allocates capital to our test pool
        uint256[] memory pools = new uint256[](1);
        pools[0] = POOL_ID;
        vm.prank(underwriter);
        um.allocateCapital(pools);

        // User approves policy manager to spend tokens for premiums
        vm.prank(user);
        token.approve(address(pm), type(uint256).max);
    }


    function _minPremium(uint256 coverage) internal view returns (uint256) {
        uint256 annualRate = 100; // from rate model
        return (coverage * annualRate * 7 days) / (pm.SECS_YEAR() * pm.BPS());
    }

    function testPurchaseCoverUpdatesCoverageSold() public {
        uint256 coverage = 1_000e6;
        uint256 deposit = _minPremium(coverage);
        if (deposit == 0) deposit = 1;

        vm.prank(user);
        pm.purchaseCover(POOL_ID, coverage, deposit);

        (, , uint256 sold, , , , ) = registry.getPoolData(POOL_ID);
        assertEq(sold, coverage);
    }

    function testIncreaseCoverUpdatesCoverageSold() public {
        uint256 coverage = 500e6;
        uint256 add = 200e6;
        uint256 deposit = 1_000_000e6;

        vm.startPrank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);
        pm.increaseCover(policyId, add);
        vm.stopPrank();

        (, , uint256 sold, , , , ) = registry.getPoolData(POOL_ID);
        assertEq(sold, coverage + add);
        assertEq(pm.pendingCoverageSum(policyId), add);
    }

    function testCancelCoverResetsCoverageSoldAndRefunds() public {
        uint256 coverage = 800e6;
        uint256 add = 200e6;
        uint256 deposit = 1_000_000e6;

        vm.startPrank(user);
        uint256 startingBal = token.balanceOf(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);
        pm.increaseCover(policyId, add);
        pm.cancelCover(policyId);
        vm.stopPrank();

        (, , uint256 sold, , , , ) = registry.getPoolData(POOL_ID);
        assertEq(sold, 0);
        assertEq(token.balanceOf(user), startingBal);
    }

    function testLapsePolicyReducesCoverageSold() public {
        uint256 coverage = 500e6;
        uint256 deposit = _minPremium(coverage);
        if (deposit == 0) deposit = 1;

        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        vm.warp(block.timestamp + pm.SECS_YEAR());
        vm.prank(user);
        pm.lapsePolicy(policyId);

        (, , uint256 sold, , , , ) = registry.getPoolData(POOL_ID);
        assertEq(sold, 0);
    }

    function test_premiumDrainsOverTime_andDistributes() public {
        uint256 coverage = 100_000e6;
        uint256 deposit = 1_000_000e6;
        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        vm.warp(block.timestamp + 30 days);

        vm.prank(user);
        pm.increaseCover(policyId, 1e6);

        IPolicyNFT.Policy memory pol = nft.getPolicy(policyId);
        assertTrue(pol.premiumDeposit < deposit, "Premium deposit should have decreased");

        uint256 drainedAmount = deposit - pol.premiumDeposit;
        uint256 expectedCatShare = (drainedAmount * pm.catPremiumBps()) / pm.BPS();
        
        assertEq(cat.idleUSDC(), expectedCatShare, "BackstopPool did not receive its share of the premium");
        assertEq(rewards.distributeCallCount(), 1, "RewardDistributor should have been called");
        assertEq(rewards.last_distribute_amount(), drainedAmount - expectedCatShare, "RewardDistributor received incorrect amount");
    }

    function test_pendingIncrease_resolvesAfterCooldown() public {
        uint256 cooldown = 7 days;
        pm.setCoverCooldownPeriod(cooldown);

        uint256 coverage = 500e6;
        uint256 add = 200e6;
        uint256 deposit = 1_000_000e6;

        vm.startPrank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);
        pm.increaseCover(policyId, add);
        vm.stopPrank();

        IPolicyNFT.Policy memory polBefore = nft.getPolicy(policyId);
        assertEq(polBefore.coverage, coverage, "Coverage should not increase immediately");

        vm.warp(block.timestamp + cooldown + 1 days);

        // Check the state on the registry instead of the mock
        (, , uint256 soldBefore, , , , ) = registry.getPoolData(POOL_ID);
        assertEq(soldBefore, coverage + add);

        vm.prank(user);
        pm.cancelCover(policyId);

        (, , uint256 soldAfter, , , , ) = registry.getPoolData(POOL_ID);
        assertEq(soldAfter, 0, "Coverage sold should be zero after cancel");
    }

    function test_cancelCover_clearsPendingIncreases() public {
        uint256 coverage = 500e6;
        uint256 add = 200e6;
        uint256 deposit = 1_000_000e6;

        vm.startPrank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);
        pm.increaseCover(policyId, add);
        vm.stopPrank();

        assertEq(pm.pendingCoverageSum(policyId), add);
        
        vm.prank(user);
        pm.cancelCover(policyId);

        assertEq(pm.pendingCoverageSum(policyId), 0, "Pending coverage sum should be zero after cancel");
    }

    function test_premiumDraining_fullyLapsesPolicy() public {
        uint256 coverage = 100_000e6;
        uint256 deposit = _minPremium(coverage) + 1;
        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        vm.warp(block.timestamp + 8 days);

        assertFalse(pm.isPolicyActive(policyId), "Policy should be inactive after premium is drained");

        vm.prank(user);
        vm.expectRevert(PolicyManager.PolicyNotActive.selector);
        pm.increaseCover(policyId, 1e6);
    }

    function test_cancelCover_refundsCorrectAmount_afterPremiumDrain() public {
        uint256 coverage = 100_000e6;
        uint256 deposit = 1_000_000e6;
        
        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        vm.warp(block.timestamp + 30 days);

        uint256 balanceBeforeCancel = token.balanceOf(user);
        vm.prank(user);
        pm.cancelCover(policyId);
        uint256 balanceAfterCancel = token.balanceOf(user);

        IPolicyNFT.Policy memory pol = nft.getPolicy(policyId);
        assertApproxEqAbs(balanceAfterCancel - balanceBeforeCancel, pol.premiumDeposit, 1, "Refund amount is incorrect");
    }

    function test_multiplePendingIncreases_resolveCorrectly() public {
        uint256 coverage = 500e6;
        uint256 add1 = 100e6;
        uint256 add2 = 150e6;
        uint256 deposit = 1_000_000e6;
        pm.setCoverCooldownPeriod(1 days);

        vm.startPrank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);
        pm.increaseCover(policyId, add1);
        vm.warp(block.timestamp + 2 hours);
        pm.increaseCover(policyId, add2);
        vm.stopPrank();

        assertEq(pm.pendingCoverageSum(policyId), add1 + add2);

        vm.warp(block.timestamp + 2 days);

        vm.prank(user);
        pm.increaseCover(policyId, 1e6);

        IPolicyNFT.Policy memory pol = nft.getPolicy(policyId);
        assertEq(pol.coverage, coverage + add1 + add2, "All pending increases should have been finalized");
        assertEq(pm.pendingCoverageSum(policyId), 1e6, "Only the last increase should be pending");
    }
    
    function testLapsePolicy_clearsPendingIncreases() public {
        uint256 coverage = 500e6;
        uint256 add = 200e6;
        uint256 deposit = _minPremium(coverage) + 1;

        vm.startPrank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);
        pm.increaseCover(policyId, add);
        vm.stopPrank();

        assertEq(pm.pendingCoverageSum(policyId), add);
        
        // Check registry state instead of mock
        (, , uint256 soldBefore, , , , ) = registry.getPoolData(POOL_ID);
        assertEq(soldBefore, coverage + add, "Coverage sold before lapse is incorrect");

        vm.warp(block.timestamp + 8 days);
        vm.prank(user);
        pm.lapsePolicy(policyId);

        assertEq(pm.pendingCoverageSum(policyId), 0, "Pending coverage should be cleared on lapse");
        (, , uint256 soldAfter, , , , ) = registry.getPoolData(POOL_ID);
        assertEq(soldAfter, 0, "Lapse did not reduce coverage correctly");
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* REVERT & PERMISSION TESTS                         */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function testRevert_purchaseCover_insufficientCapacity() public {
        uint256 coverage = 2_000_000e6;
        uint256 deposit = _minPremium(coverage);
        if (deposit == 0) deposit = 1;

        vm.prank(user);
        vm.expectRevert(PolicyManager.InsufficientCapacity.selector);
        pm.purchaseCover(POOL_ID, coverage, deposit);
    }
    
    function testRevert_purchaseCover_ifPoolIsPaused() public {
        vm.prank(address(this));
        registry.setPauseState(POOL_ID, true);
        (, , , , bool paused,,) = registry.getPoolData(POOL_ID);
        assertTrue(paused);

        uint256 coverage = 1_000e6;
        uint256 deposit = _minPremium(coverage);
        if (deposit == 0) deposit = 1;
        
        vm.prank(user);
        vm.expectRevert(PolicyManager.PoolPaused.selector);
        pm.purchaseCover(POOL_ID, coverage, deposit);
    }

    function testRevert_increaseCover_ifPoolIsPaused() public {
        uint256 policyId = pm.purchaseCover(POOL_ID, 500e6, 1_000_000e6);
        
        vm.prank(address(this));
        registry.setPauseState(POOL_ID, true);

        vm.prank(user);
        vm.expectRevert(PolicyManager.PoolPaused.selector);
        pm.increaseCover(policyId, 100e6);
    }

    function testRevert_increaseCover_ifDepositTooLow() public {
        uint256 coverage = 500e6;
        uint256 deposit = _minPremium(coverage) + 1;
        
        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        vm.prank(user);
        vm.expectRevert(PolicyManager.DepositTooLow.selector);
        pm.increaseCover(policyId, 100e6);
    }

    function testRevert_cancelCover_duringCooldown() public {
        pm.setCoverCooldownPeriod(7 days);
        uint256 coverage = 500e6;
        uint256 deposit = _minPremium(coverage);
        if (deposit == 0) deposit = 1;

        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        vm.prank(user);
        vm.expectRevert(PolicyManager.CooldownActive.selector);
        pm.cancelCover(policyId);
    }
    
    function testRevert_cancelCover_onLapsedPolicy() public {
        uint256 coverage = 500e6;
        uint256 deposit = _minPremium(coverage) + 1;
        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        vm.warp(block.timestamp + 8 days);
        assertFalse(pm.isPolicyActive(policyId));

        vm.prank(user);
        vm.expectRevert(PolicyManager.PolicyNotActive.selector);
        pm.cancelCover(policyId);
    }

    function testRevert_adminFunctions_ifNotOwner() public {
        vm.prank(otherUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otherUser));
        pm.setAddresses(address(registry), address(capital), address(cat), address(rewards), address(rm));

        vm.prank(otherUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otherUser));
        pm.setCoverCooldownPeriod(1 days);
    }

    function testRevert_clearAllPendingIncreases_exceedsProcessLimit() public {
        uint256 policyId = pm.purchaseCover(POOL_ID, 500e6, 1_000_000e6);
        uint256 PROCESS_LIMIT = 50;
        
        vm.startPrank(user);
        for (uint i = 0; i < PROCESS_LIMIT + 1; i++) {
            pm.increaseCover(policyId, 1e6);
        }
        vm.stopPrank();

        vm.prank(user);
        vm.expectRevert(PolicyManager.TooManyPendingIncreases.selector);
        pm.cancelCover(policyId);
    }
}
