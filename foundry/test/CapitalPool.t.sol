// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {MockYieldAdapter} from "contracts/test/MockYieldAdapter.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {MockRiskManager} from "contracts/test/MockRiskManager.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";
import {MockBackstopPool} from "contracts/test/MockBackstopPool.sol";
import {IYieldAdapterEmergency} from "contracts/interfaces/IYieldAdapterEmergency.sol";

contract CapitalPoolTest is Test {
    // --- Contracts and Mocks ---
    CapitalPool pool;
    MockERC20 token;
    MockYieldAdapter adapter;
    MockRiskManager rm;
    MockRewardDistributor rd;
    MockBackstopPool catPool;

    // --- Actors ---
    address owner = address(this);
    address userA = vm.addr(0xA);
    address userB = vm.addr(0xB);
    address harvester = vm.addr(0x48);

    uint256 constant INITIAL_SUPPLY = 1_000_000e6;

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        token.mint(owner, INITIAL_SUPPLY);
        token.mint(userA, INITIAL_SUPPLY);
        token.mint(userB, INITIAL_SUPPLY);

        rm = new MockRiskManager();
        rd = new MockRewardDistributor();
        catPool = new MockBackstopPool(owner);
        rm.setCatPool(address(catPool));

        pool = new CapitalPool(owner, address(token));
        pool.setRiskManager(address(rm));
        pool.setRewardDistributor(address(rd));
        pool.setUnderwriterNoticePeriod(0);

        adapter = new MockYieldAdapter(address(token), address(0), owner);
        adapter.setDepositor(address(pool));
        pool.setBaseYieldAdapter(CapitalPool.YieldPlatform.AAVE, address(adapter));

        vm.prank(userA);
        token.approve(address(pool), type(uint256).max);
        vm.prank(userB);
        token.approve(address(pool), type(uint256).max);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* CORE FUNCTION TESTS                               */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function test_deposit_and_withdraw() public {
        uint256 depositAmount = 10_000e6;
        
        // --- Deposit ---
        vm.prank(userA);
        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);

        (uint256 principal, , uint256 shares, ) = pool.getUnderwriterAccount(userA);
        assertEq(principal, depositAmount, "Principal mismatch after deposit");
        assertEq(shares, depositAmount, "Shares mismatch after deposit");
        assertEq(pool.principalInAdapter(address(adapter)), depositAmount, "Principal in adapter not tracked");
        assertEq(rd.updateUserStateCallCount(), 1, "updateUserState should be called on deposit");
        // CORRECTED: The variable in the mock is named last_updateUserState_user
        assertEq(rd.last_updateUserState_user(), userA, "Incorrect user for updateUserState");

        // --- Withdraw ---
        vm.prank(userA);
        pool.requestWithdrawal(shares);
        vm.prank(userA);
        pool.executeWithdrawal(0);
        
        (principal, , shares, ) = pool.getUnderwriterAccount(userA);
        assertEq(principal, 0, "Principal should be 0 after full withdrawal");
        assertEq(shares, 0, "Shares should be 0 after full withdrawal");
        assertEq(pool.principalInAdapter(address(adapter)), 0, "Principal in adapter should be 0");
        assertEq(rd.updateUserStateCallCount(), 2, "updateUserState should be called on withdrawal");
    }

    function test_applyLosses() public {
        uint256 depositAmount = 20_000e6;
        uint256 lossAmount = 5_000e6;

        vm.prank(userA);
        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);
        
        vm.prank(address(rm));
        pool.applyLosses(userA, lossAmount);

        (uint256 principal, , uint256 shares, ) = pool.getUnderwriterAccount(userA);
        uint256 expectedPrincipal = depositAmount - lossAmount;
        
        assertEq(principal, expectedPrincipal, "Principal not reduced correctly after loss");
        assertEq(pool.principalInAdapter(address(adapter)), expectedPrincipal, "Principal in adapter not reduced after loss");
        assertEq(rd.updateUserStateCallCount(), 2, "updateUserState should be called on applyLosses");
    }

    function test_cancelWithdrawalRequest() public {
        uint96 amount = 10_000e6;
        vm.prank(userA);
        pool.deposit(amount, CapitalPool.YieldPlatform.AAVE);
        
        vm.prank(userA);
        pool.requestWithdrawal(2_000e6); // index 0
        vm.prank(userA);
        pool.requestWithdrawal(3_000e6); // index 1
        
        assertEq(pool.getWithdrawalRequestCount(userA), 2);
        
        vm.prank(userA);
        pool.cancelWithdrawalRequest(0);

        assertEq(pool.getWithdrawalRequestCount(userA), 1);
        (uint256 shares, ) = pool.withdrawalRequests(userA, 0);
        assertEq(shares, 3_000e6, "The wrong request was removed");
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* YIELD HARVESTING TESTS                            */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function test_harvestAndDistributeYield_succeeds() public {
        uint256 depositAmount = 50_000e6;
        uint256 yieldAmount = 5_000e6;

        vm.prank(userA);
        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);
        assertEq(pool.principalInAdapter(address(adapter)), depositAmount);

        adapter.simulateYieldOrLoss(int256(yieldAmount));
        assertEq(adapter.totalValueHeld(), depositAmount + yieldAmount);

        vm.prank(harvester);
        pool.harvestAndDistributeYield(address(adapter));

        assertEq(adapter.withdrawCallCount(), 1);
        assertEq(adapter.last_withdraw_amount(), yieldAmount);
        assertEq(adapter.last_withdraw_recipient(), address(pool));
        assertEq(token.balanceOf(address(rd)), yieldAmount);
        assertEq(rd.distributeCallCount(), 1);
        assertEq(rd.last_distribute_poolId(), 0);
        assertEq(rd.last_distribute_protocolToken(), address(token));
        assertEq(rd.last_distribute_amount(), yieldAmount);
        assertEq(rd.last_distribute_totalPledge(), pool.totalMasterSharesSystem());
    }

    function test_harvestAndDistributeYield_noYield() public {
        uint256 depositAmount = 50_000e6;
        vm.prank(userA);
        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);
        assertEq(adapter.totalValueHeld(), depositAmount);

        vm.prank(harvester);
        pool.harvestAndDistributeYield(address(adapter));

        assertEq(adapter.withdrawCallCount(), 0, "Withdraw should not be called if no yield");
        assertEq(rd.distributeCallCount(), 0, "Distribute should not be called if no yield");
    }

    function test_harvestAndDistributeYield_withLosses() public {
        uint256 depositAmount = 50_000e6;
        int256 lossAmount = -5_000e6;
        vm.prank(userA);
        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);

        adapter.simulateYieldOrLoss(lossAmount);
        assertEq(adapter.totalValueHeld(), uint256(int256(depositAmount) + lossAmount));

        vm.prank(harvester);
        pool.harvestAndDistributeYield(address(adapter));

        assertEq(adapter.withdrawCallCount(), 0, "Withdraw should not be called if there is a loss");
        assertEq(rd.distributeCallCount(), 0, "Distribute should not be called if there is a loss");
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* PAYOUT & MULTI-USER TESTS                         */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function test_executePayout() public {
        MockYieldAdapter adapterB = new MockYieldAdapter(address(token), address(0), owner);
        adapterB.setDepositor(address(pool));
        pool.setBaseYieldAdapter(CapitalPool.YieldPlatform.COMPOUND, address(adapterB));

        vm.prank(userA);
        pool.deposit(60_000e6, CapitalPool.YieldPlatform.AAVE);
        vm.prank(userB);
        pool.deposit(40_000e6, CapitalPool.YieldPlatform.COMPOUND);

        CapitalPool.PayoutData memory payout;
        payout.claimant = vm.addr(0xC);
        payout.feeRecipient = vm.addr(0xD);
        payout.claimantAmount = 8_000e6;
        payout.feeAmount = 2_000e6;
        payout.totalCapitalFromPoolLPs = 100_000e6;
        address[] memory adapters = new address[](2);
        adapters[0] = address(adapter);
        adapters[1] = address(adapterB);
        payout.adapters = adapters;
        uint256[] memory capitalPerAdapter = new uint256[](2);
        capitalPerAdapter[0] = 60_000e6;
        capitalPerAdapter[1] = 40_000e6;
        payout.capitalPerAdapter = capitalPerAdapter;
        
        vm.prank(address(rm));
        pool.executePayout(payout);

        assertEq(adapter.withdrawCallCount(), 1);
        assertEq(adapter.last_withdraw_amount(), 6_000e6);
        assertEq(adapterB.withdrawCallCount(), 1);
        assertEq(adapterB.last_withdraw_amount(), 4_000e6);
        assertEq(token.balanceOf(payout.claimant), payout.claimantAmount);
        assertEq(token.balanceOf(payout.feeRecipient), payout.feeAmount);
        assertEq(pool.totalSystemValue(), 100_000e6 - 10_000e6);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* REVERT TESTS                                      */
    /*.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.•°:°.´+˚.*°.˚:*.´•°.*/

    function testRevert_harvest_ifAdapterNotActive() public {
        address inactiveAdapter = address(0xDEADBEEF);
        vm.prank(harvester);
        vm.expectRevert("CP: Adapter not active");
        pool.harvestAndDistributeYield(inactiveAdapter);
    }

    function testRevert_deposit_noSharesToMint() public {
        vm.prank(userA);
        pool.deposit(1_000_000e6, CapitalPool.YieldPlatform.AAVE);

        vm.prank(userB);
        vm.expectRevert(CapitalPool.NoSharesToMint.selector);
        pool.deposit(1, CapitalPool.YieldPlatform.AAVE);
    }

    function testRevert_requestWithdrawal_ifExceedsTotalShares() public {
        uint96 depositAmount = 10_000e6;
        vm.prank(userA);
        pool.deposit(depositAmount, CapitalPool.YieldPlatform.AAVE);
        
        vm.prank(userA);
        pool.requestWithdrawal(8_000e6);

        vm.prank(userA);
        vm.expectRevert(CapitalPool.InsufficientShares.selector);
        pool.requestWithdrawal(3_000e6);
    }

    function testRevert_executeWithdrawal_ifNoticePeriodActive() public {
        uint256 noticePeriod = 7 days;
        pool.setUnderwriterNoticePeriod(noticePeriod);
        
        vm.prank(userA);
        pool.deposit(10_000e6, CapitalPool.YieldPlatform.AAVE);
        vm.prank(userA);
        pool.requestWithdrawal(5_000e6);

        vm.prank(userA);
        vm.expectRevert(CapitalPool.NoticePeriodActive.selector);
        pool.executeWithdrawal(0);
        
        vm.warp(block.timestamp + noticePeriod + 1);
        
        vm.prank(userA);
        pool.executeWithdrawal(0); // Should now succeed
    }
}
