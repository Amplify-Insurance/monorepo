// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {RiskManager} from "contracts/core/RiskManager.sol";
import {MockCapitalPool} from "contracts/test/MockCapitalPool.sol";
import {MockPoolRegistry} from "contracts/test/MockPoolRegistry.sol";
import {MockPolicyNFT} from "contracts/test/MockPolicyNFT.sol";
import {MockBackstopPool} from "contracts/test/MockBackstopPool.sol";
import {MockLossDistributor} from "contracts/test/MockLossDistributor.sol";
import {MockPolicyManager} from "contracts/test/MockPolicyManager.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";

contract RiskManagerTest is Test {
    RiskManager rm;
    MockCapitalPool cp;
    MockPoolRegistry pr;
    MockPolicyNFT nft;
    MockBackstopPool cat;
    MockLossDistributor ld;
    MockPolicyManager pm;
    MockRewardDistributor rd;
    MockERC20 token;

    address committee = address(0xBEEF);
    address underwriter = address(0xFACE);

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        cp = new MockCapitalPool(address(this), address(token));
        pr = new MockPoolRegistry();
        nft = new MockPolicyNFT(address(this));
        pm = new MockPolicyManager();
        pm.setPolicyNFT(address(nft));
        cat = new MockBackstopPool(address(this));
        ld = new MockLossDistributor();
        rd = new MockRewardDistributor();
        rm = new RiskManager(address(this));
        rd.setCatPool(address(cat));

        rm.setAddresses(address(cp), address(pr), address(pm), address(cat), address(ld), address(rd));
        rm.setCommittee(committee);
    }

    function testAllocateCapital() public {
        uint256 pledge = 10_000 * 1e6;
        cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
        cp.setUnderwriterAdapterAddress(underwriter, address(1));
        pr.setPoolCount(2);

        uint256[] memory pools = new uint256[](2);
        pools[0] = 0;
        pools[1] = 1;

        vm.prank(underwriter);
        rm.allocateCapital(pools);

        assertTrue(rm.isAllocatedToPool(underwriter, 0));
        assertTrue(rm.isAllocatedToPool(underwriter, 1));
    }

    function testDeallocateFromPool() public {
        uint256 pledge = 5_000 * 1e6;
        cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
        cp.setUnderwriterAdapterAddress(underwriter, address(1));
        pr.setPoolCount(1);
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);

        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        vm.prank(underwriter);
        rm.allocateCapital(pools);

        ld.setPendingLoss(underwriter, 0, 0);
        vm.prank(underwriter);
        rm.requestDeallocateFromPool(0, 5000 * 1e6);
        vm.prank(underwriter);
        rm.deallocateFromPool(0);

        assertFalse(rm.isAllocatedToPool(underwriter, 0));
    }


function testAllocateCapitalRevertsWithoutDeposit() public {
    cp.setUnderwriterAdapterAddress(underwriter, address(1));
    pr.setPoolCount(1);
    uint256[] memory pools = new uint256[](1);
    pools[0] = 0;
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.NoCapitalToAllocate.selector);
    rm.allocateCapital(pools);
}

function testAllocateCapitalRevertsWithoutAdapter() public {
    cp.triggerOnCapitalDeposited(address(rm), underwriter, 1000);
    pr.setPoolCount(1);
    uint256[] memory pools = new uint256[](1);
    pools[0] = 0;
    vm.prank(underwriter);
    vm.expectRevert("User has no yield adapter set in CapitalPool");
    rm.allocateCapital(pools);
}

function testAllocateCapitalRevertsInvalidPoolId() public {
    cp.triggerOnCapitalDeposited(address(rm), underwriter, 1000);
    cp.setUnderwriterAdapterAddress(underwriter, address(1));
    pr.setPoolCount(1);
    pr.setPoolData(0, token, 1000, 0, 0, false, address(0), 0);
    uint256[] memory pools = new uint256[](1);
    pools[0] = 1;
    vm.prank(underwriter);
    vm.expectRevert("Invalid poolId");
    rm.allocateCapital(pools);
}

function testDeallocateRealizesLoss() public {
    cp.triggerOnCapitalDeposited(address(rm), underwriter, 1000);
    cp.setUnderwriterAdapterAddress(underwriter, address(1));
    pr.setPoolCount(1);
    uint256[] memory pools = new uint256[](1);
    pools[0] = 0;
    vm.prank(underwriter);
    rm.allocateCapital(pools);

    ld.setPendingLoss(underwriter, 0, 200);
    vm.prank(underwriter);
    rm.requestDeallocateFromPool(0, 500);
    vm.prank(underwriter);
    rm.deallocateFromPool(0);

    assertEq(cp.applyLossesCallCount(), 1);
    assertEq(cp.last_applyLosses_underwriter(), underwriter);
    assertEq(cp.last_applyLosses_principalLossAmount(), 200);
    assertEq(rm.underwriterTotalPledge(underwriter), 800);
}

function testClaimPremiumRewards() public {
    cp.triggerOnCapitalDeposited(address(rm), underwriter, 1000);
    pr.setPoolData(0, token, 0, 0, 0, false, address(0), 0);
    uint256[] memory ids = new uint256[](1);
    ids[0] = 0;
    vm.prank(underwriter);
    rm.claimPremiumRewards(ids);
    assertEq(rd.claimCallCount(), 1);
    assertEq(rd.lastClaimUser(), underwriter);
    assertEq(rd.lastClaimPoolId(), 0);
    assertEq(rd.lastClaimToken(), address(token));
    assertEq(rd.lastClaimPledge(), 1000);
}

function testClaimDistressedAssets() public {
    pr.setPoolData(0, token, 0, 0, 0, false, address(0), 0);
    uint256[] memory ids2 = new uint256[](1);
    ids2[0] = 0;
    vm.prank(underwriter);
    rm.claimDistressedAssets(ids2);
    assertEq(cat.claimProtocolRewardsCallCount(), 1);
    assertEq(cat.last_claimProtocolToken(), address(token));
}

function testUpdateCoverageSoldOnlyPolicyManager() public {
    pr.setPoolData(0, token, 0, 0, 0, false, address(0), 0);
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.NotPolicyManager.selector);
    rm.updateCoverageSold(0, 100, true);

    vm.prank(address(pm));
    rm.updateCoverageSold(0, 100, true);
    (, , uint256 sold,, , ,) = pr.getPoolData(0);
    assertEq(sold, 100);
}

function testReportIncidentOnlyCommittee() public {
    pr.setPoolCount(1);
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.NotCommittee.selector);
    rm.reportIncident(0, true);

    vm.prank(committee);
    rm.reportIncident(0, true);
    (, , , , bool paused,,) = pr.getPoolData(0);
    assertTrue(paused);
}

function testSetPoolFeeRecipientOnlyCommittee() public {
    pr.setPoolCount(1);
    address recipient = address(123);
    vm.prank(underwriter);
    vm.expectRevert(RiskManager.NotCommittee.selector);
    rm.setPoolFeeRecipient(0, recipient);

    vm.prank(committee);
    rm.setPoolFeeRecipient(0, recipient);
    (, , , , , address feeRecipient,) = pr.getPoolData(0);
    assertEq(feeRecipient, recipient);
}

function testOnCapitalDepositedOnlyCapitalPool() public {
    vm.expectRevert(RiskManager.NotCapitalPool.selector);
    rm.onCapitalDeposited(underwriter, 500);

    cp.triggerOnCapitalDeposited(address(rm), underwriter, 500);
    assertEq(rm.underwriterTotalPledge(underwriter), 500);
}
}
