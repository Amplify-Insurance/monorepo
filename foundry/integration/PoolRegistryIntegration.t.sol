// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PoolRegistryIntegration is Test {
    PoolRegistry registry;
    CatShare token;

    address owner = address(this);
    address riskManager = address(0xBEEF);
    address other = address(0xBAD);

    function setUp() public {
        token = new CatShare();
        registry = new PoolRegistry(owner, riskManager);
    }

    function _defaultRateModel() internal pure returns (IPoolRegistry.RateModel memory rm) {
        rm = IPoolRegistry.RateModel({base: 1e18, slope1: 2e18, slope2: 3e18, kink: 8e17});
    }

    function _createPool(uint256 fee) internal returns (uint256 id) {
        IPoolRegistry.RateModel memory rm = _defaultRateModel();
        vm.prank(riskManager);
        id = registry.addProtocolRiskPool(address(token), rm, fee);
    }

    function testRiskManagerCreatesPool() public {
        IPoolRegistry.RateModel memory rm = _defaultRateModel();
        vm.prank(riskManager);
        uint256 pid = registry.addProtocolRiskPool(address(token), rm, 500);
        assertEq(pid, 0);
        assertEq(registry.getPoolCount(), 1);

        (
            IERC20 returnedToken,
            uint256 totalCapital,
            uint256 totalSold,
            uint256 pending,
            bool paused,
            address feeRecipient,
            uint256 claimFee
        ) = registry.getPoolData(pid);

        assertEq(address(returnedToken), address(token));
        assertEq(totalCapital, 0);
        assertEq(totalSold, 0);
        assertEq(pending, 0);
        assertEq(paused, false);
        assertEq(feeRecipient, address(0));
        assertEq(claimFee, 500);

        IPoolRegistry.RateModel memory stored = registry.getPoolRateModel(pid);
        assertEq(stored.base, rm.base);
        assertEq(stored.slope1, rm.slope1);
        assertEq(stored.slope2, rm.slope2);
        assertEq(stored.kink, rm.kink);
    }

    function testCapitalAllocationAndDeallocation() public {
        uint256 id = _createPool(0);
        address adapter = address(0x1);
        uint256 amount = 100;

        vm.prank(riskManager);
        registry.updateCapitalAllocation(id, adapter, amount, true);

        (, uint256 totalCapital,, , , ,) = registry.getPoolData(id);
        assertEq(totalCapital, amount);
        assertEq(registry.getCapitalPerAdapter(id, adapter), amount);
        address[] memory adapters = registry.getPoolActiveAdapters(id);
        assertEq(adapters.length, 1);
        assertEq(adapters[0], adapter);

        vm.prank(riskManager);
        registry.updateCapitalAllocation(id, adapter, amount, false);

        (, totalCapital, , , , ,) = registry.getPoolData(id);
        assertEq(totalCapital, 0);
        assertEq(registry.getCapitalPerAdapter(id, adapter), 0);
        assertEq(registry.getPoolActiveAdapters(id).length, 0);
    }

    function testPauseAndUnpausePool() public {
        uint256 id = _createPool(0);
        vm.prank(riskManager);
        registry.setPauseState(id, true);
        (,,,, bool paused,,) = registry.getPoolData(id);
        assertTrue(paused);

        vm.prank(riskManager);
        registry.setPauseState(id, false);
        (,,,, paused,,) = registry.getPoolData(id);
        assertFalse(paused);
    }

    function testPendingWithdrawalAndCoverageSold() public {
        uint256 id = _createPool(0);
        uint256 amt = 50;
        vm.startPrank(riskManager);
        registry.updateCapitalPendingWithdrawal(id, amt, true);
        registry.updateCapitalPendingWithdrawal(id, amt, false);
        registry.updateCoverageSold(id, amt, true);
        registry.updateCoverageSold(id, amt, false);
        vm.stopPrank();

        (
            ,
            ,
            uint256 sold,
            uint256 pending,
            ,
            ,
        ) = registry.getPoolData(id);
        assertEq(pending, 0);
        assertEq(sold, 0);
    }

    function testRemoveAdapterFromMiddle() public {
        uint256 id = _createPool(0);
        address a = address(0xA);
        address b = address(0xB);
        address c = address(0xC);
        vm.startPrank(riskManager);
        registry.updateCapitalAllocation(id, a, 100, true);
        registry.updateCapitalAllocation(id, b, 200, true);
        registry.updateCapitalAllocation(id, c, 300, true);
        vm.stopPrank();

        address[] memory beforeAdapters = registry.getPoolActiveAdapters(id);
        assertEq(beforeAdapters.length, 3);
        assertEq(beforeAdapters[1], b);

        vm.prank(riskManager);
        registry.updateCapitalAllocation(id, b, 200, false);

        address[] memory afterAdapters = registry.getPoolActiveAdapters(id);
        assertEq(afterAdapters.length, 2);
        assertEq(afterAdapters[0], a);
        assertEq(afterAdapters[1], c);
    }

    function testGetPoolPayoutData() public {
        uint256 id = _createPool(0);
        address adapter1 = address(0x1);
        address adapter2 = address(0x2);
        vm.startPrank(riskManager);
        registry.updateCapitalAllocation(id, adapter1, 10, true);
        registry.updateCapitalAllocation(id, adapter2, 20, true);
        vm.stopPrank();

        (address[] memory adapters, uint256[] memory amounts, uint256 total) = registry.getPoolPayoutData(id);
        assertEq(adapters.length, 2);
        assertEq(amounts.length, 2);
        uint256 sum = amounts[0] + amounts[1];
        assertEq(total, sum);
        if (adapters[0] == adapter1) {
            assertEq(amounts[0], 10);
            assertEq(amounts[1], 20);
        } else {
            assertEq(adapters[0], adapter2);
            assertEq(adapters[1], adapter1);
            assertEq(amounts[0], 20);
            assertEq(amounts[1], 10);
        }
    }

    function testOnlyRiskManagerCanModify() public {
        uint256 id = _createPool(0);
        vm.prank(other);
        vm.expectRevert("PR: Not RiskManager");
        registry.updateCoverageSold(id, 1, true);
    }
}
