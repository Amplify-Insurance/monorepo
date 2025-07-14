// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ResetApproveERC20} from "contracts/test/ResetApproveERC20.sol";
import {SimpleYieldAdapter} from "contracts/adapters/SimpleYieldAdapter.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";

contract LossDistributorIntegration is Test {
    // Core contracts
    ResetApproveERC20 usdc;
    ResetApproveERC20 protocolToken;
    SimpleYieldAdapter adapter;
    CapitalPool capitalPool;
    RiskManager riskManager;
    PoolRegistry poolRegistry;
    PolicyNFT policyNFT;
    PolicyManager policyManager;
    BackstopPool catPool;
    CatShare catShare;
    RewardDistributor rewardDistributor;
    LossDistributor lossDistributor;

    // actors
    address owner = address(this);
    address committee = address(0xBEEF);
    address underwriter = address(0x1);
    address claimant = address(0x2);
    address secondUnderwriter = address(0x3);

    // constants
    uint8 constant PLATFORM_OTHER = 3; // CapitalPool.YieldPlatform.OTHER_YIELD
    uint256 constant TOTAL_PLEDGE = 100_000e6;
    uint256 constant COVERAGE = 50_000e6;

    uint256 POOL_ID;
    uint256 POLICY_ID;
    uint256 PRECISION;

    function setUp() public {
        usdc = new ResetApproveERC20("USD Coin", "USDC", 6);
        protocolToken = new ResetApproveERC20("Protocol", "PTKN", 6);

        adapter = new SimpleYieldAdapter(address(usdc), address(this), owner);

        capitalPool = new CapitalPool(owner, address(usdc));
        capitalPool.setBaseYieldAdapter(CapitalPool.YieldPlatform(PLATFORM_OTHER), address(adapter));
        adapter.setDepositor(address(capitalPool));

        riskManager = new RiskManager(owner);

        catShare = new CatShare();
        catPool = new BackstopPool(usdc, catShare, adapter, owner);
        catShare.transferOwnership(address(catPool));
        catPool.initialize();
        catPool.setRiskManagerAddress(address(riskManager));
        catPool.setCapitalPoolAddress(address(capitalPool));

        policyNFT = new PolicyNFT(address(riskManager), owner);
        policyManager = new PolicyManager(address(policyNFT), owner);

        rewardDistributor = new RewardDistributor(address(riskManager), address(policyManager));
        rewardDistributor.setCatPool(address(catPool));
        lossDistributor = new LossDistributor(address(riskManager));

        poolRegistry = new PoolRegistry(owner, address(riskManager));

        policyManager.setAddresses(
            address(poolRegistry),
            address(capitalPool),
            address(catPool),
            address(rewardDistributor),
            address(riskManager)
        );

        riskManager.setAddresses(
            address(capitalPool),
            address(poolRegistry),
            address(policyManager),
            address(catPool),
            address(lossDistributor),
            address(rewardDistributor)
        );
        riskManager.setCommittee(committee);
        poolRegistry.setRiskManager(address(riskManager));
        catPool.setPolicyManagerAddress(address(policyManager));
        capitalPool.setRiskManager(address(riskManager));

        IPoolRegistry.RateModel memory rate = IPoolRegistry.RateModel({base:0, slope1:0, slope2:0, kink:8000});
        POOL_ID = riskManager.addProtocolRiskPool(address(protocolToken), rate, 500);

        usdc.mint(underwriter, TOTAL_PLEDGE);
        vm.startPrank(underwriter);
        usdc.approve(address(capitalPool), TOTAL_PLEDGE);
        capitalPool.deposit(TOTAL_PLEDGE, CapitalPool.YieldPlatform(PLATFORM_OTHER));
        riskManager.allocateCapital(_arr(POOL_ID));
        vm.stopPrank();

        protocolToken.mint(claimant, 100_000e6);
        vm.prank(claimant);
        protocolToken.approve(address(riskManager), type(uint256).max);

        vm.prank(address(riskManager));
        POLICY_ID = policyNFT.mint(claimant, POOL_ID, COVERAGE, 0, 0, 0);

        PRECISION = lossDistributor.PRECISION_FACTOR();
    }

    function _arr(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }

    function testPoolTrackerUpdatesOnClaim() public {
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);
        uint256 expected = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID), expected);
    }

    function testRealizesLossesOnWithdrawal() public {
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);
        // Simulate the capital pool calling the withdrawal hook directly to
        // avoid reentrancy issues in this test environment.
        vm.prank(address(capitalPool));
        riskManager.onCapitalWithdrawn(underwriter, TOTAL_PLEDGE, true);
        assertEq(riskManager.underwriterTotalPledge(underwriter), 0);
    }

    function testAccumulatesLossForMultipleClaims() public {
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);
        uint256 cover2 = 20_000e6;
        vm.prank(address(riskManager));
        uint256 policy2 = policyNFT.mint(claimant, POOL_ID, cover2, 0, 0, 0);
        vm.prank(claimant);
        riskManager.processClaim(policy2);
        uint256 expected = ((COVERAGE * PRECISION) / TOTAL_PLEDGE) + ((cover2 * PRECISION) / (TOTAL_PLEDGE - COVERAGE));
        assertEq(lossDistributor.poolLossTrackers(POOL_ID), expected);
    }

    function testNewUnderwriterInheritsExistingLossTracker() public {
        vm.prank(claimant);
        riskManager.processClaim(POLICY_ID);

        uint256 newPledge = 50_000e6;
        usdc.mint(secondUnderwriter, newPledge);
        vm.startPrank(secondUnderwriter);
        usdc.approve(address(capitalPool), newPledge);
        capitalPool.deposit(newPledge, CapitalPool.YieldPlatform(PLATFORM_OTHER));
        riskManager.allocateCapital(_arr(POOL_ID));
        vm.stopPrank();

        uint256 expectedTracker = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
        assertEq(lossDistributor.poolLossTrackers(POOL_ID), expectedTracker);
        uint256 expectedLoss = (newPledge * COVERAGE) / TOTAL_PLEDGE;
        assertEq(lossDistributor.getPendingLosses(secondUnderwriter, POOL_ID, newPledge), expectedLoss);

        // Realize the losses via the RiskManager hook directly
        vm.prank(address(capitalPool));
        riskManager.onCapitalWithdrawn(secondUnderwriter, newPledge, true);
    }
}

