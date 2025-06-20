// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {StakingContract} from "contracts/governance/Staking.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";

contract StakingTest is Test {
    StakingContract staking;
    MockERC20 token;

    address owner = address(0x1);
    address committee = address(0x2);
    address staker = address(0x3);

    function setUp() public {
        token = new MockERC20("Gov", "GOV", 18);
        token.mint(staker, 1000 ether);

        staking = new StakingContract(address(token), owner);

        vm.prank(staker);
        token.approve(address(staking), type(uint256).max);
    }

    function testStake() public {
        vm.prank(staker);
        staking.stake(100 ether);

        assertEq(staking.stakedBalance(staker), 100 ether);
        assertEq(staking.totalStaked(), 100 ether);
        assertEq(token.balanceOf(address(staking)), 100 ether);
    }

    function testStakeAndUnstake() public {
        vm.startPrank(staker);
        staking.stake(50 ether);
        staking.unstake(20 ether);
        vm.stopPrank();

        assertEq(staking.stakedBalance(staker), 30 ether);
        assertEq(staking.totalStaked(), 30 ether);
        assertEq(token.balanceOf(staker), 1000 ether - 30 ether);
    }

    function testSlash() public {
        vm.prank(owner);
        staking.setCommitteeAddress(committee);

        vm.prank(staker);
        staking.stake(80 ether);

        vm.prank(committee);
        staking.slash(staker, 30 ether);

        assertEq(staking.stakedBalance(staker), 50 ether);
        assertEq(token.balanceOf(committee), 30 ether);
    }

    function testCannotUnstakeTooMuch() public {
        vm.prank(staker);
        staking.stake(10 ether);

        vm.prank(staker);
        vm.expectRevert(StakingContract.InsufficientStakedBalance.selector);
        staking.unstake(20 ether);
    }

    function testCannotSlashWhenNotCommittee() public {
        vm.prank(staker);
        staking.stake(10 ether);

        vm.prank(staker);
        vm.expectRevert(StakingContract.NotCommittee.selector);
        staking.slash(staker, 5 ether);
    }
}
