// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PoolRegistryIntegrationTest is Test {
    PoolRegistry registry;
    CatShare token;

    address owner = address(this);
    address riskManager = address(0xBEEF);
    address other = address(0xBAD);

    IPoolRegistry.RateModel rateModel;

    function setUp() public {
        token = new CatShare();
        registry = new PoolRegistry(owner, riskManager);
        rateModel = IPoolRegistry.RateModel({base: 1e18, slope1: 2e18, slope2: 3e18, kink: 8e17});
    }

    function _createPool() internal returns (uint256) {
        vm.prank(riskManager);
        return registry.addProtocolRiskPool(address(token), rateModel, 500);
    }

    function test_createPoolStoresData() public {
        uint256 id = _createPool();
        assertEq(id, 0);
        assertEq(registry.getPoolCount(), 1);
        (
            IERC20 protocolTokenToCover,
            uint256 totalCapital,
            uint256 totalSold,
            uint256 pending,
            bool paused,
            address feeRecipient,
            uint256 fee
        ) = registry.getPoolData(id);
        assertEq(address(protocolTokenToCover), address(token));
        assertEq(totalCapital, 0);
        assertEq(totalSold, 0);
        assertFalse(paused);
        assertEq(feeRecipient, address(0));
        assertEq(fee, 500);
        IPoolRegistry.RateModel memory rm = registry.getPoolRateModel(id);
        assertEq(rm.base, rateModel.base);
        assertEq(rm.slope1, rateModel.slope1);
        assertEq(rm.slope2, rateModel.slope2);
        assertEq(rm.kink, rateModel.kink);
    }

    function test_capitalAllocationAndDeallocation() public {
        _createPool();
        address adapter = address(0xA);
        uint256 amount = 1000e18;
        vm.prank(riskManager);
        registry.updateCapitalAllocation(0, adapter, amount, true);
        (, uint256 pledged,,,,,) = registry.getPoolData(0);
        assertEq(pledged, amount);
        assertEq(registry.getCapitalPerAdapter(0, adapter), amount);
        address[] memory adapters = registry.getPoolActiveAdapters(0);
        assertEq(adapters.length, 1);
        assertEq(adapters[0], adapter);

        vm.prank(riskManager);
        registry.updateCapitalAllocation(0, adapter, amount, false);
        (, pledged,,,,,) = registry.getPoolData(0);
        assertEq(pledged, 0);
        assertEq(registry.getCapitalPerAdapter(0, adapter), 0);
        adapters = registry.getPoolActiveAdapters(0);
        assertEq(adapters.length, 0);
    }

    function test_pauseAndUnpausePool() public {
        _createPool();
        vm.prank(riskManager);
        registry.setPauseState(0, true);
        (,,,, bool paused,,) = registry.getPoolData(0);
        assertTrue(paused);
        (,,,,,, bool pausedStruct, uint256 ts,) = registry.protocolRiskPools(0);
        assertTrue(pausedStruct);
        assertGt(ts, 0);
        vm.prank(riskManager);
        registry.setPauseState(0, false);
        (,,,, paused,,) = registry.getPoolData(0);
        assertFalse(paused);
        (,,,,,, pausedStruct, ts,) = registry.protocolRiskPools(0);
        assertFalse(pausedStruct);
        assertEq(ts, 0);
    }

    function test_updatePendingWithdrawalAndCoverageSold() public {
        _createPool();
        uint256 amt = 500e18;
        vm.prank(riskManager);
        registry.updateCapitalPendingWithdrawal(0, amt, true);
        (,,, uint256 pending,,,) = registry.getPoolData(0);
        assertEq(pending, amt);
        vm.prank(riskManager);
        registry.updateCapitalPendingWithdrawal(0, amt, false);
        (,,, pending,,,) = registry.getPoolData(0);
        assertEq(pending, 0);
        vm.prank(riskManager);
        registry.updateCoverageSold(0, amt, true);
        (,, uint256 sold,,,,) = registry.getPoolData(0);
        assertEq(sold, amt);
        vm.prank(riskManager);
        registry.updateCoverageSold(0, amt, false);
        (,, sold,,,,) = registry.getPoolData(0);
        assertEq(sold, 0);
    }

    function test_feeRecipientIsolation() public {
        _createPool();
        vm.prank(riskManager);
        registry.addProtocolRiskPool(address(token), rateModel, 0);
        address recipient = address(0x123);
        vm.prank(riskManager);
        registry.setFeeRecipient(0, recipient);
        (,,,,, address stored0,) = registry.getPoolData(0);
        assertEq(stored0, recipient);
        (,,,,, address stored1,) = registry.getPoolData(1);
        assertEq(stored1, address(0));
        uint256 amount = 100e18;
        address adapter0 = address(0xAA);
        address adapter1 = address(0xBB);
        vm.prank(riskManager);
        registry.updateCapitalAllocation(0, adapter0, amount, true);
        vm.prank(riskManager);
        registry.updateCapitalAllocation(1, adapter1, amount, true);
        (, uint256 pledged0,,,,,) = registry.getPoolData(0);
        (, uint256 pledged1,,,,,) = registry.getPoolData(1);
        assertEq(pledged0, amount);
        assertEq(pledged1, amount);
    }

    function test_resetFeeRecipient() public {
        _createPool();
        address recipient = address(0x123);
        vm.prank(riskManager);
        registry.setFeeRecipient(0, recipient);
        (,,,,, address stored,) = registry.getPoolData(0);
        assertEq(stored, recipient);
        vm.prank(riskManager);
        registry.setFeeRecipient(0, address(0));
        (,,,,, stored,) = registry.getPoolData(0);
        assertEq(stored, address(0));
    }

    function test_changeRiskManager() public {
        _createPool();
        address newRM = address(0x111);
        vm.prank(owner);
        registry.setRiskManager(newRM);
        vm.prank(newRM);
        registry.updateCoverageSold(0, 1, true);
        vm.prank(riskManager);
        vm.expectRevert("PR: Not RiskManager");
        registry.updateCoverageSold(0, 1, true);
    }

    function test_preventNonOwnerChangeRiskManager() public {
        _createPool();
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", other));
        registry.setRiskManager(other);
        vm.prank(riskManager);
        registry.updateCoverageSold(0, 1, true);
    }

    function test_payoutDataForAdapters() public {
        _createPool();
        address adapterA = address(0xA1);
        address adapterB = address(0xB2);
        uint256 amountA = 50e18;
        uint256 amountB = 75e18;
        vm.prank(riskManager);
        registry.updateCapitalAllocation(0, adapterA, amountA, true);
        vm.prank(riskManager);
        registry.updateCapitalAllocation(0, adapterB, amountB, true);
        (address[] memory adapters, uint256[] memory amounts, uint256 total) = registry.getPoolPayoutData(0);
        assertEq(adapters.length, 2);
        bool aFirst = adapters[0] == adapterA;
        if (aFirst) {
            assertEq(amounts[0], amountA);
            assertEq(amounts[1], amountB);
        } else {
            assertEq(adapters[1], adapterA);
            assertEq(amounts[1], amountA);
            assertEq(amounts[0], amountB);
        }
        assertEq(total, amountA + amountB);
    }

    function test_emptyPayoutData() public {
        _createPool();
        (address[] memory adapters, uint256[] memory amounts, uint256 total) = registry.getPoolPayoutData(0);
        assertEq(adapters.length, 0);
        assertEq(amounts.length, 0);
        assertEq(total, 0);
    }

    function test_payoutDataReflectsRemoval() public {
        _createPool();
        address adapter = address(0xA1);
        uint256 amount = 100e18;
        vm.prank(riskManager);
        registry.updateCapitalAllocation(0, adapter, amount, true);
        vm.prank(riskManager);
        registry.updateCapitalAllocation(0, adapter, amount, false);
        (address[] memory adapters, uint256[] memory amounts, uint256 total) = registry.getPoolPayoutData(0);
        assertEq(adapters.length, 0);
        assertEq(amounts.length, 0);
        assertEq(total, 0);
    }

    function test_nonRiskManagerCannotModifyPools() public {
        address adapter = address(0xA);
        vm.expectRevert("PR: Not RiskManager");
        registry.addProtocolRiskPool(address(token), rateModel, 0);
        _createPool();
        vm.prank(other);
        vm.expectRevert("PR: Not RiskManager");
        registry.updateCapitalAllocation(0, adapter, 1, true);
    }

    function test_revertSetRiskManagerZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("PR: Zero address");
        registry.setRiskManager(address(0));
    }

    function test_revertInvalidPoolId() public {
        uint256 invalidId = 99;
        address adapter = address(0xA);
        vm.expectRevert();
        registry.getPoolData(invalidId);
        vm.prank(riskManager);
        vm.expectRevert();
        registry.updateCapitalAllocation(invalidId, adapter, 1, true);
        vm.prank(riskManager);
        vm.expectRevert();
        registry.updateCapitalPendingWithdrawal(invalidId, 1, true);
        vm.prank(riskManager);
        vm.expectRevert();
        registry.updateCoverageSold(invalidId, 1, true);
        vm.prank(riskManager);
        vm.expectRevert();
        registry.setPauseState(invalidId, true);
    }

    function test_removeAdapterFromMiddle() public {
        _createPool();
        address a1 = address(0x1);
        address a2 = address(0x2);
        address a3 = address(0x3);
        uint256 amt = 10e18;
        vm.prank(riskManager);
        registry.updateCapitalAllocation(0, a1, amt, true);
        vm.prank(riskManager);
        registry.updateCapitalAllocation(0, a2, amt, true);
        vm.prank(riskManager);
        registry.updateCapitalAllocation(0, a3, amt, true);
        vm.prank(riskManager);
        registry.updateCapitalAllocation(0, a2, amt, false);
        address[] memory active = registry.getPoolActiveAdapters(0);
        assertEq(active.length, 2);
        assertEq(active[0], a1);
        assertEq(active[1], a3);
        assertEq(registry.getCapitalPerAdapter(0, a2), 0);
    }

    function test_revertUnderflowAllocation() public {
        _createPool();
        address adapter = address(0xA);
        uint256 amount = 50e18;
        vm.prank(riskManager);
        registry.updateCapitalAllocation(0, adapter, amount, true);
        vm.prank(riskManager);
        vm.expectRevert(stdError.arithmeticError);
        registry.updateCapitalAllocation(0, adapter, amount + 1, false);
    }

    function test_revertUnderflowPendingWithdrawal() public {
        _createPool();
        uint256 amount = 25e18;
        vm.prank(riskManager);
        registry.updateCapitalPendingWithdrawal(0, amount, true);
        vm.prank(riskManager);
        vm.expectRevert(stdError.arithmeticError);
        registry.updateCapitalPendingWithdrawal(0, amount + 1, false);
    }

    function test_revertUnderflowCoverageSold() public {
        _createPool();
        uint256 amount = 10e18;
        vm.prank(riskManager);
        registry.updateCoverageSold(0, amount, true);
        vm.prank(riskManager);
        vm.expectRevert(stdError.arithmeticError);
        registry.updateCoverageSold(0, amount + 1, false);
    }
}
