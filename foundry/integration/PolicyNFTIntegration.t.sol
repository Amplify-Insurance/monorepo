// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {UnderwriterManager} from "contracts/core/UnderwriterManager.sol";
import {USDCoin} from "contracts/tokens/USDCoin.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {IYieldAdapter} from "contracts/interfaces/IYieldAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PolicyNFTIntegration is Test {
    PolicyManager pm;
    PolicyNFT nft;
    PoolRegistry registry;
    CapitalPool capital;
    BackstopPool cat;
    RewardDistributor rewards;
    LossDistributor lossDist;
    RiskManager rm;
    UnderwriterManager um;
    USDCoin token;
    CatShare catShare;

    address user = address(0x1);
    uint256 constant POOL_ID = 0;

    function setUp() public {
        token = new USDCoin();
        token.mint(user, 1_000_000e6);

        nft = new PolicyNFT(address(this), address(this));
        pm = new PolicyManager(address(nft), address(this));

        rm = new RiskManager(address(this));
        registry = new PoolRegistry(address(this), address(rm));
        capital = new CapitalPool(address(this), address(token));
        um = new UnderwriterManager(address(this));

        catShare = new CatShare();
        cat = new BackstopPool(IERC20(address(token)), catShare, IYieldAdapter(address(0)), address(this));
        catShare.transferOwnership(address(cat));
        cat.initialize();

        lossDist = new LossDistributor(address(rm));
        rewards = new RewardDistributor(address(rm), address(pm));
        rewards.setCatPool(address(cat));

        nft.setPolicyManagerAddress(address(pm));
        capital.setRiskManager(address(rm));
        cat.setRiskManagerAddress(address(rm));
        cat.setCapitalPoolAddress(address(capital));
        cat.setPolicyManagerAddress(address(pm));
        cat.setRewardDistributor(address(rewards));

        um.setAddresses(address(capital), address(registry), address(cat), address(lossDist), address(rewards), address(rm));
        rm.setAddresses(address(capital), address(registry), address(pm), address(cat), address(lossDist), address(rewards), address(um));
        pm.setAddresses(address(registry), address(capital), address(cat), address(rewards), address(rm));

        IPoolRegistry.RateModel memory rate = IPoolRegistry.RateModel({base: 100, slope1: 0, slope2: 0, kink: 8000});
        vm.prank(address(rm));
        registry.addProtocolRiskPool(address(token), rate, 0);
        vm.prank(address(rm));
        registry.updateCapitalAllocation(POOL_ID, address(this), 100_000e6, true);

        vm.prank(user);
        token.approve(address(pm), type(uint256).max);
    }

    function _minPremium(uint256 coverage) internal view returns (uint256) {
        uint256 annualRate = 100;
        return (coverage * annualRate * 7 days) / (pm.SECS_YEAR() * pm.BPS());
    }

    function testPurchaseCoverMintsPolicy() public {
        uint256 coverage = 500e6;
        uint256 premium = _minPremium(coverage);
        if (premium == 0) premium = 1;

        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, coverage, premium);

        assertEq(id, 1);
        assertEq(nft.ownerOf(id), user);

        PolicyNFT.Policy memory pol = nft.getPolicy(id);
        assertEq(pol.coverage, coverage);
        assertEq(pol.poolId, POOL_ID);
        assertEq(pol.premiumDeposit, premium);
    }

    function testCancelCoverBurnsPolicy() public {
        uint256 coverage = 500e6;
        uint256 premium = _minPremium(coverage);
        if (premium == 0) premium = 1;

        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, coverage, premium);

        vm.warp(block.timestamp + 1);
        vm.prank(user);
        pm.cancelCover(id);

        vm.expectRevert(abi.encodeWithSignature("ERC721NonexistentToken(uint256)", id));
        nft.ownerOf(id);

        PolicyNFT.Policy memory pol = nft.getPolicy(id);
        assertEq(pol.coverage, 0);
    }

    function testLapsePolicyBurnsAfterPremiumExhausted() public {
        uint256 coverage = 500e6;
        uint256 premium = _minPremium(coverage);
        if (premium == 0) premium = 1;

        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, coverage, premium);

        vm.warp(block.timestamp + pm.SECS_YEAR() * 2);
        vm.prank(user);
        pm.lapsePolicy(id);

        vm.expectRevert(abi.encodeWithSignature("ERC721NonexistentToken(uint256)", id));
        nft.ownerOf(id);
    }

    function testCannotCancelBeforeActivation() public {
        pm.setCoverCooldownPeriod(7 days);

        uint256 coverage = 500e6;
        uint256 premium = _minPremium(coverage);
        if (premium == 0) premium = 1;

        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, coverage, premium);

        vm.prank(user);
        vm.expectRevert(PolicyManager.CooldownActive.selector);
        pm.cancelCover(id);
    }

    function testFinalizeIncreaseOnCancel() public {
        pm.setCoverCooldownPeriod(1 days);

        uint256 coverage = 500e6;
        uint256 add = 200e6;
        uint256 premium = _minPremium(coverage + add);
        if (premium == 0) premium = 1;

        vm.prank(user);
        uint256 id = pm.purchaseCover(POOL_ID, coverage, premium);
        vm.prank(user);
        pm.increaseCover(id, add);

        vm.warp(block.timestamp + 1 days + 1);

        vm.expectEmit(true, false, false, true, address(nft));
        emit PolicyNFT.PolicyCoverageIncreased(id, coverage + add);

        vm.prank(user);
        pm.cancelCover(id);
    }
}
