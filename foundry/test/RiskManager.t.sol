// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// --- Contract Under Test ---
import {RiskManager} from "contracts/core/RiskManager.sol";

// --- Interfaces (as defined in the contract file) ---
import {ICapitalPool, YieldPlatform} from "contracts/interfaces/ICapitalPool.sol";
import {IPolicyNFT} from "contracts/interfaces/IPolicyNFT.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {IBackstopPool} from "contracts/interfaces/IBackstopPool.sol";
import {ILossDistributor} from "contracts/interfaces/ILossDistributor.sol";
import {IRewardDistributor} from "contracts/interfaces/IRewardDistributor.sol";
import {IUnderwriterManager} from "contracts/interfaces/IUnderwriterManager.sol";
import {IPolicyManager} from "contracts/interfaces/IPolicyManager.sol";

// --- Mocks ---
import {MockERC20} from "contracts/test/MockERC20.sol";
import {MockCapitalPool} from "contracts/test/MockCapitalPool.sol";
import {MockPoolRegistry} from "contracts/test/MockPoolRegistry.sol";
import {MockPolicyNFT} from "contracts/test/MockPolicyNFT.sol";
import {MockPolicyManager} from "contracts/test/MockPolicyManager.sol";
import {MockBackstopPool} from "contracts/test/MockBackstopPool.sol";
import {MockLossDistributor} from "contracts/test/MockLossDistributor.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";
import {MockUnderwriterManager} from "contracts/test/MockUnderwriterManager.sol";

/// @title RiskManager Comprehensive Unit Tests
/// @notice This suite uses mock contracts to test the logic of RiskManager in isolation,
///         covering a wide range of success paths, edge cases, and failure conditions.
contract RiskManagerComprehensiveTest is Test {
    // --- Contract and Mocks ---
    RiskManager rm;
    MockCapitalPool cp;
    MockPoolRegistry pr;
    MockPolicyNFT nft;
    MockPolicyManager pm;
    MockBackstopPool cat;
    MockLossDistributor ld;
    MockRewardDistributor rd;
    MockUnderwriterManager um;
    MockERC20 usdc;
    MockERC20 protocolToken;

    // --- Actors ---
    address owner = address(this);
    address committee = address(0xBEEF);
    address underwriter = address(0xFACE);
    address claimant = address(0xC1A1);
    address liquidator = address(0xDEAD);
    address otherUser = address(0xBAD);

    // --- Constants ---
    uint256 constant DEFAULT_POOL_ID = 0;
    uint256 constant DEFAULT_POLICY_ID = 1;

    // --- Events ---
    event CommitteeSet(address committee);
    event UnderwriterLiquidated(address indexed liquidator, address indexed underwriter);
    event AddressesSet(
        address capital,
        address registry,
        address policyMgr,
        address cat,
        address loss,
        address rewards,
        address underwriterMgr
    );

    function setUp() public {

        vm.warp(block.timestamp + 2 days);
        // --- Deploy Mocks ---
        usdc = new MockERC20("USD Coin", "USDC", 6);
        protocolToken = new MockERC20("Protocol Token", "PT", 18);
        cp = new MockCapitalPool(owner, address(usdc));
        pr = new MockPoolRegistry();
        nft = new MockPolicyNFT(owner);
        pm = new MockPolicyManager();
        cat = new MockBackstopPool(owner);
        ld = new MockLossDistributor();
        rd = new MockRewardDistributor();
        um = new MockUnderwriterManager();

        // --- Deploy Contract Under Test ---
        rm = new RiskManager(owner);

        // --- Link Mocks and Set Initial State ---
        pm.setPolicyNFT(address(nft));
        rm.setAddresses(address(cp), address(pr), address(pm), address(cat), address(ld), address(rd), address(um));
        rm.setCommittee(committee);

        nft.setCoverPoolAddress(address(rm));
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* OWNER FUNCTIONS                                */
    /*.•°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.*/

    function test_setAddresses_succeeds_and_emits_event() public {
        // Arrange
        address newCp = address(new MockCapitalPool(owner, address(usdc)));
        address newPr = address(new MockPoolRegistry());
        address newPm = address(new MockPolicyManager());
        address newCat = address(new MockBackstopPool(owner));
        address newLd = address(new MockLossDistributor());
        address newRd = address(new MockRewardDistributor());
        address newUm = address(new MockUnderwriterManager());

        // Act & Assert
        vm.expectEmit(true, true, true, true);
        emit AddressesSet(newCp, newPr, newPm, newCat, newLd, newRd, newUm);
        rm.setAddresses(newCp, newPr, newPm, newCat, newLd, newRd, newUm);

        assertEq(address(rm.capitalPool()), newCp);
        assertEq(address(rm.poolRegistry()), newPr);
        assertEq(rm.policyManager(), newPm);
        assertEq(address(rm.catPool()), newCat);
        assertEq(address(rm.lossDistributor()), newLd);
        assertEq(address(rm.rewardDistributor()), newRd);
        assertEq(address(rm.underwriterManager()), newUm);
    }

    function testRevert_setAddresses_ifNotOwner() public {
        vm.prank(otherUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otherUser));
        rm.setAddresses(address(cp), address(pr), address(pm), address(cat), address(ld), address(rd), address(um));
    }

    function testRevert_setAddresses_ifAnyAddressIsZero() public {
        address nonZero = address(0x1);
        vm.expectRevert(RiskManager.ZeroAddressNotAllowed.selector);
        rm.setAddresses(address(0), nonZero, nonZero, nonZero, nonZero, nonZero, nonZero);
        vm.expectRevert(RiskManager.ZeroAddressNotAllowed.selector);
        rm.setAddresses(nonZero, address(0), nonZero, nonZero, nonZero, nonZero, nonZero);
        vm.expectRevert(RiskManager.ZeroAddressNotAllowed.selector);
        rm.setAddresses(nonZero, nonZero, address(0), nonZero, nonZero, nonZero, nonZero);
        vm.expectRevert(RiskManager.ZeroAddressNotAllowed.selector);
        rm.setAddresses(nonZero, nonZero, nonZero, address(0), nonZero, nonZero, nonZero);
        vm.expectRevert(RiskManager.ZeroAddressNotAllowed.selector);
        rm.setAddresses(nonZero, nonZero, nonZero, nonZero, address(0), nonZero, nonZero);
        vm.expectRevert(RiskManager.ZeroAddressNotAllowed.selector);
        rm.setAddresses(nonZero, nonZero, nonZero, nonZero, nonZero, address(0), nonZero);
        vm.expectRevert(RiskManager.ZeroAddressNotAllowed.selector);
        rm.setAddresses(nonZero, nonZero, nonZero, nonZero, nonZero, nonZero, address(0));
    }

    function test_setCommittee_succeeds_and_emits_event() public {
        address newCommittee = address(0xC0FFEE);
        vm.expectEmit(true, false, false, true);
        emit CommitteeSet(newCommittee);
        rm.setCommittee(newCommittee);
        assertEq(rm.committee(), newCommittee);
    }

    function testRevert_setCommittee_ifNotOwner() public {
        vm.prank(otherUser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, otherUser));
        rm.setCommittee(address(0xC0FFEE));
    }

    function testRevert_setCommittee_ifZeroAddress() public {
        vm.expectRevert(RiskManager.ZeroAddressNotAllowed.selector);
        rm.setCommittee(address(0));
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* PROCESS CLAIM                                  */
    /*.•°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.*/

    function test_processClaim_succeeds_fullyCovered() public {
        // --- Arrange ---
        uint256 coverage = 50_000e6;
        uint256 totalPledge = 100_000e6;

        _setupPolicy(DEFAULT_POLICY_ID, DEFAULT_POOL_ID, coverage, claimant, block.timestamp - 1 days);
        _setupPool(DEFAULT_POOL_ID, totalPledge, coverage, committee);
        _mockPremiumPayment(claimant, coverage);

        // --- Act ---
        vm.prank(claimant);
        rm.processClaim(DEFAULT_POLICY_ID);

        // --- Assert ---
        assertEq(rd.distributeCallCount(), 1, "RewardDistributor.distribute should be called once");
        assertEq(ld.distributeLossCallCount(), 1, "LossDistributor.distributeLoss should be called once");
        assertEq(cp.executePayoutCallCount(), 1, "CapitalPool.executePayout should be called once");
        assertEq(pr.updateCapitalAllocationCallCount(), 1, "PoolRegistry.updateCapitalAllocation should be called once");
        assertEq(nft.burnCallCount(), 1, "Policy NFT should be burned");
    }

    function test_processClaim_succeeds_withShortfall_and_drawsFromCatPool() public {
        // --- Arrange ---
        uint256 totalPledgeInPool = 50_000e6;
        uint256 coverageAmount = 80_000e6;
        uint256 expectedShortfall = coverageAmount - totalPledgeInPool;

        _setupPolicy(DEFAULT_POLICY_ID, DEFAULT_POOL_ID, coverageAmount, claimant, block.timestamp - 1 days);
        _setupPool(DEFAULT_POOL_ID, totalPledgeInPool, coverageAmount, committee);
        _mockPremiumPayment(claimant, coverageAmount);

        // --- Act ---
        vm.prank(claimant);
        rm.processClaim(DEFAULT_POLICY_ID);

        // --- Assert ---
        assertEq(cat.drawFundCallCount(), 1, "BackstopPool.drawFund should be called for shortfall");
        assertEq(cat.last_drawFund_amount(), expectedShortfall, "Incorrect shortfall amount drawn from backstop");
    }

    function test_processClaim_succeeds_withMultipleAdapters() public {
        // --- Arrange ---
        uint256 coverage = 100_000e6;
        uint256 totalPledge = 200_000e6;
        _setupPolicy(DEFAULT_POLICY_ID, DEFAULT_POOL_ID, coverage, claimant, block.timestamp - 1 days);

        address[] memory adapters = new address[](2);
        adapters[0] = address(0xA1);
        adapters[1] = address(0xA2);
        uint256[] memory capitalPerAdapter = new uint256[](2);
        capitalPerAdapter[0] = 75_000e6;
        capitalPerAdapter[1] = 125_000e6;
        pr.setPoolPayoutData(DEFAULT_POOL_ID, adapters, capitalPerAdapter, totalPledge);
        pr.setPoolData(DEFAULT_POOL_ID, protocolToken, totalPledge, coverage, 0, false, committee, rm.CLAIM_FEE_BPS());
        _mockPremiumPayment(claimant, coverage);

        // --- Act ---
        vm.prank(claimant);
        rm.processClaim(DEFAULT_POLICY_ID);

        // --- Assert ---
        assertEq(pr.updateCapitalAllocationCallCount(), 2, "Should update allocation for each adapter");
    }

    function test_processClaim_succeeds_withZeroCoverage() public {
        // --- Arrange ---
        uint256 coverage = 0;
        _setupPolicy(DEFAULT_POLICY_ID, DEFAULT_POOL_ID, coverage, claimant, block.timestamp - 1 days);
        _setupPool(DEFAULT_POOL_ID, 100_000e6, 0, committee);

        // --- Act ---
        vm.prank(claimant);
        rm.processClaim(DEFAULT_POLICY_ID);

        // --- Assert ---
        assertEq(rd.distributeCallCount(), 0, "Premium distribution should be skipped");
        assertEq(ld.distributeLossCallCount(), 1, "Loss distribution is still called");
        assertEq(cp.executePayoutCallCount(), 1, "Payout is still called");
        assertEq(cat.drawFundCallCount(), 0, "Backstop should not be called");
        assertEq(nft.burnCallCount(), 1, "NFT should still be burned");
    }

    function test_processClaim_succeeds_whenFeeExceedsCoverage() public {
        // --- Arrange ---
        uint256 coverage = 100e6;
        uint256 highFeeBps = 10000; // 100% fee
        _setupPolicy(DEFAULT_POLICY_ID, DEFAULT_POOL_ID, coverage, claimant, block.timestamp - 1 days);
        _setupPool(DEFAULT_POOL_ID, 100_000e6, coverage, committee, highFeeBps);
        _mockPremiumPayment(claimant, coverage);

        // --- Act ---
        vm.prank(claimant);
        rm.processClaim(DEFAULT_POLICY_ID);

        // --- Assert ---
        ICapitalPool.PayoutData memory payoutData = cp.last_executePayout_payoutData();
        assertEq(payoutData.claimantAmount, 0, "Claimant payout should be 0 when fee >= coverage");
        assertEq(payoutData.feeAmount, coverage, "Fee should be the full coverage amount");
    }

    function testRevert_processClaim_ifNotPolicyOwner() public {
        // --- Arrange ---
        _setupPolicy(DEFAULT_POLICY_ID, DEFAULT_POOL_ID, 1e6, claimant, block.timestamp - 1 days);
        _setupPool(DEFAULT_POOL_ID, 100_000e6, 1e6, committee);
        
        // --- Act & Assert ---
        vm.prank(otherUser);
        vm.expectRevert(RiskManager.OnlyPolicyOwner.selector);
        rm.processClaim(DEFAULT_POLICY_ID);
    }

    function testRevert_processClaim_ifPolicyNotActive() public {
        // --- Arrange ---
        _setupPolicy(DEFAULT_POLICY_ID, DEFAULT_POOL_ID, 1e6, claimant, block.timestamp + 1 days); // Future activation
        _setupPool(DEFAULT_POOL_ID, 100_000e6, 1e6, committee);

        // --- Act & Assert ---
        vm.prank(claimant);
        // FIX: Expect the custom error, not a string revert.
        vm.expectRevert(RiskManager.PolicyNotActive.selector);
        rm.processClaim(DEFAULT_POLICY_ID);
    }

    function testRevert_processClaim_onReentrancy() public {
        // --- Arrange ---
        ReentrancyAttacker attacker = new ReentrancyAttacker(address(usdc));
        _setupPolicy(DEFAULT_POLICY_ID, DEFAULT_POOL_ID, 1000e6, address(attacker), block.timestamp - 1 days);
        _setupPool(DEFAULT_POOL_ID, 1_000_000e6, 1000e6, committee);
        _mockPremiumPayment(address(attacker), 1000e6);
        
        // Set the attacker as the capital pool to simulate re-entrancy on payout
        rm.setAddresses(address(attacker), address(pr), address(pm), address(cat), address(ld), address(rd), address(um));
        attacker.setTarget(address(rm));
        attacker.setAttackData(abi.encodeWithSelector(RiskManager.processClaim.selector, DEFAULT_POLICY_ID));

        // --- Act & Assert ---
        vm.prank(address(attacker));
        vm.expectRevert(bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        rm.processClaim(DEFAULT_POLICY_ID);
    }


    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* LIQUIDATE INSOLVENT UNDERWRITER                        */
    /*.•°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.*/

    function test_liquidateInsolventUnderwriter_succeeds() public {
        // --- Arrange ---
        uint256[] memory allocs = new uint256[](1);
        allocs[0] = DEFAULT_POOL_ID;
        um.setUnderwriterAllocations(underwriter, allocs);
        cp.setUnderwriterAccount(underwriter, 0, 10_000e6, 0, 0);
        cp.setSharesToValue(10_000e6, 10_000e6);
        ld.setPendingLosses(underwriter, DEFAULT_POOL_ID, 0, 15_000e6);

        // --- Act & Assert ---
        vm.expectEmit(true, true, false, false);
        emit UnderwriterLiquidated(liquidator, underwriter);
        vm.prank(liquidator);
        rm.liquidateInsolventUnderwriter(underwriter);

        assertEq(um.realizeLossesForAllPoolsCallCount(), 1, "Should call to realize losses");
        assertEq(um.last_realizeLossesForAllPools_user(), underwriter, "Realizing losses for wrong underwriter");
    }

    function testRevert_liquidateInsolventUnderwriter_ifSolvent() public {
        // --- Arrange ---
        cp.setUnderwriterAccount(underwriter, 0, 10_000e6, 0, 0);
        cp.setSharesToValue(10_000e6, 10_000e6);
        ld.setPendingLosses(underwriter, DEFAULT_POOL_ID, 0, 5_000e6);

        // --- Act & Assert ---
        vm.prank(liquidator);
        vm.expectRevert(RiskManager.UnderwriterNotInsolvent.selector);
        rm.liquidateInsolventUnderwriter(underwriter);
    }

    function testRevert_liquidateInsolventUnderwriter_ifNoShares() public {
        // --- Arrange ---
        cp.setUnderwriterAccount(underwriter, 0, 0, 0, 0);
        ld.setPendingLosses(underwriter, DEFAULT_POOL_ID, 0, 5_000e6);

        // --- Act & Assert ---
        vm.prank(liquidator);
        vm.expectRevert(RiskManager.UnderwriterNotInsolvent.selector);
        rm.liquidateInsolventUnderwriter(underwriter);
    }

    function testRevert_liquidateInsolventUnderwriter_onReentrancy() public {
        // --- Arrange ---
        ReentrancyAttacker attacker = new ReentrancyAttacker(address(usdc));
        address attackerAddress = address(attacker);

        // Set the attacker as the underwriter manager
        rm.setAddresses(address(cp), address(pr), address(pm), address(cat), address(ld), address(rd), address(attacker));

        uint256[] memory allocs = new uint256[](1);
        allocs[0] = DEFAULT_POOL_ID;
        
        // Set up the attacker mock with the necessary state for the insolvency check to pass
        attacker.setUnderwriterAllocations(attackerAddress, allocs);
        cp.setUnderwriterAccount(attackerAddress, 0, 10_000e6, 0, 0);
        cp.setSharesToValue(10_000e6, 10_000e6);
        ld.setPendingLosses(attackerAddress, DEFAULT_POOL_ID, 0, 15_000e6);

        attacker.setTarget(address(rm));
        attacker.setAttackData(
            abi.encodeWithSelector(RiskManager.liquidateInsolventUnderwriter.selector, attackerAddress)
        );

        // --- Act & Assert ---
        vm.prank(liquidator);
        vm.expectRevert(bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        rm.liquidateInsolventUnderwriter(attackerAddress);
    }


    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* RESTRICTED FUNCTIONS                              */
    /*.•°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.*/

    function test_updateCoverageSold_succeeds_whenCalledByPolicyManager() public {
        // Arrange
        uint256 amount = 100_000e6;

        // Act & Assert
        vm.prank(address(pm));
        rm.updateCoverageSold(DEFAULT_POOL_ID, amount, true); // Should not revert

        vm.prank(address(pm));
        rm.updateCoverageSold(DEFAULT_POOL_ID, amount, false); // Should not revert
    }

    function testRevert_updateCoverageSold_ifNotPolicyManager() public {
        vm.prank(otherUser);
        vm.expectRevert(RiskManager.NotPolicyManager.selector);
        rm.updateCoverageSold(DEFAULT_POOL_ID, 100, true);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:*/
    /* INTERNAL HELPERS                                */
    /*.•°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.˚:*.´•*.°•.°:°.´+˚.*°.*/

    function _setupPolicy(
        uint256 policyId,
        uint256 poolId,
        uint256 coverage,
        address policyOwner,
        uint256 activationTimestamp
    ) internal {
        // Use the flexible helper that allows setting all policy fields so
        // tests can control the activation timestamp. The mock function also
        // assigns the owner, so a separate `setOwnerOf` call is unnecessary.
        nft.mock_setPolicy(
            policyId,
            policyOwner,
            poolId,
            coverage,
            activationTimestamp, // start
            activationTimestamp, // activation
            0,
            0
        );
    }

    function _setupPool(
        uint256 poolId,
        uint256 totalPledge,
        uint256 totalCoverageSold,
        address feeRecipient
    ) internal {
        _setupPool(poolId, totalPledge, totalCoverageSold, feeRecipient, rm.CLAIM_FEE_BPS());
    }

    function _setupPool(
        uint256 poolId,
        uint256 totalPledge,
        uint256 totalCoverageSold,
        address feeRecipient,
        uint256 feeBps
    ) internal {
        address[] memory adapters = new address[](1);
        adapters[0] = address(0xA1);
        uint256[] memory capitalPerAdapter = new uint256[](1);
        capitalPerAdapter[0] = totalPledge;
   pr.setPoolData(poolId, protocolToken, totalPledge, totalCoverageSold, 0, true, feeRecipient, feeBps);
   pr.setPoolPayoutData(poolId, adapters, capitalPerAdapter, totalPledge);
    }

    function _mockPremiumPayment(address from, uint256 coverage) internal {
        uint256 protocolCoverage = coverage * 1e12;
        protocolToken.mint(from, protocolCoverage);
        vm.startPrank(from);
        protocolToken.approve(address(rm), protocolCoverage);
        vm.stopPrank();
    }
}


/// @dev A malicious contract for testing re-entrancy vulnerabilities.
/// It can act as a CapitalPool or an UnderwriterManager for testing purposes.
contract ReentrancyAttacker is ICapitalPool, IUnderwriterManager {
    address public target;
    bytes public attackData;
    mapping(address => uint256[]) private allocations;
    IERC20 private immutable underlying;

    constructor(address _underlying) {
        underlying = IERC20(_underlying);
    }

    function setTarget(address _target) external {
        target = _target;
    }

    function setAttackData(bytes memory _attackData) external {
        attackData = _attackData;
    }
    
    function setUnderwriterAllocations(address user, uint256[] calldata allocs) external {
        uint256[] memory memAllocs = new uint256[](allocs.length);
        for(uint i = 0; i < allocs.length; i++){
            memAllocs[i] = allocs[i];
        }
        allocations[user] = memAllocs;
    }

    // --- Re-entrancy Trigger via ICapitalPool ---
    function executePayout(PayoutData calldata) external override {
        if (address(target) != address(0) && attackData.length > 0) {
            (bool success, bytes memory reason) = target.call(attackData);
            if (!success) {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
        }
    }

    // --- Re-entrancy Trigger via IUnderwriterManager ---
    function realizeLossesForAllPools(address) external override {
        if (address(target) != address(0) && attackData.length > 0) {
            (bool success, bytes memory reason) = target.call(attackData);
            if (!success) {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
        }
    }

    // --- Unused Interface Functions (Implemented to satisfy compiler) ---
    function underlyingAsset() external view override returns (IERC20) { return underlying; }
    function getUnderwriterAccount(address) external view override returns (uint256, YieldPlatform, uint256, uint256) { return (0, YieldPlatform.NONE, 0, 0); }
    function sharesToValue(uint256) external view override returns (uint256) { return 0; }
    function getUnderwriterAllocations(address user) external view override returns (uint256[] memory) { return allocations[user]; }
    function underwriterPoolPledge(address, uint256) external view override returns (uint256) { return 0; }
    function deposit(uint256, YieldPlatform) external override {}
    function getUnderwriterAdapterAddress(address) external view override returns(address) { return address(0); }
    function applyLosses(address, uint256) external override {}
    function onCapitalDeposited(address, uint256) external override {}
    function onWithdrawalRequested(address, uint256) external override {}
    function onWithdrawalCancelled(address, uint256) external override {}
    function onCapitalWithdrawn(address, uint256, bool) external override {}
}
