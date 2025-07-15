// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {ResetApproveERC20} from "contracts/test/ResetApproveERC20.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {UnderwriterManager} from "contracts/core/UnderwriterManager.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {SimpleYieldAdapter} from "contracts/adapters/SimpleYieldAdapter.sol";
import {IYieldAdapter} from "contracts/interfaces/IYieldAdapter.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICapitalPool, YieldPlatform} from "contracts/interfaces/ICapitalPool.sol"; // CORRECTED: Import the interface and the enum

// Helper adapter that always reverts on withdraw
contract RevertingAdapter is IYieldAdapter {
    ResetApproveERC20 public immutable token;
    constructor(ResetApproveERC20 _token) { token = _token; }
    function asset() external view returns (IERC20) { return IERC20(address(token)); }
    function deposit(uint256) external {}
    function withdraw(uint256, address) external pure returns (uint256) { revert("revert"); }
    function getCurrentValueHeld() external pure returns (uint256) { return 0; }
}

contract BackstopPoolIntegration is Test {

    ResetApproveERC20 usdc;
    CatShare share;
    BackstopPool catPool;
    CapitalPool capitalPool;
    RiskManager rm;
    UnderwriterManager um;

    // components for policy manager test
    PolicyManager pm;
    RewardDistributor rewardDist;
    PoolRegistry registry;
    LossDistributor lossDist;
    PolicyNFT nft;

    address owner = address(this);
    address user = address(0x1);

    function setUp() public {
        usdc = new ResetApproveERC20("USD", "USD", 6);
        share = new CatShare();
    }

    function _deployBackstopWithCapital() internal {
        RevertingAdapter badAdapter = new RevertingAdapter(usdc);
        catPool = new BackstopPool(usdc, share, IYieldAdapter(address(badAdapter)), owner);
        share.transferOwnership(address(catPool));
        catPool.initialize();
        capitalPool = new CapitalPool(owner, address(usdc));
        rm = new RiskManager(owner);
        registry = new PoolRegistry(owner, address(rm));
        um = new UnderwriterManager(owner);
        nft = new PolicyNFT(address(this), owner);
        pm = new PolicyManager(address(nft), owner);
        nft.setPolicyManagerAddress(address(pm));
        rewardDist = new RewardDistributor(address(rm), address(pm));
        lossDist = new LossDistributor(address(rm));
        pm.setAddresses(address(registry), address(capitalPool), address(catPool), address(rewardDist), address(rm));
        um.setAddresses(address(capitalPool), address(registry), address(catPool), address(lossDist), address(rewardDist), address(rm));
        rm.setAddresses(address(capitalPool), address(registry), address(pm), address(catPool), address(lossDist), address(rewardDist), address(um));
        capitalPool.setRiskManager(address(rm));
        catPool.setRiskManagerAddress(address(capitalPool));
        catPool.setCapitalPoolAddress(address(capitalPool));
        catPool.setPolicyManagerAddress(address(pm));
        usdc.mint(owner, 2_000e6);
        usdc.approve(address(catPool), type(uint256).max);
        catPool.depositLiquidity(1_000e6);

        // fund capital pool so system value is positive
        SimpleYieldAdapter cpAdapter = new SimpleYieldAdapter(address(usdc), address(0xdead), owner);
        // CORRECTED: Use the imported enum directly
        capitalPool.setBaseYieldAdapter(YieldPlatform.OTHER_YIELD, address(cpAdapter));
        cpAdapter.setDepositor(address(capitalPool));
        usdc.approve(address(capitalPool), type(uint256).max);
        capitalPool.deposit(1_000e6, YieldPlatform.OTHER_YIELD);
    }

    function test_drawFund_called_when_adapter_reverts() public {
        _deployBackstopWithCapital();
        // prepare payout data
        ICapitalPool.PayoutData memory data;
        data.claimant = user;
        data.claimantAmount = 500e6;
        data.feeRecipient = address(0);
        data.feeAmount = 0;
        data.adapters = new address[](1);
        data.adapters[0] = address(catPool.adapter());
        data.capitalPerAdapter = new uint256[](1);
        data.capitalPerAdapter[0] = 500e6;
        data.totalCapitalFromPoolLPs = 500e6;

        vm.prank(address(rm));
        capitalPool.executePayout(data);

        assertEq(usdc.balanceOf(user), 500e6);
        assertEq(catPool.idleUSDC(), 500e6);
    }

    function _setupPolicyEnv() internal {
        // catPool with simple adapter (unused here)
        SimpleYieldAdapter adapter = new SimpleYieldAdapter(address(usdc), address(0xdead), owner);
        catPool = new BackstopPool(usdc, share, adapter, owner);
        share.transferOwnership(address(catPool));
        catPool.initialize();

        capitalPool = new CapitalPool(owner, address(usdc));
        rm = new RiskManager(owner);
        registry = new PoolRegistry(owner, address(rm));
        um = new UnderwriterManager(owner);
        nft = new PolicyNFT(address(this), owner);
        pm = new PolicyManager(address(nft), owner);
        nft.setPolicyManagerAddress(address(pm));
        rewardDist = new RewardDistributor(address(rm), address(pm));
        lossDist = new LossDistributor(address(rm));
        pm.setAddresses(address(registry), address(capitalPool), address(catPool), address(rewardDist), address(rm));
        um.setAddresses(address(capitalPool), address(registry), address(catPool), address(lossDist), address(rewardDist), address(rm));
        rm.setAddresses(address(capitalPool), address(registry), address(pm), address(catPool), address(lossDist), address(rewardDist), address(um));
        capitalPool.setRiskManager(address(rm));
        catPool.setPolicyManagerAddress(address(pm));
        catPool.setRiskManagerAddress(address(capitalPool));
        catPool.setCapitalPoolAddress(address(capitalPool));
        catPool.setRewardDistributor(address(rewardDist));

        IPoolRegistry.RateModel memory model = IPoolRegistry.RateModel({base: 1000, slope1: 0, slope2: 0, kink: 10000});
        vm.prank(address(rm));
        uint256 poolId = registry.addProtocolRiskPool(address(usdc), model, 0);
        vm.prank(address(rm));
        registry.updateCapitalAllocation(poolId, address(adapter), 1_000_000e6, true);
}

    function test_receive_premium_via_policy_manager() public {
        _setupPolicyEnv();
        // user purchases cover
        usdc.mint(user, 1_000e6);
        vm.startPrank(user);
        usdc.approve(address(pm), type(uint256).max);
        uint256 policyId = pm.purchaseCover(0, 1_000e6, 1_000e6);
        vm.stopPrank();

        // advance time so premium accrues
        vm.warp(block.timestamp + 30 days);

        uint256 catBefore = catPool.idleUSDC();
        vm.prank(user);
        pm.cancelCover(policyId);
        uint256 catAfter = catPool.idleUSDC();

        uint256 elapsed = 30 days;
        uint256 rateBps = 1000; // from rate model base
        uint256 coverage = 1_000e6;
        uint256 cost = (coverage * rateBps * elapsed) / (365 days * pm.BPS());
        uint256 expected = (cost * pm.catPremiumBps()) / pm.BPS();
        assertEq(catAfter - catBefore, expected);
    }
}
