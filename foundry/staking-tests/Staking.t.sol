// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {StakingContract} from "contracts/governance/Staking.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {MockProposalFinalization} from "contracts/test/MockProposalFinalization.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract StakingTest is Test {
    StakingContract staking;
    MockERC20 token;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event CommitteeAddressSet(address indexed committeeAddress);

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

    function testStakeZeroReverts() public {
        vm.prank(staker);
        vm.expectRevert(StakingContract.InvalidAmount.selector);
        staking.stake(0);
    }

    function testUnstakeZeroReverts() public {
        vm.startPrank(staker);
        staking.stake(10 ether);
        vm.expectRevert(StakingContract.InvalidAmount.selector);
        staking.unstake(0);
        vm.stopPrank();
    }

    function testSlashZeroReverts() public {
        vm.prank(owner);
        staking.setCommitteeAddress(committee);

        vm.prank(staker);
        staking.stake(10 ether);

        vm.prank(committee);
        vm.expectRevert(StakingContract.InvalidAmount.selector);
        staking.slash(staker, 0);
    }

    function testSlashMoreThanStakedReverts() public {
        vm.prank(owner);
        staking.setCommitteeAddress(committee);

        vm.prank(staker);
        staking.stake(10 ether);

        vm.prank(committee);
        vm.expectRevert(StakingContract.InsufficientStakedBalance.selector);
        staking.slash(staker, 20 ether);
    }

    function testSlashNoStakeReverts() public {
        vm.prank(owner);
        staking.setCommitteeAddress(committee);

        vm.prank(committee);
        vm.expectRevert(StakingContract.InsufficientStakedBalance.selector);
        staking.slash(staker, 1 ether);
    }

    function testSetCommitteeAddressOnlyOwner() public {
        vm.prank(staker);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, staker)
        );
        staking.setCommitteeAddress(committee);

        vm.prank(owner);
        staking.setCommitteeAddress(committee);
        assertEq(staking.committeeAddress(), committee);
    }

    function testSetCommitteeAddressTwiceReverts() public {
        vm.prank(owner);
        staking.setCommitteeAddress(committee);

        vm.prank(owner);
        vm.expectRevert(bytes("Committee address already set"));
        staking.setCommitteeAddress(address(0x5));
    }

    function testSetCommitteeAddressZeroAddressReverts() public {
        vm.prank(owner);
        vm.expectRevert(StakingContract.ZeroAddress.selector);
        staking.setCommitteeAddress(address(0));
    }

    function testStakeEmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit Staked(staker, 100 ether);
        vm.prank(staker);
        staking.stake(100 ether);
    }

    function testUnstakeEmitsEvent() public {
        vm.startPrank(staker);
        staking.stake(50 ether);
        vm.expectEmit(true, false, false, true);
        emit Unstaked(staker, 20 ether);
        staking.unstake(20 ether);
        vm.stopPrank();
    }

    function testMultipleStakersTotal() public {
        vm.prank(staker);
        staking.stake(40 ether);

        vm.prank(otherStaker);
        staking.stake(60 ether);

        assertEq(staking.totalStaked(), 100 ether);
        assertEq(staking.stakedBalance(staker), 40 ether);
        assertEq(staking.stakedBalance(otherStaker), 60 ether);
    }

    function testConstructorZeroAddressReverts() public {
        vm.expectRevert(StakingContract.ZeroAddress.selector);
        new StakingContract(address(0), owner);
    }

    function testRecordVoteOnlyCommittee() public {
        vm.prank(staker);
        vm.expectRevert(StakingContract.NotCommittee.selector);
        staking.recordVote(staker, 1);
    }

    function testRecordVoteUpdatesState() public {
        MockProposalFinalization committeeMock = new MockProposalFinalization();
        vm.prank(owner);
        staking.setCommitteeAddress(address(committeeMock));
        committeeMock.callRecordVote(address(staking), staker, 42);
        assertEq(staking.lastVotedProposal(staker), 42);
    }

    function testUnstakeVoteLockActive() public {
        MockProposalFinalization committeeMock = new MockProposalFinalization();
        vm.prank(owner);
        staking.setCommitteeAddress(address(committeeMock));
        vm.prank(staker);
        staking.stake(100 ether);
        committeeMock.callRecordVote(address(staking), staker, 1);
        vm.prank(staker);
        vm.expectRevert(StakingContract.VoteLockActive.selector);
        staking.unstake(10 ether);
    }

    function testUnstakeAfterFinalizedResetsVote() public {
        MockProposalFinalization committeeMock = new MockProposalFinalization();
        vm.prank(owner);
        staking.setCommitteeAddress(address(committeeMock));
        vm.startPrank(staker);
        staking.stake(50 ether);
        committeeMock.callRecordVote(address(staking), staker, 1);
        committeeMock.setFinalized(true);
        staking.unstake(20 ether);
        vm.stopPrank();
        assertEq(staking.lastVotedProposal(staker), 0);
        assertEq(staking.lastVoteTime(staker), 0);
    }
}
