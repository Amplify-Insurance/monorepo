// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {IPolicyNFT} from "contracts/interfaces/IPolicyNFT.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/* ───────────────────────── Mock Contracts ───────────────────────── */
// By defining mocks inside the test file, we can ensure they have the necessary
// public state variables for our assertions.

contract MockPoolRegistry is IPoolRegistry {
    struct Pool {
        IERC20 token;
        uint256 pledged;
        uint256 sold;
        uint256 pendingWithdrawals;
        bool paused;
        address riskManager;
        uint256 lossTrackId;
    }
    mapping(uint256 => Pool) public pools;
    mapping(uint256 => RateModel) public rateModels;

    function getPoolData(uint256 poolId) external view returns (IERC20, uint256, uint256, uint256, bool, address, uint256) {
        Pool memory p = pools[poolId];
        return (p.token, p.pledged, p.sold, p.pendingWithdrawals, p.paused, p.riskManager, p.lossTrackId);
    }

    function getPoolRateModel(uint256 poolId) external view returns (RateModel memory) {
        return rateModels[poolId];
    }

    function setPoolData(uint256 id, IERC20 token, uint256 pledged, uint256 sold, uint256 pending, bool paused, address rm, uint256 lossId) public {
        pools[id] = Pool(token, pledged, sold, pending, paused, rm, lossId);
    }

    function setRateModel(uint256 id, RateModel memory rate) public {
        rateModels[id] = rate;
    }

    function setPoolPaused(uint256 id, bool isPaused) public {
        pools[id].paused = isPaused;
    }

    function getPoolPayoutData(uint256)
        external
        view
        returns (address[] memory, uint256[] memory, uint256)
    {
        address[] memory a;
        uint256[] memory b;
        return (a, b, 0);
    }

    function getPoolActiveAdapters(uint256) external view returns (address[] memory) {
        address[] memory a;
        return a;
    }

    function getCapitalPerAdapter(uint256, address) external view returns (uint256) {
        return 0;
    }

    function addProtocolRiskPool(address, RateModel calldata, uint256) external returns (uint256) {
        return 0;
    }

    function updateCapitalAllocation(uint256, address, uint256, bool) external {}

    function updateCapitalPendingWithdrawal(uint256, uint256, bool) external {}

    function updateCoverageSold(uint256, uint256, bool) external {}

    function getPoolCount() external view returns (uint256) {
        return 0;
    }

    function setPauseState(uint256, bool) external {}

    function setFeeRecipient(uint256, address) external {}

    function getMultiplePoolData(uint256[] calldata) external view returns (IPoolRegistry.PoolInfo[] memory infos) {
        infos = new IPoolRegistry.PoolInfo[](0);
    }
}

contract MockCapitalPool {
    address public owner;
    IERC20 public asset;
    uint256 public totalDeposited;

    constructor(address _owner, address _asset) {
        owner = _owner;
        asset = IERC20(_asset);
    }

    function underlyingAsset() external view returns (IERC20) {
        return asset;
    }
}

contract MockBackstopPool {
    address public owner;
    uint256 public totalDeposited;

    constructor(address _owner) {
        owner = _owner;
    }

    function receiveUsdcPremium(uint256 amount) external {
        totalDeposited += amount;
    }
}

contract MockPolicyNFT is IPolicyNFT {
    address public owner;
    mapping(uint256 => Policy) public policies;
    mapping(uint256 => address) public owners;
    uint256 public nextId = 1;
    uint256 public last_burn_id;

    constructor(address _owner) {
        owner = _owner;
    }

    function mint(address to, uint256 pid, uint256 coverage, uint256 activation, uint128 premium, uint128 drainTime) external returns (uint256) {
        uint256 id = nextId++;
        owners[id] = to;
        policies[id] = Policy({
            coverage: coverage,
            poolId: pid,
            start: block.timestamp,
            activation: activation,
            premiumDeposit: premium,
            lastDrainTime: drainTime
        });
        return id;
    }

    function burn(uint256 id) external {
        require(owners[id] != address(0), "Does not exist");
        delete owners[id];
        delete policies[id];
        last_burn_id = id;
    }

    function finalizeIncreases(uint256 id, uint256 amount) external {
        policies[id].coverage += amount;
    }

    function updatePremiumAccount(uint256 id, uint128 newDeposit, uint128 newDrainTime) external {
        policies[id].premiumDeposit = newDeposit;
        policies[id].lastDrainTime = newDrainTime;
    }

    function getPolicy(uint256 id) external view returns (Policy memory) {
        return policies[id];
    }

    function ownerOf(uint256 id) public view returns (address) {
        return owners[id];
    }
}

contract MockRewardDistributor {
    function distribute(uint256, address, uint256, uint256) external {}
}

// **FIXED**: The MockRiskManagerHook now has a public `coverageSold` mapping
// that the test can read to verify state changes.
contract MockRiskManagerHook {
    mapping(uint256 => uint256) public coverageSold;

    function updateCoverageSold(uint256 poolId, uint256 amount, bool isIncrease) external {
        if (isIncrease) {
            coverageSold[poolId] += amount;
        } else {
            coverageSold[poolId] -= amount;
        }
    }
}

contract PolicyManagerHarness is PolicyManager {
    constructor(address _nft) PolicyManager(_nft, msg.sender) {}
    function settlePremiums(uint256 policyId) external {
        _settleAndDrainPremium(policyId);
    }
}

/* ───────────────────────── Test Contract ───────────────────────── */

contract PolicyManagerFuzz is Test {
    PolicyManagerHarness pm;
    MockPoolRegistry registry;
    MockCapitalPool capital;
    MockBackstopPool cat;
    MockPolicyNFT nft;
    MockRewardDistributor rewards;
    MockRiskManagerHook rm;
    MockERC20 token;

    address user = address(0x1);
    address otherUser = address(0x2);
    uint256 constant POOL_ID = 0;
    uint256 constant POOL_CAPACITY = 1_000_000e6;

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        token.mint(user, 10_000_000e6);
        token.mint(otherUser, 10_000_000e6);

        registry = new MockPoolRegistry();
        capital = new MockCapitalPool(address(this), address(token));
        cat = new MockBackstopPool(address(this));
        nft = new MockPolicyNFT(address(this));
        rewards = new MockRewardDistributor();
        rm = new MockRiskManagerHook();

        pm = new PolicyManagerHarness(address(nft));
        // In the mock, we don't need to set the cover pool address on the NFT.
        pm.setAddresses(address(registry), address(capital), address(cat), address(rewards), address(rm));

        registry.setPoolData(POOL_ID, token, POOL_CAPACITY, 0, 0, false, address(this), 0);
        IPoolRegistry.RateModel memory rate =
            IPoolRegistry.RateModel({base: 100, slope1: 200, slope2: 500, kink: 8000});
        registry.setRateModel(POOL_ID, rate);

        vm.startPrank(user);
        token.approve(address(pm), type(uint256).max);
        vm.stopPrank();
    }

    /* ───────────────────────── Helper Functions ──────────────────────── */

    function _minPremium(uint256 coverage) internal view returns (uint256) {
        uint256 annualRateBps = 100; // Base rate from rate model
        return (coverage * annualRateBps * 7 days) / (365 days * 10_000);
    }

    /* ───────────────────────── Admin Function Tests ──────────────────────── */

    function testFuzz_adminSetters(uint16 bps, uint32 cooldown) public {
        bps = uint16(bound(bps, 0, 5000));

        MockBackstopPool newCat = new MockBackstopPool(address(this));
        MockRewardDistributor newRewards = new MockRewardDistributor();

        pm.setCatPremiumShareBps(bps);
        pm.setCoverCooldownPeriod(cooldown);
        pm.setCatPool(address(newCat));
        pm.setAddresses(address(registry), address(capital), address(newCat), address(newRewards), address(rm));

        assertEq(pm.catPremiumBps(), bps);
        assertEq(pm.coverCooldownPeriod(), cooldown);
        assertEq(address(pm.catPool()), address(newCat));
        assertEq(address(pm.rewardDistributor()), address(newRewards));
    }

    function testFuzz_revert_adminSetters(uint256 bps) public {
        vm.assume(bps > 5000);
        vm.expectRevert(PolicyManager.InvalidAmount.selector);
        pm.setCatPremiumShareBps(bps);

        vm.expectRevert(PolicyManager.AddressesNotSet.selector);
        pm.setAddresses(address(0), address(capital), address(cat), address(rewards), address(rm));
    }

    /* ───────────────────── Purchase Cover Tests ───────────────────── */

    function testFuzz_purchaseCover(uint96 coverage, uint96 deposit) public {
        coverage = uint96(bound(coverage, 100e6, POOL_CAPACITY));
        uint256 minPremium = _minPremium(coverage);
        deposit = uint96(bound(deposit, (minPremium == 0 ? 1 : minPremium), 1_000_000e6));

        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        assertEq(policyId, 1);
        assertEq(token.balanceOf(address(pm)), deposit);
        assertEq(nft.ownerOf(policyId), user);
        // **FIXED**: This assertion now works because the mock has a public `coverageSold` mapping.
        assertEq(rm.coverageSold(POOL_ID), coverage);

        IPolicyNFT.Policy memory pol = nft.getPolicy(policyId);
        assertEq(pol.coverage, coverage);
        assertEq(pol.premiumDeposit, deposit);
    }

    function testFuzz_revert_purchaseCover(uint96 coverage, uint96 deposit) public {
        // Revert on zero amounts
        vm.prank(user);
        vm.expectRevert(PolicyManager.InvalidAmount.selector);
        pm.purchaseCover(POOL_ID, 0, 1e6);
        vm.expectRevert(PolicyManager.InvalidAmount.selector);
        pm.purchaseCover(POOL_ID, 100e6, 0);

        // Revert if deposit is too low
        coverage = uint96(bound(coverage, 100e6, POOL_CAPACITY));
        uint256 minPremium = _minPremium(coverage);
        vm.assume(minPremium > 0);
        deposit = uint96(bound(deposit, 1, minPremium - 1));
        vm.prank(user);
        vm.expectRevert(PolicyManager.DepositTooLow.selector);
        pm.purchaseCover(POOL_ID, coverage, deposit);

        // Revert if pool is paused
        registry.setPoolPaused(POOL_ID, true);
        vm.prank(user);
        vm.expectRevert(PolicyManager.PoolPaused.selector);
        pm.purchaseCover(POOL_ID, 100e6, 1e6);
        registry.setPoolPaused(POOL_ID, false); // reset for other tests

        // Revert if insufficient capacity
        uint256 highCoverage = POOL_CAPACITY + 1;
        vm.prank(user);
        vm.expectRevert(PolicyManager.InsufficientCapacity.selector);
        pm.purchaseCover(POOL_ID, highCoverage, 1_000_000e6);
    }

    /* ───────────────────── Increase Cover Tests ───────────────────── */

    function testFuzz_increaseCover(uint96 coverage, uint96 deposit, uint96 addAmount) public {
        coverage = uint96(bound(coverage, 100e6, POOL_CAPACITY / 2));
        addAmount = uint96(bound(addAmount, 1e6, POOL_CAPACITY / 2));
        uint256 totalCoverage = uint256(coverage) + uint256(addAmount);
        uint256 minPremium = _minPremium(totalCoverage);
        deposit = uint96(bound(deposit, minPremium, 1_000_000e6));

        vm.startPrank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);
        pm.increaseCover(policyId, addAmount);
        vm.stopPrank();

        assertEq(pm.pendingCoverageSum(policyId), addAmount);
        assertEq(rm.coverageSold(POOL_ID), totalCoverage);
    }

    function testFuzz_revert_increaseCover(uint96 coverage, uint96 addAmount) public {
        uint256 deposit = 1_000_000e6;
        coverage = uint96(bound(coverage, 100e6, POOL_CAPACITY / 2));
        addAmount = uint96(bound(addAmount, 1e6, POOL_CAPACITY / 2));

        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        // Revert if not owner
        vm.prank(otherUser);
        vm.expectRevert(PolicyManager.NotPolicyOwner.selector);
        pm.increaseCover(policyId, addAmount);

        // Revert if policy is not active (lapsed)
        vm.prank(user);
        vm.warp(block.timestamp + 1000 days); // Ensure premium is depleted
        vm.expectRevert(PolicyManager.PolicyNotActive.selector);
        pm.increaseCover(policyId, addAmount);
    }

    /* ───────────────────── Policy Termination Tests ───────────────────── */

    function testFuzz_cancelCover(uint96 coverage, uint96 deposit) public {
        coverage = uint96(bound(coverage, 100e6, POOL_CAPACITY));
        uint256 minPremium = _minPremium(coverage);
        deposit = uint96(bound(deposit, (minPremium == 0 ? 1 : minPremium), 1_000_000e6));

        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        // Allow cooldown to pass
        pm.setCoverCooldownPeriod(1 days);
        vm.warp(block.timestamp + 2 days);

        uint256 balBefore = token.balanceOf(user);
        pm.cancelCover(policyId);
        uint256 balAfter = token.balanceOf(user);

        // User gets back almost all of the deposit, minus a tiny bit for the 2 days of cover
        assertTrue(balAfter > balBefore);
        assertTrue(balAfter <= balBefore + deposit);
        assertEq(nft.last_burn_id(), policyId);
        assertEq(rm.coverageSold(POOL_ID), 0);
    }

    function testFuzz_revert_cancelCover(uint96 coverage) public {
        coverage = uint96(bound(coverage, 100e6, POOL_CAPACITY));
        uint256 deposit = _minPremium(coverage) * 2;

        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        // Revert if cooldown is active
        pm.setCoverCooldownPeriod(1 days);
        vm.expectRevert(PolicyManager.CooldownActive.selector);
        pm.cancelCover(policyId);
        vm.warp(block.timestamp + 2 days); // Pass cooldown

        // Revert if not owner
        vm.prank(otherUser);
        vm.expectRevert(PolicyManager.NotPolicyOwner.selector);
        pm.cancelCover(policyId);
    }

    function testFuzz_lapsePolicy(uint96 coverage) public {
        coverage = uint96(bound(coverage, 100e6, POOL_CAPACITY));
        uint256 deposit = _minPremium(coverage);
        if (deposit == 0) deposit = 1;

        vm.startPrank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);
        // Warp time far into the future to ensure the policy's premium is fully depleted
        vm.warp(block.timestamp + 365 days);
        assertFalse(pm.isPolicyActive(policyId), "Policy should be inactive before lapse");

        pm.lapsePolicy(policyId);
        vm.stopPrank();

        assertEq(nft.last_burn_id(), policyId);
        assertEq(rm.coverageSold(POOL_ID), 0);
    }

    function testFuzz_revert_lapsePolicy(uint96 coverage) public {
        coverage = uint96(bound(coverage, 100e6, POOL_CAPACITY));
        uint256 deposit = _minPremium(coverage) * 10; // Give it plenty of premium

        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        // Revert if policy is still active
        assertTrue(pm.isPolicyActive(policyId), "Policy should be active");
        vm.expectRevert(PolicyManager.PolicyIsActive.selector);
        pm.lapsePolicy(policyId);
    }


    /* ───────────────────── Lifecycle & Integration Tests ───────────────────── */

    function testFuzz_fullLifecycle(uint96 c1, uint96 c2, uint96 c3) public {
        // 1. Setup
        c1 = uint96(bound(c1, 100e6, 200_000e6));
        c2 = uint96(bound(c2, 50e6, 100_000e6));
        c3 = uint96(bound(c3, 50e6, 100_000e6));
        uint256 totalCoverage = uint256(c1) + uint256(c2) + uint256(c3);
        vm.assume(totalCoverage <= POOL_CAPACITY);
        uint256 deposit = _minPremium(totalCoverage) * 10; // Deposit enough for 70 days
        pm.setCoverCooldownPeriod(3 days);

        // 2. Purchase
        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, c1, deposit);
        assertEq(rm.coverageSold(POOL_ID), c1);

        // 3. First Increase
        pm.increaseCover(policyId, c2);
        assertEq(pm.pendingCoverageSum(policyId), c2);
        assertEq(rm.coverageSold(POOL_ID), uint256(c1) + uint256(c2));

        // 4. Second Increase (before first is active)
        pm.increaseCover(policyId, c3);
        assertEq(pm.pendingCoverageSum(policyId), uint256(c2) + uint256(c3));
        assertEq(rm.coverageSold(POOL_ID), totalCoverage);

        // 5. Settle pending increases
        vm.warp(block.timestamp + 4 days); // Pass cooldown
        pm.settlePremiums(policyId); // Manually trigger settlement
        IPolicyNFT.Policy memory pol = nft.getPolicy(policyId);
        assertEq(pol.coverage, totalCoverage);
        assertEq(pm.pendingCoverageSum(policyId), 0);

        // 6. Lapse policy
        uint256 balBeforeLapse = token.balanceOf(address(pm));
        vm.warp(block.timestamp + 100 days); // Deplete premium
        assertFalse(pm.isPolicyActive(policyId));
        pm.lapsePolicy(policyId);

        // Check state after lapse
        assertEq(nft.last_burn_id(), policyId);
        assertEq(rm.coverageSold(POOL_ID), 0);
        // All premium should have been distributed
        assertEq(token.balanceOf(address(pm)), 0);
        assertTrue(capital.totalDeposited() > 0);
        assertTrue(cat.totalDeposited() > 0);
        assertApproxEqAbs(capital.totalDeposited() + cat.totalDeposited(), balBeforeLapse, 1);
    }

    function testFuzz_premiumDrainingAndDistribution(uint96 coverage) public {
        coverage = uint96(bound(coverage, 100e6, POOL_CAPACITY));
        uint256 deposit = _minPremium(coverage) * 10; // ~70 days of premium

        vm.prank(user);
        uint256 policyId = pm.purchaseCover(POOL_ID, coverage, deposit);

        vm.warp(block.timestamp + 30 days);
        pm.settlePremiums(policyId);

        uint256 drainedPremium = deposit - token.balanceOf(address(pm));
        uint256 expectedCatShare = (drainedPremium * pm.catPremiumBps()) / pm.BPS();
        uint256 expectedCapitalShare = drainedPremium - expectedCatShare;

        assertApproxEqAbs(cat.totalDeposited(), expectedCatShare, 1);
        assertApproxEqAbs(capital.totalDeposited(), expectedCapitalShare, 1);
    }
}
