// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {ResetApproveERC20} from "contracts/test/ResetApproveERC20.sol";
import {SimpleYieldAdapter} from "contracts/adapters/SimpleYieldAdapter.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {UnderwriterManager} from "contracts/core/UnderwriterManager.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {IYieldAdapter} from "contracts/interfaces/IYieldAdapter.sol";

contract CapitalPoolIntegration is Test {
    ResetApproveERC20 token;
    SimpleYieldAdapter adapter;
    CapitalPool capitalPool;
    RiskManager riskManager;
    UnderwriterManager um;
    PoolRegistry registry;
    PolicyManager policyManager;
    PolicyNFT policyNFT;
    BackstopPool catPool;
    RewardDistributor rewardDistributor;
    LossDistributor lossDistributor;
    CatShare catShare;

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

        riskManager = new RiskManager(owner);

        registry = new PoolRegistry(owner, address(riskManager));
        policyNFT = new PolicyNFT(address(riskManager), owner);
        policyManager = new PolicyManager(address(policyNFT), owner);
        policyNFT.setPolicyManagerAddress(address(policyManager));

        catShare = new CatShare();
        catPool = new BackstopPool(token, catShare, IYieldAdapter(address(0)), owner);
        catShare.transferOwnership(address(catPool));
        catPool.initialize();

        rewardDistributor = new RewardDistributor(address(riskManager), address(policyManager));
        rewardDistributor.setCatPool(address(catPool));
        lossDistributor = new LossDistributor(address(riskManager));

        um = new UnderwriterManager(owner);
        um.setAddresses(address(capitalPool), address(registry), address(catPool), address(lossDistributor), address(rewardDistributor), address(riskManager));

        riskManager.setAddresses(
            address(capitalPool),
            address(registry),
            address(policyManager),
            address(catPool),
            address(lossDistributor),
            address(rewardDistributor),
            address(um)
        );
        capitalPool.setRiskManager(address(riskManager));
    }

    function testDepositUpdatesPledge() public {
        vm.prank(user);
        token.approve(address(capitalPool), type(uint256).max);
        vm.prank(user);
        capitalPool.deposit(500e6, CapitalPool.YieldPlatform(PLATFORM_OTHER));
        assertEq(um.underwriterTotalPledge(user), 500e6);
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
        assertEq(um.underwriterTotalPledge(user), 0);
    }
}
