// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";

contract PoolRegistryFuzz is Test {
    PoolRegistry registry;
    MockERC20 token;
    address riskManager = address(0xBEEF);

    function setUp() public {
        token = new MockERC20("Mock", "MOCK", 18);
        registry = new PoolRegistry(address(this), riskManager);
    }

    function _createPool(IPoolRegistry.RateModel memory rm, uint256 claimFee) internal returns (uint256) {
        vm.prank(riskManager);
        return registry.addProtocolRiskPool(address(token), rm, claimFee);
    }

    function testFuzz_addProtocolRiskPool(uint256 base, uint256 slope1, uint256 slope2, uint256 kink, uint96 fee)
        public
    {
        IPoolRegistry.RateModel memory rm = IPoolRegistry.RateModel(base, slope1, slope2, kink);
        uint256 id = _createPool(rm, fee);
        (,,,,,, uint256 storedFee) = registry.getPoolData(id);
        IPoolRegistry.RateModel memory stored = registry.getPoolRateModel(id);
        assertEq(stored.base, rm.base);
        assertEq(stored.slope1, rm.slope1);
        assertEq(stored.slope2, rm.slope2);
        assertEq(stored.kink, rm.kink);
        assertEq(storedFee, fee);
    }

    function testFuzz_updateCapitalAllocation_allocate(address adapter, uint96 amount) public {
        vm.assume(adapter != address(0));
        IPoolRegistry.RateModel memory rm = IPoolRegistry.RateModel(1, 2, 3, 4);
        uint256 id = _createPool(rm, 0);
        vm.prank(riskManager);
        registry.updateCapitalAllocation(id, adapter, amount, true);
        (, uint256 total,,,,,) = registry.getPoolData(id);
        assertEq(total, amount);
        assertEq(registry.getCapitalPerAdapter(id, adapter), amount);
        address[] memory adapters = registry.getPoolActiveAdapters(id);
        assertEq(adapters.length, 1);
        assertEq(adapters[0], adapter);
    }

    function testFuzz_updateCapitalAllocation_deallocate(address adapter, uint96 amount, uint96 remove) public {
        vm.assume(adapter != address(0));
        vm.assume(remove <= amount);
        IPoolRegistry.RateModel memory rm = IPoolRegistry.RateModel(1, 2, 3, 4);
        uint256 id = _createPool(rm, 0);
        vm.startPrank(riskManager);
        registry.updateCapitalAllocation(id, adapter, amount, true);
        registry.updateCapitalAllocation(id, adapter, remove, false);
        vm.stopPrank();
        (, uint256 total,,,,,) = registry.getPoolData(id);
        uint256 expected = amount - remove;
        assertEq(total, expected);
        assertEq(registry.getCapitalPerAdapter(id, adapter), expected);
    }

    function testFuzz_updateCapitalPendingWithdrawal(uint96 initial, uint96 change) public {
        IPoolRegistry.RateModel memory rm = IPoolRegistry.RateModel(1, 2, 3, 4);
        uint256 id = _createPool(rm, 0);
        vm.prank(riskManager);
        registry.updateCapitalPendingWithdrawal(id, initial, true);
        vm.assume(change <= initial);
        vm.prank(riskManager);
        registry.updateCapitalPendingWithdrawal(id, change, false);
        (,,, uint256 pending,,,) = registry.getPoolData(id);
        assertEq(pending, initial - change);
    }

    function testFuzz_updateCoverageSold(uint96 initial, uint96 change) public {
        IPoolRegistry.RateModel memory rm = IPoolRegistry.RateModel(1, 2, 3, 4);
        uint256 id = _createPool(rm, 0);
        vm.prank(riskManager);
        registry.updateCoverageSold(id, initial, true);
        vm.assume(change <= initial);
        vm.prank(riskManager);
        registry.updateCoverageSold(id, change, false);
        (,, uint256 sold,,,,) = registry.getPoolData(id);
        assertEq(sold, initial - change);
    }

    function testFuzz_setPauseState(bool pause) public {
        IPoolRegistry.RateModel memory rm = IPoolRegistry.RateModel(1, 2, 3, 4);
        uint256 id = _createPool(rm, 0);
        vm.prank(riskManager);
        registry.setPauseState(id, pause);
        (,,,, bool stored,,) = registry.getPoolData(id);
        assertEq(stored, pause);
    }

    function testFuzz_setFeeRecipient(address recipient) public {
        IPoolRegistry.RateModel memory rm = IPoolRegistry.RateModel(1, 2, 3, 4);
        uint256 id = _createPool(rm, 0);
        vm.prank(riskManager);
        registry.setFeeRecipient(id, recipient);
        (,,,,, address stored,) = registry.getPoolData(id);
        assertEq(stored, recipient);
    }

    function testFuzz_setRiskManager(address newRM) public {
        vm.assume(newRM != address(0));
        registry.setRiskManager(newRM);
        assertEq(registry.riskManager(), newRM);
    }

    function testFuzz_getPoolCount(uint8 count) public {
        vm.assume(count > 0);
        for (uint8 i = 0; i < count; i++) {
            IPoolRegistry.RateModel memory rm =
                IPoolRegistry.RateModel(uint256(i) + 1, uint256(i) + 2, uint256(i) + 3, uint256(i) + 4);
            vm.prank(riskManager);
            registry.addProtocolRiskPool(address(token), rm, i);
        }
        assertEq(registry.getPoolCount(), uint256(count));
    }

    function testFuzz_removeAdapter(address adapter, uint96 amount) public {
        vm.assume(adapter != address(0));
        vm.assume(amount > 0);
        IPoolRegistry.RateModel memory rm = IPoolRegistry.RateModel(1, 2, 3, 4);
        uint256 id = _createPool(rm, 0);
        vm.startPrank(riskManager);
        registry.updateCapitalAllocation(id, adapter, amount, true);
        registry.updateCapitalAllocation(id, adapter, amount, false);
        vm.stopPrank();
        address[] memory adapters = registry.getPoolActiveAdapters(id);
        assertEq(adapters.length, 0);
    }

    function testFuzz_deallocateUnknownAdapter(address adapter) public {
        vm.assume(adapter != address(0));
        IPoolRegistry.RateModel memory rm = IPoolRegistry.RateModel(1, 2, 3, 4);
        uint256 id = _createPool(rm, 0);
        vm.prank(riskManager);
        registry.updateCapitalAllocation(id, adapter, 0, false);
        (, uint256 total,,,,,) = registry.getPoolData(id);
        assertEq(total, 0);
        assertEq(registry.getPoolActiveAdapters(id).length, 0);
    }

    function testFuzz_getPoolPayoutData(address adapter1, address adapter2, uint96 amount1, uint96 amount2) public {
        vm.assume(adapter1 != address(0));
        vm.assume(adapter2 != address(0) && adapter2 != adapter1);
        IPoolRegistry.RateModel memory rm = IPoolRegistry.RateModel(1, 2, 3, 4);
        uint256 id = _createPool(rm, 0);
        vm.startPrank(riskManager);
        registry.updateCapitalAllocation(id, adapter1, amount1, true);
        registry.updateCapitalAllocation(id, adapter2, amount2, true);
        vm.stopPrank();
        (address[] memory adapters, uint256[] memory amounts, uint256 total) = registry.getPoolPayoutData(id);
        assertEq(adapters.length, 2);
        assertEq(amounts.length, 2);
        if (adapters[0] == adapter1) {
            assertEq(amounts[0], amount1);
            assertEq(amounts[1], amount2);
        } else {
            assertEq(adapters[0], adapter2);
            assertEq(adapters[1], adapter1);
            assertEq(amounts[0], amount2);
            assertEq(amounts[1], amount1);
        }
        assertEq(total, uint256(amount1) + uint256(amount2));
    }

    function testRevert_onlyRiskManager(address caller) public {
        vm.assume(caller != riskManager);
        IPoolRegistry.RateModel memory rm = IPoolRegistry.RateModel(1, 1, 1, 1);
        vm.prank(caller);
        vm.expectRevert("PR: Not RiskManager");
        registry.addProtocolRiskPool(address(token), rm, 0);
    }

    function testRevert_setRiskManagerZero() public {
        vm.expectRevert("PR: Zero address");
        registry.setRiskManager(address(0));
    }
}
