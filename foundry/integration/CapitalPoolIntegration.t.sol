// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ResetApproveERC20} from "contracts/test/ResetApproveERC20.sol";
import {SimpleYieldAdapter} from "contracts/adapters/SimpleYieldAdapter.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {MockPoolRegistry} from "contracts/test/MockPoolRegistry.sol";
import {MockPolicyManager} from "contracts/test/MockPolicyManager.sol";
import {MockPolicyNFT} from "contracts/test/MockPolicyNFT.sol";
import {MockBackstopPool} from "contracts/test/MockBackstopPool.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";
import {MockLossDistributor} from "contracts/test/MockLossDistributor.sol";

contract CapitalPoolIntegration is Test {
    ResetApproveERC20 token;
    SimpleYieldAdapter adapter;
    CapitalPool capitalPool;
    RiskManager riskManager;
    MockPoolRegistry registry;
    MockPolicyManager policyManager;
    MockPolicyNFT policyNFT;
    MockBackstopPool catPool;
    MockRewardDistributor rewardDistributor;
    MockLossDistributor lossDistributor;

    address owner = address(this);
    address user = address(0x1);

    uint8 constant PLATFORM_OTHER = 3; // CapitalPool.YieldPlatform.OTHER_YIELD

    function setUp() public {
        token = new ResetApproveERC20("USD", "USD", 6);
        token.mint(owner, 1_000_000e6);
        token.mint(user, 1_000e6);

        adapter = new SimpleYieldAdapter(address(token), address(0xdead), owner);

        capitalPool = new CapitalPool(owner, address(token));
        capitalPool.setBaseYieldAdapter(CapitalPool.YieldPlatform(PLATFORM_OTHER), address(adapter));
        adapter.setDepositor(address(capitalPool));

        registry = new MockPoolRegistry();
        policyManager = new MockPolicyManager();
        policyNFT = new MockPolicyNFT(owner);
        policyManager.setPolicyNFT(address(policyNFT));
        catPool = new MockBackstopPool(owner);
        rewardDistributor = new MockRewardDistributor();
        lossDistributor = new MockLossDistributor();

        riskManager = new RiskManager(owner);
        riskManager.setAddresses(
            address(capitalPool),
            address(registry),
            address(policyManager),
            address(catPool),
            address(lossDistributor),
            address(rewardDistributor)
        );
        capitalPool.setRiskManager(address(riskManager));
    }

    function testDepositUpdatesPledge() public {
        vm.prank(user);
        token.approve(address(capitalPool), type(uint256).max);
        vm.prank(user);
        capitalPool.deposit(500e6, CapitalPool.YieldPlatform(PLATFORM_OTHER));
        assertEq(riskManager.underwriterTotalPledge(user), 500e6);
    }

    function testFullWithdrawalResetsPledge() public {
        vm.startPrank(user);
        token.approve(address(capitalPool), type(uint256).max);
        capitalPool.deposit(200e6, CapitalPool.YieldPlatform(PLATFORM_OTHER));
        (,, uint256 shares,) = capitalPool.getUnderwriterAccount(user);
        capitalPool.requestWithdrawal(shares);
        vm.warp(block.timestamp + 1);
        capitalPool.executeWithdrawal(0);
        vm.stopPrank();
        assertEq(riskManager.underwriterTotalPledge(user), 0);
    }
}
