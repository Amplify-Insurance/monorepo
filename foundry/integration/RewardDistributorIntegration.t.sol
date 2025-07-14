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
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";

contract RewardDistributorIntegration is Test {
    ResetApproveERC20 usdc;
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

    address owner = address(this);
    address committee = address(0x1);
    address underwriter = address(0x2);

    uint256 constant POOL_ID = 0;
    uint256 constant PLEDGE_AMOUNT = 1_000e6;
    uint256 constant REWARD_AMOUNT = 100e6;

    function setUp() public {
        // Deploy token and adapter
        usdc = new ResetApproveERC20("USD Coin", "USDC", 6);
        usdc.mint(owner, 1_000_000e6);
        adapter = new SimpleYieldAdapter(address(usdc), owner, owner);

        // Core protocol contracts
        catShare = new CatShare();
        capitalPool = new CapitalPool(owner, address(usdc));
        capitalPool.setBaseYieldAdapter(CapitalPool.YieldPlatform.AAVE, address(adapter));
        catPool = new BackstopPool(usdc, catShare, adapter, owner);
        catShare.transferOwnership(address(catPool));
        catPool.initialize();
        adapter.setDepositor(address(capitalPool));

        policyNFT = new PolicyNFT(owner, owner);
        policyManager = new PolicyManager(address(policyNFT), owner);
        policyNFT.setPolicyManagerAddress(address(policyManager));

        riskManager = new RiskManager(owner);
        poolRegistry = new PoolRegistry(owner, address(riskManager));
        rewardDistributor = new RewardDistributor(address(riskManager), address(policyManager));
        rewardDistributor.setCatPool(address(catPool));
        lossDistributor = new LossDistributor(address(riskManager));

        // Wire up addresses
        riskManager.setAddresses(
            address(capitalPool),
            address(poolRegistry),
            address(policyManager),
            address(catPool),
            address(lossDistributor),
            address(rewardDistributor)
        );
        capitalPool.setRiskManager(address(riskManager));
        policyManager.setAddresses(
            address(poolRegistry),
            address(capitalPool),
            address(catPool),
            address(rewardDistributor),
            address(riskManager)
        );
        catPool.setRiskManagerAddress(address(riskManager));
        catPool.setPolicyManagerAddress(address(policyManager));
        catPool.setCapitalPoolAddress(address(capitalPool));
        catPool.setRewardDistributor(address(rewardDistributor));
        riskManager.setCommittee(committee);

        // Create pool
        IPoolRegistry.RateModel memory rate = IPoolRegistry.RateModel({base: 100, slope1: 0, slope2: 0, kink: 8000});
        riskManager.addProtocolRiskPool(address(usdc), rate, 0);

        // Initial deposit & allocation
        usdc.mint(underwriter, PLEDGE_AMOUNT);
        vm.startPrank(underwriter);
        usdc.approve(address(capitalPool), type(uint256).max);
        capitalPool.deposit(PLEDGE_AMOUNT, CapitalPool.YieldPlatform.AAVE);
        uint256[] memory pools = new uint256[](1);
        pools[0] = POOL_ID;
        riskManager.allocateCapital(pools);
        vm.stopPrank();

        // Fund distributor
        usdc.mint(address(rewardDistributor), 1_000e6);
    }

    function _distribute() internal {
        (, uint256 totalPledged,,,,,) = poolRegistry.getPoolData(POOL_ID);
        vm.prank(address(riskManager));
        rewardDistributor.distribute(POOL_ID, address(usdc), REWARD_AMOUNT, totalPledged);
    }

    function testClaimViaRiskManager() public {
        _distribute();
        uint256 pledge = riskManager.underwriterPoolPledge(underwriter, POOL_ID);
        uint256 expected = rewardDistributor.pendingRewards(underwriter, POOL_ID, address(usdc), pledge);
        uint256 beforeBal = usdc.balanceOf(underwriter);
        uint256[] memory ids = new uint256[](1);
        ids[0] = POOL_ID;
        vm.prank(underwriter);
        riskManager.claimPremiumRewards(ids);
        uint256 afterBal = usdc.balanceOf(underwriter);
        assertEq(afterBal - beforeBal, expected);
    }

    function testAccruesAfterAdditionalDeposit() public {
        _distribute();
        uint256[] memory ids = new uint256[](1);
        ids[0] = POOL_ID;
        vm.prank(underwriter);
        riskManager.claimPremiumRewards(ids);

        uint256 extra = 500e6;
        usdc.mint(underwriter, extra);
        vm.startPrank(underwriter);
        usdc.approve(address(capitalPool), 0);
        usdc.approve(address(capitalPool), type(uint256).max);
        capitalPool.deposit(extra, CapitalPool.YieldPlatform.AAVE);
        vm.stopPrank();
        vm.prank(address(riskManager));
        poolRegistry.updateCapitalAllocation(POOL_ID, address(adapter), extra, true);

        _distribute();
        uint256 pledge = riskManager.underwriterPoolPledge(underwriter, POOL_ID);
        uint256 expected = rewardDistributor.pendingRewards(underwriter, POOL_ID, address(usdc), pledge);
        uint256 beforeBal = usdc.balanceOf(underwriter);
        vm.prank(underwriter);
        riskManager.claimPremiumRewards(ids);
        uint256 afterBal = usdc.balanceOf(underwriter);
        assertEq(afterBal - beforeBal, expected);
    }

    function testAccruesAfterWithdrawal() public {
        _distribute();
        uint256[] memory ids = new uint256[](1);
        ids[0] = POOL_ID;
        vm.prank(underwriter);
        riskManager.claimPremiumRewards(ids);

        uint256 withdrawAmount = 400e6;
        vm.prank(address(capitalPool));
        riskManager.onCapitalWithdrawn(underwriter, withdrawAmount, false);
        vm.prank(address(riskManager));
        poolRegistry.updateCapitalAllocation(POOL_ID, address(adapter), withdrawAmount, false);

        _distribute();
        uint256 pledge = riskManager.underwriterPoolPledge(underwriter, POOL_ID);
        uint256 expected = rewardDistributor.pendingRewards(underwriter, POOL_ID, address(usdc), pledge);
        uint256 beforeBal = usdc.balanceOf(underwriter);
        vm.prank(underwriter);
        riskManager.claimPremiumRewards(ids);
        uint256 afterBal = usdc.balanceOf(underwriter);
        assertEq(afterBal - beforeBal, expected);
    }

    function testCatPoolClaimsForUser() public {
        _distribute();
        uint256 pledge = riskManager.underwriterPoolPledge(underwriter, POOL_ID);
        uint256 expected = rewardDistributor.pendingRewards(underwriter, POOL_ID, address(usdc), pledge);
        vm.prank(address(catPool));
        rewardDistributor.claimForCatPool(underwriter, POOL_ID, address(usdc), pledge);
        assertEq(usdc.balanceOf(underwriter), expected);
    }

    function testDistributeOnlyRiskManager() public {
        vm.expectRevert("RD: Not RiskManager or policyManager");
        rewardDistributor.distribute(POOL_ID, address(usdc), 1, 1);
    }

    function testRewardsAccumulate() public {
        _distribute();
        _distribute();
        uint256 pledge = riskManager.underwriterPoolPledge(underwriter, POOL_ID);
        uint256 expected = rewardDistributor.pendingRewards(underwriter, POOL_ID, address(usdc), pledge);
        assertEq(expected, REWARD_AMOUNT * 2);
        uint256 beforeBal = usdc.balanceOf(underwriter);
        uint256[] memory ids = new uint256[](1);
        ids[0] = POOL_ID;
        vm.prank(underwriter);
        riskManager.claimPremiumRewards(ids);
        uint256 afterBal = usdc.balanceOf(underwriter);
        assertEq(afterBal - beforeBal, expected);
    }

    function testClaimForCatPoolRestricted() public {
        vm.expectRevert("RD: Not CatPool");
        rewardDistributor.claimForCatPool(underwriter, POOL_ID, address(usdc), PLEDGE_AMOUNT);
    }

    function testOwnerSetsNewCatPool() public {
        CatShare newShare = new CatShare();
        BackstopPool newCat = new BackstopPool(usdc, newShare, adapter, owner);
        newShare.transferOwnership(address(newCat));
        newCat.initialize();
        vm.expectEmit(true, true, true, false);
        emit RewardDistributor.CatPoolSet(address(newCat));
        rewardDistributor.setCatPool(address(newCat));

        _distribute();
        uint256 pledge = riskManager.underwriterPoolPledge(underwriter, POOL_ID);
        uint256 expected = rewardDistributor.pendingRewards(underwriter, POOL_ID, address(usdc), pledge);
        vm.prank(address(newCat));
        rewardDistributor.claimForCatPool(underwriter, POOL_ID, address(usdc), pledge);
        assertEq(usdc.balanceOf(underwriter), expected);
    }

    function testOwnerSetsNewRiskManager() public {
        RiskManager newRM = new RiskManager(owner);
        rewardDistributor.setRiskManager(address(newRM));

        vm.prank(address(riskManager));
        vm.expectRevert("RD: Not RiskManager or policyManager");
        rewardDistributor.distribute(POOL_ID, address(usdc), 1, 1);

        vm.prank(address(newRM));
        rewardDistributor.distribute(POOL_ID, address(usdc), 0, 0);
    }
}
