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

    function test_removeAdapter_swapAndPop() public {
    // --- Setup ---
    IPoolRegistry.RateModel memory rm = IPoolRegistry.RateModel(1, 2, 3, 4);
    uint256 id = _createPool(rm, 0);
    address adapterA = address(0xA);
    address adapterB = address(0xB);
    address adapterC = address(0xC);

    // 1. Add three adapters: A, B, C
    vm.startPrank(riskManager);
    registry.updateCapitalAllocation(id, adapterA, 100, true);
    registry.updateCapitalAllocation(id, adapterB, 200, true);
    registry.updateCapitalAllocation(id, adapterC, 300, true);
    vm.stopPrank();

    address[] memory adaptersBefore = registry.getPoolActiveAdapters(id);
    assertEq(adaptersBefore.length, 3);
    assertEq(adaptersBefore[1], adapterB);

    // --- Action ---
    // 2. Remove the MIDDLE adapter (B)
    vm.prank(riskManager);
    registry.updateCapitalAllocation(id, adapterB, 200, false);
    vm.stopPrank();

    // --- Assertions ---
    // 3. The array should now have 2 adapters
    address[] memory adaptersAfter = registry.getPoolActiveAdapters(id);
    assertEq(adaptersAfter.length, 2);

    // 4. The first adapter (A) should be untouched
    assertEq(adaptersAfter[0], adapterA);

    // 5. The last adapter (C) should have been swapped into the middle slot (B's old spot)
    assertEq(adaptersAfter[1], adapterC);
}


function test_getMultiplePoolData() public {
    // --- Setup ---
    // 1. Create two different pools
    IPoolRegistry.RateModel memory rm1 = IPoolRegistry.RateModel(1, 2, 3, 4);
    uint256 id1 = _createPool(rm1, 100);
    vm.prank(riskManager);
    registry.updateCapitalAllocation(id1, address(0x1), 1000, true);

    IPoolRegistry.RateModel memory rm2 = IPoolRegistry.RateModel(5, 6, 7, 8);
    uint256 id2 = _createPool(rm2, 200);
    vm.prank(riskManager);
    registry.updateCapitalAllocation(id2, address(0x2), 2000, true);

    // --- Action ---
    // 2. Fetch data for both pools in a single call
    uint256[] memory poolIds = new uint256[](2);
    poolIds[0] = id1;
    poolIds[1] = id2;
    IPoolRegistry.PoolInfo[] memory poolData = registry.getMultiplePoolData(poolIds);

    // --- Assertions ---
    // 3. Verify the data for both pools
    assertEq(poolData.length, 2);
    // Pool 1 Data
    assertEq(address(poolData[0].protocolTokenToCover), address(token));
    assertEq(poolData[0].totalCapitalPledgedToPool, 1000);
    assertEq(poolData[0].claimFeeBps, 100);
    // Pool 2 Data
    assertEq(address(poolData[1].protocolTokenToCover), address(token));
    assertEq(poolData[1].totalCapitalPledgedToPool, 2000);
    assertEq(poolData[1].claimFeeBps, 200);
}


function testRevert_onInvalidPoolId() public {
    // --- Setup ---
    // Create one pool, so the only valid ID is 0.
    _createPool(IPoolRegistry.RateModel(1, 2, 3, 4), 0);
    uint256 invalidPoolId = 1;

    // --- Action & Assertion ---
    vm.prank(riskManager);
    // This will revert inside the call to getPoolData, which is fine for this test.
    // A more specific error could be added to the functions themselves.
    vm.expectRevert();
    registry.updateCapitalAllocation(invalidPoolId, address(1), 100, true);
}


function testRevert_setRiskManager_onlyOwner() public {
    address notOwner = address(0xBAD);
    vm.prank(notOwner);
    vm.expectRevert("Ownable: caller is not the owner");
    registry.setRiskManager(address(0x123));
}
}
