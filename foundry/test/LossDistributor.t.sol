// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract LossDistributorTest is Test {
    LossDistributor ld;
    address riskManager = address(0x1234);
    address user = address(0xABCD);

    function setUp() public {
        ld = new LossDistributor(riskManager);
    }

    function testOwnerAndRiskManagerSetOnDeploy() public {
        assertEq(ld.owner(), address(this));
        assertEq(ld.riskManager(), riskManager);
    }

    function testDistributeLossAccumulates() public {
        vm.prank(riskManager);
        ld.distributeLoss(1, 100, 1000);
        vm.prank(riskManager);
        ld.distributeLoss(1, 50, 1000);
        assertEq(ld.poolLossTrackers(1), 150 * 1e18 / 1000);
    }

    function testOnlyRiskManagerCanDistribute() public {
        vm.expectRevert(bytes("LD: Not RiskManager"));
        ld.distributeLoss(1, 1, 1);
    }

    function testRealizeLosses() public {
        vm.prank(riskManager);
        ld.distributeLoss(1, 100, 1000);
        vm.prank(riskManager);
        uint256 pending = ld.realizeLosses(user, 1, 500);
        assertEq(pending, 50);
        assertEq(ld.userLossStates(user, 1), 50);
    }

    function testConstructorRevertsOnZeroAddress() public {
        vm.expectRevert(LossDistributor.ZeroAddress.selector);
        new LossDistributor(address(0));
    }

    function testSetRiskManagerOnlyOwner() public {
        address newRM = address(0xBEEF);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        ld.setRiskManager(newRM);

        ld.setRiskManager(newRM);
        assertEq(ld.riskManager(), newRM);
    }

    function testSetRiskManagerZeroAddressReverts() public {
        vm.expectRevert(LossDistributor.ZeroAddress.selector);
        ld.setRiskManager(address(0));
    }

    function testDistributeLossZeroValues() public {
        vm.prank(riskManager);
        ld.distributeLoss(1, 0, 1000);
        vm.prank(riskManager);
        ld.distributeLoss(1, 100, 0);
        assertEq(ld.poolLossTrackers(1), 0);
    }

    function testGetPendingLossesMultipleDistributions() public {
        vm.startPrank(riskManager);
        ld.distributeLoss(1, 100, 1000);
        ld.distributeLoss(1, 50, 1000);
        vm.stopPrank();
        uint256 pending = ld.getPendingLosses(user, 1, 500);
        assertEq(pending, 75);
    }

    function testRealizeLossesAccumulatesAcrossCalls() public {
        vm.prank(riskManager);
        ld.distributeLoss(1, 100, 1000);
        vm.prank(riskManager);
        uint256 pending = ld.realizeLosses(user, 1, 500);
        assertEq(pending, 50);

        vm.prank(riskManager);
        ld.distributeLoss(1, 100, 1000);
        vm.prank(riskManager);
        pending = ld.realizeLosses(user, 1, 500);
        assertEq(pending, 50);
        assertEq(ld.userLossStates(user, 1), 100);
    }

    function testRealizeLossesNoPending() public {
        vm.prank(riskManager);
        uint256 pending = ld.realizeLosses(user, 1, 500);
        assertEq(pending, 0);
        assertEq(ld.userLossStates(user, 1), 0);
    }
}
