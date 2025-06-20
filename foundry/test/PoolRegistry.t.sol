// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";

contract PoolRegistryTest is Test {
    PoolRegistry registry;
    MockERC20 token;
    address riskManager = address(0xBEEF);

    IPoolRegistry.RateModel rateModel;

    function setUp() public {
        token = new MockERC20("Mock Token", "MTK", 18);
        registry = new PoolRegistry(address(this), riskManager);
        rateModel = IPoolRegistry.RateModel({
            base: 1e18,
            slope1: 2e18,
            slope2: 3e18,
            kink: 8e17
        });
    }

    function testAddProtocolRiskPool() public {
        vm.prank(riskManager);
        uint256 poolId = registry.addProtocolRiskPool(address(token), rateModel, 500);
        assertEq(poolId, 0);
        assertEq(registry.getPoolCount(), 1);

        (IERC20 protocolToken,uint256 totalCapital,uint256 totalCoverage,,bool paused,address feeRecipient,uint256 claimFee) = registry.getPoolData(poolId);
        assertEq(address(protocolToken), address(token));
        assertEq(totalCapital, 0);
        assertEq(totalCoverage, 0);
        assertTrue(!paused);
        assertEq(feeRecipient, address(0));
        assertEq(claimFee, 500);

        IPoolRegistry.RateModel memory rm = registry.getPoolRateModel(poolId);
        assertEq(rm.base, rateModel.base);
        assertEq(rm.slope1, rateModel.slope1);
        assertEq(rm.slope2, rateModel.slope2);
        assertEq(rm.kink, rateModel.kink);
    }

    function testUpdateCapitalAllocation() public {
        vm.prank(riskManager);
        uint256 poolId = registry.addProtocolRiskPool(address(token), rateModel, 0);

        address adapter = address(1);
        uint256 amount = 1000;

        vm.prank(riskManager);
        registry.updateCapitalAllocation(poolId, adapter, amount, true);

        (, uint256 totalCapital,, , , , ) = registry.getPoolData(poolId);
        assertEq(totalCapital, amount);
        assertEq(registry.getCapitalPerAdapter(poolId, adapter), amount);

        address[] memory adapters = registry.getPoolActiveAdapters(poolId);
        assertEq(adapters.length, 1);
        assertEq(adapters[0], adapter);

        vm.prank(riskManager);
        registry.updateCapitalAllocation(poolId, adapter, amount, false);

        (, totalCapital,, , , , ) = registry.getPoolData(poolId);
        assertEq(totalCapital, 0);
        assertEq(registry.getCapitalPerAdapter(poolId, adapter), 0);
        adapters = registry.getPoolActiveAdapters(poolId);
        assertEq(adapters.length, 0);
    }

    function testSetPauseState() public {
        vm.prank(riskManager);
        uint256 poolId = registry.addProtocolRiskPool(address(token), rateModel, 0);

        vm.prank(riskManager);
        registry.setPauseState(poolId, true);
        (, , , , bool paused,,) = registry.getPoolData(poolId);
        assertTrue(paused);

        vm.prank(riskManager);
        registry.setPauseState(poolId, false);
        (, , , , paused,,) = registry.getPoolData(poolId);
        assertFalse(paused);
    }
}

