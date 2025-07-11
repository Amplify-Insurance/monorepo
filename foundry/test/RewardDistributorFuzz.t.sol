// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";

contract RewardDistributorFuzz is Test {
    RewardDistributor rd;
    MockERC20 token;

    address owner = address(this);
    address riskManager = address(0x1);
    address policyManager = address(0x2);
    address catPool = address(0x3);
    address user = address(0x4);

    uint256 constant PRECISION = 1e18;

    function setUp() public {
        rd = new RewardDistributor(riskManager, policyManager);
        token = new MockERC20("Reward", "RWD", 18);
        token.mint(address(rd), 1e60);
    }

    function _distribute(uint256 poolId, uint96 amount, uint96 total) internal {
        vm.prank(riskManager);
        rd.distribute(poolId, address(token), amount, total);
    }

    function _update(address u, uint256 poolId, uint96 pledge) internal {
        vm.prank(riskManager);
        rd.updateUserState(u, poolId, address(token), pledge);
    }

    function testFuzz_distributeAccumulates(uint256 poolId, uint96 r1, uint96 r2, uint96 total) public {
        vm.assume(total > 0 && r1 > 0 && r2 > 0);
        _distribute(poolId, r1, total);
        _distribute(poolId, r2, total);
        uint256 expected = (uint256(r1) * PRECISION) / total;
        expected += (uint256(r2) * PRECISION) / total;
        assertEq(rd.poolRewardTrackers(poolId, address(token)), expected);
    }

    function testFuzz_distributeByPolicyManager(uint256 poolId, uint96 amt, uint96 total) public {
        vm.assume(amt > 0 && total > 0);
        vm.prank(policyManager);
        rd.distribute(poolId, address(token), amt, total);
        uint256 expected = (uint256(amt) * PRECISION) / total;
        assertEq(rd.poolRewardTrackers(poolId, address(token)), expected);
    }

    function testFuzz_claim(uint256 poolId, uint96 reward, uint96 total, uint96 pledge) public {
        vm.assume(reward > 0 && total > 0 && pledge > 0);
        _distribute(poolId, reward, total);
        _update(user, poolId, pledge);
        _distribute(poolId, reward, total);
        uint256 perShare = (uint256(reward) * PRECISION) / total;
        uint256 userDebt = (uint256(pledge) * perShare) / PRECISION;
        uint256 tracker = perShare * 2;
        uint256 expected = (uint256(pledge) * tracker) / PRECISION - userDebt;
        vm.prank(riskManager);
        uint256 claimed = rd.claim(user, poolId, address(token), pledge);
        assertEq(claimed, expected);
        assertEq(token.balanceOf(user), expected);
        assertEq(rd.pendingRewards(user, poolId, address(token), pledge), 0);
    }

    function testFuzz_claimForCatPool(uint256 poolId, uint96 reward, uint96 total, uint96 pledge) public {
        vm.assume(reward > 0 && total > 0 && pledge > 0);
        vm.prank(owner);
        rd.setCatPool(catPool);
        _distribute(poolId, reward, total);
        _update(user, poolId, pledge);
        _distribute(poolId, reward, total);
        uint256 perShare = (uint256(reward) * PRECISION) / total;
        uint256 userDebt = (uint256(pledge) * perShare) / PRECISION;
        uint256 tracker = perShare * 2;
        uint256 expected = (uint256(pledge) * tracker) / PRECISION - userDebt;
        vm.prank(catPool);
        uint256 claimed = rd.claimForCatPool(user, poolId, address(token), pledge);
        assertEq(claimed, expected);
    }

    function testFuzz_updateUserStateRecordsDebt(uint256 poolId, uint96 reward, uint96 total, uint96 pledge) public {
        vm.assume(total > 0);
        _distribute(poolId, reward, total);
        vm.prank(riskManager);
        rd.updateUserState(user, poolId, address(token), pledge);
        uint256 tracker = rd.poolRewardTrackers(poolId, address(token));
        uint256 expected = (uint256(pledge) * tracker) / PRECISION;
        assertEq(rd.userRewardStates(user, poolId, address(token)), expected);
    }

    function testFuzz_setRiskManager(address newRM) public {
        vm.assume(newRM != address(0));
        vm.prank(owner);
        rd.setRiskManager(newRM);
        assertEq(rd.riskManager(), newRM);
    }

    function testFuzz_setRiskManagerOnlyOwner(address newRM, address caller) public {
        vm.assume(newRM != address(0) && caller != owner);
        vm.prank(caller);
        vm.expectRevert();
        rd.setRiskManager(newRM);
    }

    function testFuzz_setRiskManagerZeroReverts() public {
        vm.prank(owner);
        vm.expectRevert(RewardDistributor.ZeroAddress.selector);
        rd.setRiskManager(address(0));
    }

    function testFuzz_setPolicyManager(address newPM) public {
        vm.assume(newPM != address(0));
        vm.prank(owner);
        rd.setPolicyManager(newPM);
        assertEq(rd.policyManager(), newPM);
    }

    function testFuzz_setPolicyManagerOnlyOwner(address newPM, address caller) public {
        vm.assume(newPM != address(0) && caller != owner);
        vm.prank(caller);
        vm.expectRevert();
        rd.setPolicyManager(newPM);
    }

    function testFuzz_setPolicyManagerZeroReverts() public {
        vm.prank(owner);
        vm.expectRevert(RewardDistributor.ZeroAddress.selector);
        rd.setPolicyManager(address(0));
    }

    function testFuzz_setCatPool(address newCat) public {
        vm.assume(newCat != address(0));
        vm.prank(owner);
        rd.setCatPool(newCat);
        assertEq(rd.catPool(), newCat);
    }
}
