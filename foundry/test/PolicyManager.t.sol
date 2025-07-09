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

contract PolicyManagerTest is Test {
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
    uint256 constant COVERAGE = 10_000e6;
    uint256 constant DEPOSIT = 100e6;

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

    function test_purchaseCover_success() public {
        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, COVERAGE, DEPOSIT);

        assertEq(policyId, 1);
        assertEq(token.balanceOf(address(pm)), DEPOSIT);
        assertEq(nft.nextPolicyId(), 2);
    }

    function test_purchaseCover_revertsIfAddressesNotSet() public {
        PolicyManager pm2 = new PolicyManager(address(nft), address(this));
        vm.prank(user);
        vm.expectRevert(PolicyManager.AddressesNotSet.selector);
        pm2.purchaseCover(POOL_ID, COVERAGE, DEPOSIT);
    }
}
