// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {StakingContract} from "contracts/governance/Staking.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";

contract StakingFuzz is Test {
    StakingContract staking;
    MockERC20 token;

    address owner = address(0x1);
    address committee = address(0x2);
    address staker = address(0x3);
    address otherStaker = address(0x4);

    function setUp() public {
        token = new MockERC20("Gov", "GOV", 18);
        token.mint(staker, 1000 ether);
        token.mint(otherStaker, 1000 ether);

        staking = new StakingContract(address(token), owner);

        vm.prank(staker);
        token.approve(address(staking), type(uint256).max);
        vm.prank(otherStaker);
        token.approve(address(staking), type(uint256).max);
    }

    function testFuzz_stakeUnstake(uint96 amount) public {
        vm.assume(amount > 0 && amount <= 1000 ether);
        vm.prank(staker);
        staking.stake(amount);

        assertEq(staking.stakedBalance(staker), amount);
        assertEq(staking.totalStaked(), amount);

        vm.prank(staker);
        staking.unstake(amount);

        assertEq(staking.stakedBalance(staker), 0);
        assertEq(staking.totalStaked(), 0);
        assertEq(token.balanceOf(staker), 1000 ether);
    }

    function testFuzz_stakeTwice(uint96 amt1, uint96 amt2) public {
        vm.assume(amt1 > 0 && amt1 <= 1000 ether);
        vm.assume(amt2 > 0 && uint256(amt1) + uint256(amt2) <= 1000 ether);

        vm.prank(staker);
        staking.stake(amt1);
        vm.prank(staker);
        staking.stake(amt2);

        uint256 total = uint256(amt1) + uint256(amt2);
        assertEq(staking.stakedBalance(staker), total);
        assertEq(staking.totalStaked(), total);
    }

    function testFuzz_multipleStakersTotals(uint96 amt1, uint96 amt2) public {
        vm.assume(amt1 > 0 && amt1 <= 1000 ether);
        vm.assume(amt2 > 0 && amt2 <= 1000 ether);

        vm.prank(staker);
        staking.stake(amt1);
        vm.prank(otherStaker);
        staking.stake(amt2);

        assertEq(staking.stakedBalance(staker), amt1);
        assertEq(staking.stakedBalance(otherStaker), amt2);
        assertEq(staking.totalStaked(), amt1 + amt2);
    }

    function testFuzz_slash(uint96 stakeAmt, uint96 slashAmt) public {
        vm.assume(stakeAmt > 0 && stakeAmt <= 1000 ether);
        vm.assume(slashAmt > 0 && slashAmt <= stakeAmt);

        vm.prank(owner);
        staking.setCommitteeAddress(committee);

        vm.prank(staker);
        staking.stake(stakeAmt);

        vm.prank(committee);
        staking.slash(staker, slashAmt);

        uint256 remaining = stakeAmt - slashAmt;
        assertEq(staking.stakedBalance(staker), remaining);
        assertEq(staking.totalStaked(), remaining);
        assertEq(token.balanceOf(committee), slashAmt);
    }
}
