// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {MockYieldAdapter} from "contracts/test/MockYieldAdapter.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";
import {IYieldAdapter} from "contracts/interfaces/IYieldAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";


/**
 * @title TestableBackstopPool
 * @notice A testing facade contract that inherits from BackstopPool.
 * @dev This contract exposes internal functions from BackstopPool for testing purposes
 * without altering the production contract's public interface.
 */
contract TestableBackstopPool is BackstopPool {
    constructor(
        IERC20 _usdcToken,
        CatShare _catShareToken,
        IYieldAdapter _initialAdapter,
        address _initialOwner
    ) BackstopPool(_usdcToken, _catShareToken, _initialAdapter, _initialOwner) {}

    /**
     * @notice Exposes the internal `_sharesToValue` function for testing.
     */
    function getSharesToValue(uint256 shareAmount) external view returns (uint256) {
        return _sharesToValue(shareAmount);
    }
}


/**
 * @title BackstopPoolComprehensiveTest
 * @notice An exhaustive test suite for the BackstopPool contract.
 */
contract BackstopPoolComprehensiveTest is Test {
    // The test contract is the owner for simplicity.
    address internal owner = address(this);

    // The `pool` variable now uses our testable contract type.
    TestableBackstopPool internal pool;
    CatShare internal share;
    MockERC20 internal usdc;
    MockYieldAdapter internal adapter;
    MockRewardDistributor internal distributor;

    address internal user = makeAddr("user");
    address internal user2 = makeAddr("user2");
    address internal riskManager = makeAddr("riskManager");
    address internal capitalPool = makeAddr("capitalPool");
    address internal policyManager = makeAddr("policyManager");

    uint256 internal constant STARTING_BALANCE = 100_000e6;
    uint256 internal constant MIN_DEPOSIT = 1e3;

    function setUp() public virtual {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        share = new CatShare();
        adapter = new MockYieldAdapter(address(usdc), address(0), owner);
        distributor = new MockRewardDistributor();

        deal(address(usdc), user, STARTING_BALANCE);
        deal(address(usdc), user2, STARTING_BALANCE);

        // Deploy the new TestableBackstopPool contract.
        pool = new TestableBackstopPool(usdc, share, adapter, owner);
        share.transferOwnership(address(pool));
        pool.initialize();

        adapter.setDepositor(address(pool));

        pool.setRiskManagerAddress(riskManager);
        pool.setCapitalPoolAddress(capitalPool);
        pool.setPolicyManagerAddress(policyManager);
        pool.setRewardDistributor(address(distributor));

        vm.startPrank(user);
        usdc.approve(address(pool), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(user2);
        usdc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _deposit(address depositor, uint256 amount) internal {
        vm.prank(depositor);
        pool.depositLiquidity(amount);
    }

    /* ───────────────────────── Core Functionality Fuzz Tests ───────────────────────── */

    function testFuzz_depositLiquidity(uint96 amount) public {
        amount = uint96(bound(amount, MIN_DEPOSIT, STARTING_BALANCE));

        // Act
        _deposit(user, amount);

        // Assert
        assertEq(share.balanceOf(user), amount, "Share balance should match initial deposit");
        assertEq(pool.idleUSDC(), amount, "Idle USDC should increase by deposit amount");
        assertEq(pool.liquidUsdc(), amount, "Total liquid USDC should equal deposit amount");
    }

    function testFuzz_requestAndWithdraw(uint96 amount) public {
        amount = uint96(bound(amount, MIN_DEPOSIT, STARTING_BALANCE));
        _deposit(user, amount);

        // Act: Request withdrawal
        vm.prank(user);
        pool.requestWithdrawal(amount);
        assertEq(pool.withdrawalRequestShares(user), amount, "Withdrawal request shares not set");

        // Warp time forward past the notice period
        vm.warp(block.timestamp + pool.NOTICE_PERIOD() + 1);

        // Act: Withdraw liquidity
        uint256 before = usdc.balanceOf(user);
        vm.prank(user);
        pool.withdrawLiquidity(amount);

        // Assert
        assertEq(usdc.balanceOf(user), before + amount, "User did not receive correct USDC amount");
        assertEq(share.balanceOf(user), 0, "User share balance should be zero");
        assertEq(pool.idleUSDC(), 0, "Idle USDC should be zero");
        assertEq(pool.withdrawalRequestShares(user), 0, "Withdrawal request should be cleared");
    }

    function testFuzz_flushToAdapter(uint96 amount) public {
        amount = uint96(bound(amount, MIN_DEPOSIT, STARTING_BALANCE));
        _deposit(user, amount);

        // Act
        pool.flushToAdapter(amount);

        // Assert
        assertEq(adapter.totalValueHeld(), amount, "Adapter should hold the flushed amount");
        assertEq(pool.idleUSDC(), 0, "Idle USDC should be zero after flush");
        assertEq(pool.liquidUsdc(), amount, "Total liquid USDC should remain the same");
    }

    function testFuzz_drawFund(uint96 depositAmount, uint96 drawAmount) public {
        depositAmount = uint96(bound(depositAmount, MIN_DEPOSIT, STARTING_BALANCE));
        drawAmount = uint96(bound(drawAmount, 1, depositAmount));
        _deposit(user, depositAmount);

        // Act
        vm.prank(riskManager);
        pool.drawFund(drawAmount);

        // Assert
        assertEq(usdc.balanceOf(capitalPool), drawAmount, "Capital Pool did not receive funds");
        assertEq(pool.idleUSDC(), depositAmount - drawAmount, "Idle USDC was not reduced correctly");
    }

    function testFuzz_claimProtocolRewards_isCorrect(uint96 depositAmount, uint96 rewardAmount) public {
        // Bound inputs to reasonable ranges
        depositAmount = uint96(bound(depositAmount, MIN_DEPOSIT, STARTING_BALANCE));
        rewardAmount = uint96(bound(rewardAmount, 1, STARTING_BALANCE));
        _deposit(user, depositAmount);

        // --- Arrange ---
        MockERC20 rewardToken = new MockERC20("Reward", "RWD", 18);
        // 1. Risk Manager receives tokens to distribute.
        rewardToken.mint(riskManager, rewardAmount);
        // 2. Risk Manager approves the pool to pull the tokens.
        vm.startPrank(riskManager);
        rewardToken.approve(address(pool), rewardAmount);
        // 3. Risk Manager calls the pool to start distribution. The pool pulls the tokens.
        pool.receiveProtocolAssetsForDistribution(address(rewardToken), rewardAmount);
        vm.stopPrank();
        // 4. Fund the mock distributor so it can transfer tokens out during the claim.
        rewardToken.mint(address(distributor), rewardAmount);

        // --- Act ---
        uint256 pending = pool.getPendingProtocolAssetRewards(user, address(rewardToken));
        vm.assume(pending > 0); // Ensure there's something to claim

        uint256 balBefore = rewardToken.balanceOf(user);
        vm.prank(user);
        pool.claimProtocolAssetRewards(address(rewardToken));
        uint256 balAfter = rewardToken.balanceOf(user);

        // --- Assert ---
        assertEq(balAfter - balBefore, pending, "User did not receive the correct pending reward amount");
        uint256 remaining = pool.getPendingProtocolAssetRewards(user, address(rewardToken));
        assertApproxEqAbs(remaining, 0, 1, "Remaining rewards should be zero after claim");
    }

    /* ───────────────────────── Revert and Failure Tests ───────────────────────── */

    function testRevert_initialize_ifAlreadyInitialized() public {
        vm.expectRevert("CIP: Already initialized");
        pool.initialize();
    }

    function testRevert_deposit_ifAmountTooLow() public {
        vm.expectRevert("CIP: Amount below minimum");
        _deposit(user, MIN_DEPOSIT - 1);
    }

    function testRevert_requestWithdrawal_ifRequestPending() public {
        _deposit(user, 10_000e6);
        vm.prank(user);
        pool.requestWithdrawal(5_000e6);

        vm.expectRevert("CIP: Withdrawal request pending");
        vm.prank(user);
        pool.requestWithdrawal(1_000e6);
    }

    function testRevert_withdraw_ifNoticePeriodActive() public {
        _deposit(user, 10_000e6);
        vm.prank(user);
        pool.requestWithdrawal(10_000e6);

        // Try to withdraw before notice period is over
        vm.warp(block.timestamp + pool.NOTICE_PERIOD() - 100);

        vm.expectRevert("CIP: Notice period active");
        vm.prank(user);
        pool.withdrawLiquidity(10_000e6);
    }

    function testRevert_withdraw_ifAmountMismatched() public {
        _deposit(user, 10_000e6);
        vm.prank(user);
        pool.requestWithdrawal(5_000e6);

        vm.warp(block.timestamp + pool.NOTICE_PERIOD() + 1);

        vm.expectRevert("CIP: Amount mismatch");
        vm.prank(user);
        pool.withdrawLiquidity(4_000e6); // Incorrect amount
    }

    function testRevert_drawFund_ifAmountExceedsLiquidity() public {
        _deposit(user, 10_000e6);
        uint256 totalLiquidity = pool.liquidUsdc();

        vm.prank(riskManager);
        vm.expectRevert("CIP: Draw amount exceeds Cat Pool's liquid USDC");
        pool.drawFund(totalLiquidity + 1);
    }
    
    function testRevert_adminSetters_ifZeroAddress() public {
        vm.expectRevert("CIP: Address cannot be zero");
        pool.setRiskManagerAddress(address(0));

        vm.expectRevert("CIP: Address cannot be zero");
        pool.setCapitalPoolAddress(address(0));

        vm.expectRevert("CIP: Address cannot be zero");
        pool.setPolicyManagerAddress(address(0));

        vm.expectRevert("CIP: Address cannot be zero");
        pool.setRewardDistributor(address(0));
    }


    /* ───────────────────────── Complex Scenarios ───────────────────────── */

    function test_shareValue_decreasesAfterDraw() public {
        uint256 depositAmount = 100_000e6;
        _deposit(user, depositAmount); // user gets 100,000 shares for 100,000 USDC (1:1)

        // Act: Risk manager draws 50% of the funds, representing a loss to the pool.
        uint256 drawAmount = depositAmount / 2;
        vm.prank(riskManager);
        pool.drawFund(drawAmount);

        // Assert: The total value of the pool is now halved.
        uint256 valueAfterDraw = pool.liquidUsdc();
        assertEq(valueAfterDraw, depositAmount - drawAmount, "Pool value incorrect after draw");
        
        // **FIXED LINE**: Call the new public getter `getSharesToValue` to test the internal logic.
        // This asserts that the contract's own calculation of the total shares' value matches the pool's assets.
        uint256 sharesValue = pool.getSharesToValue(share.balanceOf(user));
        assertApproxEqAbs(sharesValue, valueAfterDraw, 1, "Share value calculation is wrong post-draw");

        // Assert: A new depositor gets more shares for their USDC because the share price is lower.
        uint256 deposit2Amount = 10_000e6;
        uint256 sharesBefore = share.totalSupply();
        _deposit(user2, deposit2Amount);
        uint256 sharesAfter = share.totalSupply();
        
        // The exchange rate is now ~0.5 USDC per share, so user2 should get ~2 shares per USDC.
        // We assert that the number of shares they receive is greater than the USDC amount they deposited.
        assertGt(sharesAfter - sharesBefore, deposit2Amount, "User2 did not get more shares for their deposit");
    }

    function test_withdraw_whenFundsAreInAdapter() public {
        uint256 depositAmount = 50_000e6;
        _deposit(user, depositAmount);

        // Move all funds to the adapter
        pool.flushToAdapter(depositAmount);
        assertEq(pool.idleUSDC(), 0);
        assertEq(adapter.totalValueHeld(), depositAmount);

        // Act: Request and perform withdrawal
        vm.prank(user);
        pool.requestWithdrawal(depositAmount);
        vm.warp(block.timestamp + pool.NOTICE_PERIOD() + 1);
        
        uint256 balanceBefore = usdc.balanceOf(user);
        vm.prank(user);
        pool.withdrawLiquidity(depositAmount);
        
        // Assert: Funds were correctly pulled from adapter and sent to user
        assertEq(adapter.totalValueHeld(), 0, "Adapter should be empty");
        assertEq(usdc.balanceOf(user), balanceBefore + depositAmount, "User did not receive funds");
    }

    /* ───────────────────────── Invariant Testing ───────────────────────── */

    function invariant_liquidUsdc_is_consistent() public {
        // This invariant should always hold true: the calculated liquid USDC
        // must equal the sum of idle USDC and funds held in the adapter.
        assertEq(pool.liquidUsdc(), pool.idleUSDC() + adapter.getCurrentValueHeld());
    }
}