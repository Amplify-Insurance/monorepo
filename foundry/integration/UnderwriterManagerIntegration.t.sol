// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ResetApproveERC20} from "contracts/test/ResetApproveERC20.sol";
import {SimpleYieldAdapter} from "contracts/adapters/SimpleYieldAdapter.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";
import {UnderwriterManager} from "contracts/core/UnderwriterManager.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";

contract UnderwriterManagerIntegrationTest is Test {
    // Core protocol
    ResetApproveERC20 usdc;
    SimpleYieldAdapter adapter;
    CapitalPool capitalPool;
    BackstopPool catPool;
    CatShare catShare;
    PoolRegistry poolRegistry;
    RewardDistributor rewardDistributor;
    LossDistributor lossDistributor;
    RiskManager riskManager;
    PolicyNFT policyNFT;
    PolicyManager policyManager;
    UnderwriterManager um;

    // Actors
    address owner = address(this);
    address underwriter = address(0x1);

    uint256 constant PLEDGE = 1_000_000e6;
    uint256 constant POOL_ID = 0;

    function setUp() public {
        // Deploy tokens and adapter
        usdc = new ResetApproveERC20("USD Coin", "USDC", 6);
        adapter = new SimpleYieldAdapter(address(usdc), owner, owner);

        // Core contracts
        capitalPool = new CapitalPool(owner, address(usdc));
        catShare = new CatShare();
        catPool = new BackstopPool(usdc, catShare, adapter, owner);
        riskManager = new RiskManager(owner);
        poolRegistry = new PoolRegistry(owner, address(riskManager));
        rewardDistributor = new RewardDistributor(address(riskManager), address(0));
        lossDistributor = new LossDistributor(address(riskManager));
        policyNFT = new PolicyNFT(owner, owner);
        policyManager = new PolicyManager(address(policyNFT), owner);
        um = new UnderwriterManager(owner);

        // wire
        capitalPool.setBaseYieldAdapter(CapitalPool.YieldPlatform(3), address(adapter));
        adapter.setDepositor(address(capitalPool));
        catShare.transferOwnership(address(catPool));
        catPool.initialize();
        rewardDistributor.setCatPool(address(catPool));
        policyNFT.setPolicyManagerAddress(address(policyManager));
        policyManager.setAddresses(address(poolRegistry), address(capitalPool), address(catPool), address(rewardDistributor), address(riskManager));
        um.setAddresses(address(capitalPool), address(poolRegistry), address(catPool), address(lossDistributor), address(rewardDistributor), address(riskManager));
        riskManager.setAddresses(address(capitalPool), address(poolRegistry), address(policyManager), address(catPool), address(lossDistributor), address(rewardDistributor), address(um));
        capitalPool.setRiskManager(address(riskManager));
        poolRegistry.setRiskManager(address(riskManager));

        // create pool
        IPoolRegistry.RateModel memory rate = IPoolRegistry.RateModel({base:100, slope1:0, slope2:0, kink:8000});
        vm.prank(address(riskManager));
        poolRegistry.addProtocolRiskPool(address(usdc), rate, 0);

        // Underwriter deposit
        usdc.mint(underwriter, PLEDGE);
        vm.startPrank(underwriter);
        usdc.approve(address(capitalPool), type(uint256).max);
        capitalPool.deposit(PLEDGE, CapitalPool.YieldPlatform(3));
        vm.stopPrank();
    }

    function _singlePool() internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = POOL_ID;
    }

    function testAllocateAndDeallocateFlow() public {
        vm.startPrank(underwriter);
        um.allocateCapital(_singlePool());
        assertTrue(um.isAllocatedToPool(underwriter, POOL_ID));

        um.setDeallocationNoticePeriod(0);
        um.requestDeallocateFromPool(POOL_ID, PLEDGE);
        um.deallocateFromPool(POOL_ID);
        vm.stopPrank();

        assertFalse(um.isAllocatedToPool(underwriter, POOL_ID));
    }

    function testClaimPremiumRewardsIntegration() public {
        vm.startPrank(underwriter);
        um.allocateCapital(_singlePool());
        vm.stopPrank();

        // Distribute reward
        usdc.mint(address(rewardDistributor), 100e6);
        (,uint256 totalPledged,,,,,) = poolRegistry.getPoolData(POOL_ID);
        vm.prank(address(riskManager));
        rewardDistributor.distribute(POOL_ID, address(usdc), 100e6, totalPledged);

        uint256 balBefore = usdc.balanceOf(underwriter);
        uint256[] memory ids = _singlePool();
        vm.prank(underwriter);
        um.claimPremiumRewards(ids);
        uint256 balAfter = usdc.balanceOf(underwriter);
        assertGt(balAfter, balBefore);
    }

    function testOnCapitalWithdrawnFull() public {
        vm.startPrank(underwriter);
        um.allocateCapital(_singlePool());
        vm.stopPrank();

        vm.prank(address(capitalPool));
        um.onCapitalWithdrawn(underwriter, PLEDGE, true);

        assertEq(um.underwriterTotalPledge(underwriter), 0);
        assertEq(um.getUnderwriterAllocations(underwriter).length, 0);
    }
}

