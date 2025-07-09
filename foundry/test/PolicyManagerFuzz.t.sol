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

    function testFuzz_purchaseCover(uint96 coverage, uint96 deposit) public {
        vm.assume(coverage > 0 && coverage < 100_000e6);
        uint256 minPremium = _minPremium(coverage);
        vm.assume(deposit >= minPremium && deposit < 1_000_000e6);

        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        assertEq(policyId, 1);
        assertEq(token.balanceOf(address(pm)), deposit);
        assertEq(nft.nextPolicyId(), 2);
    }

    function testFuzz_purchaseCover_depositTooLow(uint96 coverage, uint96 deposit) public {
        vm.assume(coverage > 0 && coverage < 100_000e6);
        uint256 minPremium = _minPremium(coverage);
        vm.assume(deposit > 0 && deposit < minPremium);

        vm.prank(user);
        vm.expectRevert(PolicyManager.DepositTooLow.selector);
        pm.purchaseCover(POOL_ID, coverage, deposit);
    }

    function testFuzz_addPremium(uint96 coverage, uint96 deposit, uint96 addAmount) public {
        vm.assume(coverage > 0 && coverage < 100_000e6);
        uint256 minPremium = _minPremium(coverage);
        vm.assume(deposit >= minPremium && deposit < 1_000_000e6);
        vm.assume(addAmount > 0 && uint256(addAmount) + uint256(deposit) < 1_000_000e6);

        vm.startPrank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);
        pm.addPremium(policyId, addAmount);
        vm.stopPrank();

        IPolicyNFT.Policy memory pol = nft.getPolicy(policyId);
        assertEq(pol.premiumDeposit, deposit + addAmount);
        assertEq(token.balanceOf(address(pm)), deposit + addAmount);
    }

    function testFuzz_cancelCover(uint96 coverage, uint96 deposit) public {
        vm.assume(coverage > 0 && coverage < 100_000e6);
        uint256 minPremium = _minPremium(coverage);
        vm.assume(deposit >= minPremium && deposit < 1_000_000e6);

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

