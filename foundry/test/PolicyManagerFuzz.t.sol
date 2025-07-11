// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {MockPoolRegistry} from "contracts/test/MockPoolRegistry.sol";
import {MockCapitalPool} from "contracts/test/MockCapitalPool.sol";
import {MockBackstopPool} from "contracts/test/MockBackstopPool.sol";
import {MockPolicyNFT} from "contracts/test/MockPolicyNFT.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";
import {MockRiskManagerHook} from "contracts/test/MockRiskManagerHook.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {IPolicyNFT} from "contracts/interfaces/IPolicyNFT.sol";

contract PolicyManagerFuzz is Test {
    PolicyManager pm;
    MockPoolRegistry registry;
    MockCapitalPool capital;
    MockBackstopPool cat;
    MockPolicyNFT nft;
    MockRewardDistributor rewards;
    MockRiskManagerHook rm;
    MockERC20 token;

    address user = address(0x1);
    uint256 constant POOL_ID = 0;

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        token.mint(user, 1_000_000e6);

        registry = new MockPoolRegistry();
        capital = new MockCapitalPool(address(this), address(token));
        cat = new MockBackstopPool(address(this));
        nft = new MockPolicyNFT(address(this));
        rewards = new MockRewardDistributor();
        rm = new MockRiskManagerHook();

        pm = new PolicyManager(address(nft), address(this));
        nft.setCoverPoolAddress(address(pm));
        pm.setAddresses(address(registry), address(capital), address(cat), address(rewards), address(rm));

        registry.setPoolData(POOL_ID, token, 100_000e6, 0, 0, false, address(this), 0);
        IPoolRegistry.RateModel memory rate = IPoolRegistry.RateModel({base: 100, slope1: 200, slope2: 500, kink: 8000});
        registry.setRateModel(POOL_ID, rate);

        vm.prank(user);
        token.approve(address(pm), type(uint256).max);
    }

    function _minPremium(uint256 coverage) internal view returns (uint256) {
        uint256 annualRate = 100; // from rate model
        return (coverage * annualRate * 7 days) / (pm.SECS_YEAR() * pm.BPS());
    }

    function testFuzz_adminSetters(uint16 bps, uint32 cooldown) public {
        vm.assume(bps <= 5000);

        MockBackstopPool newCat = new MockBackstopPool(address(this));

        pm.setCatPremiumShareBps(bps);
        pm.setCoverCooldownPeriod(cooldown);
        pm.setCatPool(address(newCat));
        pm.setAddresses(address(registry), address(capital), address(newCat), address(rewards), address(rm));

        assertEq(pm.catPremiumBps(), bps);
        assertEq(pm.coverCooldownPeriod(), cooldown);
        assertEq(address(pm.catPool()), address(newCat));
    }

    function testFuzz_purchaseCover(uint96 coverage, uint96 deposit) public {
        vm.assume(coverage > 100 && coverage < 100_000e6);
        uint256 minPremium = _minPremium(coverage);
        vm.assume(deposit >= (minPremium == 0 ? 1 : minPremium) && deposit < 1_000_000e6);

        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        assertEq(policyId, 1);
        assertEq(token.balanceOf(address(pm)), deposit);
        assertEq(nft.nextPolicyId(), 2);
    }

    function testFuzz_purchaseCover_depositTooLow(uint96 coverage, uint96 deposit) public {
        vm.assume(coverage > 100 && coverage < 100_000e6);
        uint256 minPremium = _minPremium(coverage);
        vm.assume(deposit > 0 && deposit < minPremium);

        vm.prank(user);
        vm.expectRevert(PolicyManager.DepositTooLow.selector);
        pm.purchaseCover(POOL_ID, coverage, deposit);
    }

    function testFuzz_increaseCover(uint96 coverage, uint96 deposit, uint96 addAmount) public {
        vm.assume(coverage > 100 && coverage < 50_000e6);
        vm.assume(addAmount > 0);
        uint256 totalCoverage = uint256(coverage) + uint256(addAmount);
        vm.assume(totalCoverage < 100_000e6);
        uint256 minPremium = _minPremium(totalCoverage);
        vm.assume(deposit >= (minPremium == 0 ? 1 : minPremium) && deposit < 1_000_000e6);

        vm.startPrank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);
        pm.increaseCover(policyId, addAmount);
        vm.stopPrank();

        assertEq(pm.pendingCoverageSum(policyId), addAmount);
    }

    function testFuzz_pendingAndActive(uint96 coverage, uint96 deposit, uint96 addAmount) public {
        vm.assume(coverage > 100 && coverage < 50_000e6);
        vm.assume(addAmount > 0);
        uint256 totalCoverage = uint256(coverage) + uint256(addAmount);
        vm.assume(totalCoverage < 100_000e6);
        uint256 minPremium = _minPremium(totalCoverage);
        vm.assume(deposit >= (minPremium == 0 ? 1 : minPremium) && deposit < 1_000_000e6);

        vm.startPrank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);
        pm.increaseCover(policyId, addAmount);
        vm.warp(block.timestamp + 1 days);
        PolicyManager.PendingIncreaseNode[] memory nodes = pm.getPendingIncreases(policyId);
        bool active = pm.isPolicyActive(policyId);
        vm.stopPrank();

        assertTrue(nodes.length > 0);
        assertTrue(active);
    }

    function testFuzz_lapsePolicy(uint96 coverage) public {
        vm.assume(coverage > 100 && coverage < 100_000e6);
        uint256 deposit = _minPremium(coverage);
        if (deposit == 0) deposit = 1;

        vm.startPrank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);
        vm.warp(block.timestamp + pm.SECS_YEAR());
        pm.lapsePolicy(policyId);
        vm.stopPrank();

        assertEq(nft.last_burn_id(), policyId);
    }

    function testFuzz_cancelCover(uint96 coverage, uint96 deposit) public {
        vm.assume(coverage > 100 && coverage < 100_000e6);
        uint256 minPremium = _minPremium(coverage);
        vm.assume(deposit >= (minPremium == 0 ? 1 : minPremium) && deposit < 1_000_000e6);

        vm.startPrank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);
        uint256 balBefore = token.balanceOf(user);
        pm.cancelCover(policyId);
        uint256 balAfter = token.balanceOf(user);
        vm.stopPrank();

        assertEq(balAfter, balBefore + deposit);
        assertEq(nft.last_burn_id(), policyId);
    }
}
