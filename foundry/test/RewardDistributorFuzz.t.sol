// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";

contract RewardDistributorFuzz is Test {
    RewardDistributor rd;
    MockERC20 token;

    address constant RM = address(0x1);
    address constant PM = address(0x2);
    address constant USER = address(0x3);
    address owner = address(this);

    function setUp() public {
        rd = new RewardDistributor(RM, PM);
        token = new MockERC20("R", "R", 18);
        token.mint(address(rd), type(uint256).max);
    }

    function _distribute(uint256 poolId, uint96 reward, uint96 total) internal {
        vm.assume(reward > 0 && total > 0);
        vm.prank(RM);
        rd.distribute(poolId, address(token), reward, total);
    }

    function _update(uint256 poolId, uint96 pledge) internal {
        vm.prank(RM);
        rd.updateUserState(USER, poolId, address(token), pledge);
    }

    function testFuzz_distributeAccumulates(uint256 poolId, uint96 reward1, uint96 total1, uint96 reward2, uint96 total2) public {
        vm.assume(reward1 > 0 && reward2 > 0 && total1 > 0 && total2 > 0);
        _distribute(poolId, reward1, total1);
        _distribute(poolId, reward2, total2);
        uint256 tracker = rd.poolRewardTrackers(poolId, address(token));
        uint256 expected = (uint256(reward1) * rd.PRECISION_FACTOR() / total1) + (uint256(reward2) * rd.PRECISION_FACTOR() / total2);
        assertEq(tracker, expected);
    }

    function testFuzz_claimAfterUpdate(uint256 poolId, uint96 reward1, uint96 total1, uint96 userPledge, uint96 reward2, uint96 total2) public {
        vm.assume(userPledge > 0 && reward1 > 0 && reward2 > 0 && total1 > 0 && total2 > 0);
        _distribute(poolId, reward1, total1);
        _update(poolId, userPledge);
        _distribute(poolId, reward2, total2);
        uint256 pending = rd.pendingRewards(USER, poolId, address(token), userPledge);
        uint256 perShare1 = uint256(reward1) * rd.PRECISION_FACTOR() / total1;
        uint256 perShare2 = uint256(reward2) * rd.PRECISION_FACTOR() / total2;
        uint256 debt = uint256(userPledge) * perShare1 / rd.PRECISION_FACTOR();
        uint256 expected = (uint256(userPledge) * (perShare1 + perShare2) / rd.PRECISION_FACTOR()) - debt;
        assertEq(pending, expected);

        uint256 before = token.balanceOf(USER);
        vm.prank(RM);
        uint256 claimed = rd.claim(USER, poolId, address(token), userPledge);
        assertEq(claimed, expected);
        assertEq(token.balanceOf(USER) - before, expected);
    }

    function testFuzz_independentPools(uint96 reward, uint96 total, uint96 pledge) public {
        vm.assume(reward > 0 && total > 0 && pledge > 0);
        _distribute(1, reward, total);
        _update(1, pledge);
        _distribute(1, reward, total);

        _distribute(2, reward, total);
        _update(2, pledge);
        _distribute(2, reward, total);

        uint256 p1 = rd.pendingRewards(USER, 1, address(token), pledge);
        uint256 p2 = rd.pendingRewards(USER, 2, address(token), pledge);
        assertEq(p1, p2);
    }

    function testFuzz_setters(uint160 newRM, uint160 newPM, uint160 newCat) public {
        vm.assume(newRM != 0 && newPM != 0 && newCat != 0);

        vm.prank(owner);
        rd.setRiskManager(address(uint160(newRM)));
        assertEq(rd.riskManager(), address(uint160(newRM)));

        vm.prank(owner);
        rd.setPolicyManager(address(uint160(newPM)));
        assertEq(rd.policyManager(), address(uint160(newPM)));

        vm.prank(owner);
        rd.setCatPool(address(uint160(newCat)));
        assertEq(rd.catPool(), address(uint160(newCat)));
    }

    function testFuzz_claimForCatPool(uint96 reward, uint96 total, uint96 pledge) public {
        vm.assume(reward > 0 && total > 0 && pledge > 0);
        vm.prank(owner);
        rd.setCatPool(address(this));
        _distribute(1, reward, total);
        _update(1, pledge);
        _distribute(1, reward, total);
        uint256 pending = rd.pendingRewards(USER, 1, address(token), pledge);
        vm.prank(address(this));
        uint256 claimed = rd.claimForCatPool(USER, 1, address(token), pledge);
        assertEq(claimed, pending);
    }
}
