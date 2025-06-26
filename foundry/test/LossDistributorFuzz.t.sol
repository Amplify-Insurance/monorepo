// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";

contract LossDistributorFuzz is Test {
    LossDistributor ld;
    address constant RISK_MANAGER = address(0x1234);

    address constant USER1 = address(0x1);
    address constant USER2 = address(0x2);

    function setUp() public {
        ld = new LossDistributor(RISK_MANAGER);
    }

    function _distribute(uint256 poolId, uint256 loss, uint256 total) internal {
        vm.prank(RISK_MANAGER);
        ld.distributeLoss(poolId, loss, total);
    }

    function _realize(address user, uint256 poolId, uint256 pledge) internal returns (uint256) {
        vm.prank(RISK_MANAGER);
        return ld.realizeLosses(user, poolId, pledge);
    }

    function testFuzz_distributeLossAccumulates(uint256 poolId, uint96 lossAmount, uint96 totalPledge) public {
        vm.assume(lossAmount > 0 && totalPledge > 0);
        _distribute(poolId, lossAmount, totalPledge);
        uint256 expected = uint256(lossAmount) * ld.PRECISION_FACTOR() / totalPledge;
        assertEq(ld.poolLossTrackers(poolId), expected);
    }

    function testFuzz_realizeLossesUpdatesState(uint256 poolId, uint96 lossAmount, uint96 totalPledge, uint96 userPledge) public {
        vm.assume(lossAmount > 0 && totalPledge > 0 && userPledge > 0);

        _distribute(poolId, lossAmount, totalPledge);
        uint256 lossPerShare = uint256(lossAmount) * ld.PRECISION_FACTOR() / totalPledge;
        uint256 expected = uint256(userPledge) * lossPerShare / ld.PRECISION_FACTOR();

        uint256 realized = _realize(USER1, poolId, userPledge);
        assertEq(realized, expected);
        assertEq(ld.userLossStates(USER1, poolId), expected);
        assertEq(ld.getPendingLosses(USER1, poolId, userPledge), 0);
    }

    function testFuzz_realizeLossesAcrossMultipleDistributions(
        uint256 poolId,
        uint96 loss1,
        uint96 total1,
        uint96 loss2,
        uint96 total2,
        uint96 userPledge
    ) public {
        vm.assume(loss1 > 0 && total1 > 0 && loss2 > 0 && total2 > 0 && userPledge > 0);

        _distribute(poolId, loss1, total1);
        uint256 perShare1 = uint256(loss1) * ld.PRECISION_FACTOR() / total1;
        uint256 expected1 = uint256(userPledge) * perShare1 / ld.PRECISION_FACTOR();
        assertEq(_realize(USER1, poolId, userPledge), expected1);

        _distribute(poolId, loss2, total2);
        uint256 perShare2 = uint256(loss2) * ld.PRECISION_FACTOR() / total2;
        uint256 expected2 = uint256(userPledge) * perShare2 / ld.PRECISION_FACTOR();
        assertEq(_realize(USER1, poolId, userPledge), expected2);

        assertEq(ld.getPendingLosses(USER1, poolId, userPledge), 0);
    }

    function testFuzz_usersIndependent(
        uint256 poolId,
        uint96 lossAmount,
        uint96 totalPledge,
        uint96 pledge1,
        uint96 pledge2
    ) public {
        vm.assume(lossAmount > 0 && totalPledge > 0 && pledge1 > 0 && pledge2 > 0);

        _distribute(poolId, lossAmount, totalPledge);
        uint256 pending2Before = ld.getPendingLosses(USER2, poolId, pledge2);
        _realize(USER1, poolId, pledge1);
        uint256 pending2After = ld.getPendingLosses(USER2, poolId, pledge2);
        assertEq(pending2After, pending2Before);
    }
}

