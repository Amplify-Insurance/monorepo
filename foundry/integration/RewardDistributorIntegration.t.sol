// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ResetApproveERC20} from "contracts/test/ResetApproveERC20.sol";
import {SimpleYieldAdapter} from "contracts/adapters/SimpleYieldAdapter.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {UnderwriterManager} from "contracts/core/UnderwriterManager.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {MaliciousRewardRecipient} from "contracts/test/MaliciousRewardRecipient.sol";
import {ICapitalPool, YieldPlatform} from "contracts/interfaces/ICapitalPool.sol";

contract RewardDistributorIntegrationTest is Test {
    // Core Contracts
    ResetApproveERC20 usdc;
    ResetApproveERC20 protocolToken;
    SimpleYieldAdapter adapter;
    CapitalPool capitalPool;
    BackstopPool catPool;
    CatShare catShare;
    PolicyNFT policyNFT;
    PolicyManager policyManager;
    PoolRegistry poolRegistry;
    RewardDistributor rewardDistributor;
    LossDistributor lossDistributor;
    RiskManager riskManager;
    UnderwriterManager um;

    // Actors
    address owner = address(this);
    address committee = address(0x1);
    address underwriter = address(0x2);
    address secondUnderwriter = address(0x3);
    address attacker = address(0xBAD);


    // CORRECTED: The first pool created will have ID 0.
    uint256 constant POOL_ID = 0;
    uint256 constant PLEDGE_AMOUNT = 1_000_000e6;
    uint256 constant REWARD_AMOUNT = 100_000e6;
    uint256 PRECISION;

    function setUp() public {
        // --- Deploy Tokens ---
        usdc = new ResetApproveERC20("USD Coin", "USDC", 6);
        protocolToken = new ResetApproveERC20("Protocol Token", "PTKN", 18);
        usdc.mint(owner, 10_000_000e6);
        usdc.mint(address(this), 10_000_000e6); // For funding the distributor

        // --- Deploy Core Protocol ---
        adapter = new SimpleYieldAdapter(address(usdc), owner, owner);
        catShare = new CatShare();
        capitalPool = new CapitalPool(owner, address(usdc));
        catPool = new BackstopPool(usdc, catShare, adapter, owner);
        policyNFT = new PolicyNFT(owner, owner);
        policyManager = new PolicyManager(address(policyNFT), owner);
        riskManager = new RiskManager(owner);
        poolRegistry = new PoolRegistry(owner, address(riskManager));
        rewardDistributor = new RewardDistributor(address(riskManager), address(policyManager));
        lossDistributor = new LossDistributor(address(riskManager));
        um = new UnderwriterManager(owner);

        // --- Configure Dependencies ---
        capitalPool.setBaseYieldAdapter(YieldPlatform(3), address(adapter));
        catShare.transferOwnership(address(catPool));
        catPool.initialize();
        adapter.setDepositor(address(capitalPool));
        policyNFT.setPolicyManagerAddress(address(policyManager));
        rewardDistributor.setCatPool(address(catPool));
        
        // Link all contracts that depend on each other
        um.setAddresses(address(capitalPool), address(poolRegistry), address(catPool), address(lossDistributor), address(rewardDistributor), address(riskManager));
        riskManager.setAddresses(address(capitalPool), address(poolRegistry), address(policyManager), address(catPool), address(lossDistributor), address(rewardDistributor), address(um));
        policyManager.setAddresses(address(poolRegistry), address(capitalPool), address(catPool), address(rewardDistributor), address(riskManager));
        
        // Link CapitalPool to its dependencies
        capitalPool.setRiskManager(address(riskManager));
        // CORRECTED: The CapitalPool must know about the UnderwriterManager to forward deposit hooks.
        capitalPool.setUnderwriterManager(address(um));
        capitalPool.setRewardDistributor(address(rewardDistributor));

        // Link BackstopPool (cat) to its dependencies
        catPool.setRiskManagerAddress(address(riskManager));
        catPool.setPolicyManagerAddress(address(policyManager));
        catPool.setCapitalPoolAddress(address(capitalPool));
        catPool.setRewardDistributor(address(rewardDistributor));
        riskManager.setCommittee(committee);

        // --- Create Pool ---
        IPoolRegistry.RateModel memory rate = IPoolRegistry.RateModel({base: 100, slope1: 0, slope2: 0, kink: 8000});
        vm.prank(address(riskManager));
        // This creates a pool with ID 0
        poolRegistry.addProtocolRiskPool(address(usdc), rate, 0);

        // --- Initial Underwriter Deposit & Allocation ---
        usdc.mint(underwriter, PLEDGE_AMOUNT);
        vm.startPrank(underwriter);
        usdc.approve(address(capitalPool), type(uint256).max);
        capitalPool.deposit(PLEDGE_AMOUNT, YieldPlatform(3));
        
        uint256[] memory pools = new uint256[](1);
        pools[0] = POOL_ID; // Allocate to the correct pool ID (0)
        um.allocateCapital(pools);
        vm.stopPrank();

        // --- Fund Distributor ---
        usdc.transfer(address(rewardDistributor), 5_000_000e6);
        protocolToken.mint(address(rewardDistributor), 5_000e18);

        PRECISION = rewardDistributor.PRECISION_FACTOR();
    }

    function _distribute(address token, uint256 amount) internal {
        (, uint256 totalPledged,,,,,) = poolRegistry.getPoolData(POOL_ID);
        if (totalPledged == 0) {
            // To avoid division by zero if pool is empty
            vm.prank(address(riskManager));
            rewardDistributor.distribute(POOL_ID, token, amount, 1);
        } else {
            vm.prank(address(riskManager));
            rewardDistributor.distribute(POOL_ID, token, amount, totalPledged);
        }
    }

    /* ───────────────────────── ACCESS CONTROL & PERMISSIONS ───────────────────────── */

    function test_Permissions_Distribute() public {
        vm.prank(address(riskManager));
        rewardDistributor.distribute(POOL_ID, address(usdc), REWARD_AMOUNT, 1);
        vm.prank(address(policyManager));
        rewardDistributor.distribute(POOL_ID, address(usdc), REWARD_AMOUNT, 1);
        vm.prank(attacker);
        vm.expectRevert("RD: Not RiskManager or policyManager");
        rewardDistributor.distribute(POOL_ID, address(usdc), REWARD_AMOUNT, 1);
    }

    function test_Permissions_Claim() public {
        vm.prank(address(riskManager));
        rewardDistributor.claim(underwriter, POOL_ID, address(usdc), PLEDGE_AMOUNT);
        vm.prank(attacker);
        vm.expectRevert("RD: Not RiskManager");
        rewardDistributor.claim(underwriter, POOL_ID, address(usdc), PLEDGE_AMOUNT);
    }

    /* ───────────────────────── CORE FUNCTIONALITY & ACCRUAL ───────────────────────── */

    function test_ClaimViaUnderwriterManager() public {
        _distribute(address(usdc), REWARD_AMOUNT);
        uint256 pledge = um.underwriterPoolPledge(underwriter, POOL_ID);
        uint256 expected = rewardDistributor.pendingRewards(underwriter, POOL_ID, address(usdc), pledge);
        
        uint256 beforeBal = usdc.balanceOf(underwriter);
        uint256[] memory ids = new uint256[](1);
        ids[0] = POOL_ID;
        vm.prank(underwriter);
        um.claimPremiumRewards(ids);
        uint256 afterBal = usdc.balanceOf(underwriter);
        
        assertEq(afterBal - beforeBal, expected);
        assertEq(expected, REWARD_AMOUNT);
    }

    /* ───────────────────────── MULTI-USER & MULTI-TOKEN SCENARIOS ───────────────────────── */

    function test_MultiUser_FairDistribution() public {
        uint256 secondPledge = 3_000_000e6;
        usdc.mint(secondUnderwriter, secondPledge);
        vm.startPrank(secondUnderwriter);
        usdc.approve(address(capitalPool), type(uint256).max);
        capitalPool.deposit(secondPledge, YieldPlatform(3));
        uint256[] memory ids = new uint256[](1);
        ids[0] = POOL_ID;
        um.allocateCapital(ids);
        vm.stopPrank();

        uint256 totalPledge = PLEDGE_AMOUNT + secondPledge;
        _distribute(address(usdc), REWARD_AMOUNT);

        uint256 pledge1 = um.underwriterPoolPledge(underwriter, POOL_ID);
        uint256 expected1 = rewardDistributor.pendingRewards(underwriter, POOL_ID, address(usdc), pledge1);
        assertApproxEqAbs(expected1, (REWARD_AMOUNT * PLEDGE_AMOUNT) / totalPledge, 1);

        uint256 pledge2 = um.underwriterPoolPledge(secondUnderwriter, POOL_ID);
        uint256 expected2 = rewardDistributor.pendingRewards(secondUnderwriter, POOL_ID, address(usdc), pledge2);
        assertApproxEqAbs(expected2, (REWARD_AMOUNT * secondPledge) / totalPledge, 1);
    }

    function test_MultiToken_IndependentAccounting() public {
        _distribute(address(usdc), REWARD_AMOUNT);
        _distribute(address(protocolToken), REWARD_AMOUNT * 1e12);

        uint256 pledge = um.underwriterPoolPledge(underwriter, POOL_ID);
        uint256 expectedUsdc = rewardDistributor.pendingRewards(underwriter, POOL_ID, address(usdc), pledge);
        uint256 expectedPtkn = rewardDistributor.pendingRewards(underwriter, POOL_ID, address(protocolToken), pledge);

        uint256[] memory ids = new uint256[](1);
        ids[0] = POOL_ID;
        vm.prank(underwriter);
        um.claimPremiumRewards(ids);

        assertEq(usdc.balanceOf(underwriter), PLEDGE_AMOUNT + expectedUsdc);
        assertEq(protocolToken.balanceOf(underwriter), expectedPtkn);
        assertEq(rewardDistributor.pendingRewards(underwriter, POOL_ID, address(usdc), pledge), 0);
        assertEq(rewardDistributor.pendingRewards(underwriter, POOL_ID, address(protocolToken), pledge), 0);
    }

    /* ─────────────────── STATE, LIFECYCLE & EDGE CASES ─────────────────── */

    function test_Lifecycle_UserLeavesAndRejoins() public {
        _distribute(address(usdc), REWARD_AMOUNT);

        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, PLEDGE_AMOUNT, true);
        assertEq(um.underwriterPoolPledge(underwriter, POOL_ID), 0);
        assertEq(rewardDistributor.pendingRewards(underwriter, POOL_ID, address(usdc), 0), 0);

        vm.startPrank(underwriter);
        capitalPool.deposit(PLEDGE_AMOUNT, YieldPlatform(3));
        uint256[] memory ids = new uint256[](1);
        ids[0] = POOL_ID;
        um.allocateCapital(ids);
        vm.stopPrank();

        _distribute(address(usdc), REWARD_AMOUNT);

        uint256 pledge = um.underwriterPoolPledge(underwriter, POOL_ID);
        uint256 expected = rewardDistributor.pendingRewards(underwriter, POOL_ID, address(usdc), pledge);
        assertEq(expected, REWARD_AMOUNT);
    }

    function test_EdgeCase_DistributeToEmptyPool() public {
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, PLEDGE_AMOUNT, true);
        (, uint256 totalPledge,,,,,) = poolRegistry.getPoolData(POOL_ID);
        assertEq(totalPledge, 0);

        uint256 trackerBefore = rewardDistributor.poolRewardTrackers(POOL_ID, address(usdc));
        _distribute(address(usdc), REWARD_AMOUNT);
        uint256 trackerAfter = rewardDistributor.poolRewardTrackers(POOL_ID, address(usdc));

        assertEq(trackerBefore, trackerAfter, "Tracker should not change for empty pool");
    }

    function test_Lifecycle_ClaimAfterPartialWithdrawal() public {
        _distribute(address(usdc), REWARD_AMOUNT);

        uint256 withdrawAmount = PLEDGE_AMOUNT / 4;
        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, withdrawAmount, false);

        uint256 remainingPledge = PLEDGE_AMOUNT - withdrawAmount;
        assertEq(um.underwriterPoolPledge(underwriter, POOL_ID), remainingPledge);

        _distribute(address(usdc), REWARD_AMOUNT);

        uint256 expectedRewards = rewardDistributor.pendingRewards(underwriter, POOL_ID, address(usdc), remainingPledge);

        uint256 balBefore = usdc.balanceOf(underwriter);
        uint256[] memory ids = new uint256[](1);
        ids[0] = POOL_ID;
        vm.prank(underwriter);
        um.claimPremiumRewards(ids);
        uint256 balAfter = usdc.balanceOf(underwriter);

        assertEq(balAfter - balBefore, expectedRewards);
    }

    /* ─────────────────── MATHEMATICAL PRECISION & ROUNDING ─────────────────── */
    
    function test_Precision_DustAmounts() public {
        uint256 dustPledge = 100; // 100 wei
        uint256 dustReward = 10;  // 10 wei
        
        vm.startPrank(secondUnderwriter);
        usdc.mint(secondUnderwriter, dustPledge);
        usdc.approve(address(capitalPool), dustPledge);
        capitalPool.deposit(dustPledge, YieldPlatform(3));
        uint256[] memory ids = new uint256[](1);
        ids[0] = POOL_ID;
        um.allocateCapital(ids);
        vm.stopPrank();

        _distribute(address(usdc), dustReward);

        uint256 pledge = um.underwriterPoolPledge(secondUnderwriter, POOL_ID);
        uint256 pending = rewardDistributor.pendingRewards(secondUnderwriter, POOL_ID, address(usdc), pledge);
        
        // With dust amounts, the reward might be slightly off due to precision loss, but should be very close.
        assertGt(pending, 0, "Pending rewards should be greater than zero");
        assertApproxEqAbs(pending, dustReward * dustPledge / (PLEDGE_AMOUNT + dustPledge), 1);
    }

    function test_Precision_SequentialSmallDistributions() public {
        uint256 smallReward = 1;
        uint256 iterations = 50;
        for (uint i = 0; i < iterations; i++) {
            _distribute(address(usdc), smallReward);
        }

        uint256 pledge = um.underwriterPoolPledge(underwriter, POOL_ID);
        uint256 pending = rewardDistributor.pendingRewards(underwriter, POOL_ID, address(usdc), pledge);
        
        assertApproxEqAbs(pending, iterations * smallReward, 1, "Sequential small rewards did not accumulate correctly");
    }

    /* ─────────────────── SECURITY & FAILURE MODES ─────────────────── */

    function testRevert_ReentrancyAttackOnClaim() public {
        MaliciousRewardRecipient maliciousActor = new MaliciousRewardRecipient(address(rewardDistributor), address(riskManager));
        usdc.mint(address(maliciousActor), PLEDGE_AMOUNT);
        maliciousActor.depositAndAllocate(capitalPool, um, POOL_ID, PLEDGE_AMOUNT);

        usdc.transfer(address(rewardDistributor), REWARD_AMOUNT);
        _distribute(address(usdc), REWARD_AMOUNT);

        vm.prank(address(riskManager));
        vm.expectRevert("ReentrancyGuard: reentrant call");
        rewardDistributor.claim(address(maliciousActor), POOL_ID, address(usdc), PLEDGE_AMOUNT);
    }

    function testRevert_Claim_InsufficientDistributorBalance() public {
        // Drain the distributor's balance
        uint256 distributorBalance = usdc.balanceOf(address(rewardDistributor));
        if (distributorBalance > 0) {
            vm.prank(address(rewardDistributor));
            usdc.transfer(owner, distributorBalance);
        }
        assertEq(usdc.balanceOf(address(rewardDistributor)), 0);

        // Distribute rewards (this only updates accounting, doesn't require balance)
        _distribute(address(usdc), REWARD_AMOUNT);
        
        // Attempt to claim
        uint256[] memory ids = new uint256[](1);
        ids[0] = POOL_ID;
        vm.prank(underwriter);
        // The call should revert due to SafeERC20's check on insufficient balance
        vm.expectRevert();
        um.claimPremiumRewards(ids);
    }
}
