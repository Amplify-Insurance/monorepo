// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";

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
}
