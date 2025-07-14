// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";
import {USDCoin} from "contracts/tokens/USDCoin.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {IYieldAdapter} from "contracts/interfaces/IYieldAdapter.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";

contract PolicyManagerIntegration is Test {
    PolicyManager pm;
    RiskManager rm;
    PoolRegistry registry;
    CapitalPool capital;
    BackstopPool cat;
    PolicyNFT nft;
    RewardDistributor rewards;
    LossDistributor losses;
    USDCoin token;
    CatShare catShare;

    address user = address(0x1);
    uint256 constant POOL_ID = 0;

    function setUp() public {
        token = new USDCoin();
        token.mint(user, 1_000_000e6);

        nft = new PolicyNFT(address(this), address(this));
        pm = new PolicyManager(address(nft), address(this));
        nft.setPolicyManagerAddress(address(pm));

        rm = new RiskManager(address(this));
        registry = new PoolRegistry(address(this), address(rm));
        capital = new CapitalPool(address(this), address(token));

        catShare = new CatShare();
        cat = new BackstopPool(token, catShare, IYieldAdapter(address(0)), address(this));
        cat.setPolicyManagerAddress(address(pm));

        rewards = new RewardDistributor(address(rm), address(pm));
        losses = new LossDistributor(address(rm));

        pm.setAddresses(address(registry), address(capital), address(cat), address(rewards), address(rm));
        rm.setAddresses(address(capital), address(registry), address(pm), address(cat), address(losses), address(rewards));

        IPoolRegistry.RateModel memory rate = IPoolRegistry.RateModel({base: 100, slope1: 200, slope2: 500, kink: 8000});
        vm.prank(address(rm));
        registry.addProtocolRiskPool(address(token), rate, 0);
        vm.prank(address(rm));
        registry.updateCapitalAllocation(POOL_ID, address(this), 100_000e6, true);

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
}

