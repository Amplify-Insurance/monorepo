// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {CommitteeHarness} from "contracts/test/CommitteeHarness.sol";
import {Committee} from "contracts/governance/Committee.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {MockCommitteeRiskManager} from "contracts/test/MockCommitteeRiskManager.sol";
import {MockCommitteeStaking} from "contracts/test/MockCommitteeStaking.sol";

contract CommitteeFuzz is Test {
    CommitteeHarness committee;
    MockERC20 token;
    MockCommitteeRiskManager rm;
    MockCommitteeStaking staking;

    address proposer = address(0x1);
    address voter1 = address(0x2);
    address voter2 = address(0x3);

    uint256 constant POOL_ID = 1;
    uint256 constant VOTING_PERIOD = 7 days;
    uint256 constant CHALLENGE_PERIOD = 7 days;
    uint256 constant QUORUM_BPS = 4000;
    uint256 constant SLASH_BPS = 500;

    function setUp() public {
        token = new MockERC20("Gov", "GOV", 18);
        rm = new MockCommitteeRiskManager();
        staking = new MockCommitteeStaking(token);

        committee = new CommitteeHarness(
            address(rm),
            address(staking),
            VOTING_PERIOD,
            CHALLENGE_PERIOD,
            QUORUM_BPS,
            SLASH_BPS
        );

        // Mint tokens and set staking balances
        token.mint(proposer, 10_000 ether);
        token.mint(voter1, 10_000 ether);
        token.mint(voter2, 10_000 ether);

        vm.prank(proposer);
        token.approve(address(committee), type(uint256).max);
        vm.prank(voter1);
        token.approve(address(committee), type(uint256).max);
        vm.prank(voter2);
        token.approve(address(committee), type(uint256).max);

        staking.setBalance(proposer, 1000 ether);
        staking.setBalance(voter1, 1000 ether);
        staking.setBalance(voter2, 1000 ether);
    }

    function testFuzz_createPauseProposal(uint256 bond) public {
        uint256 min = committee.minBondAmount();
        uint256 max = committee.maxBondAmount();
        bond = bound(bond, min, max);
        vm.prank(proposer);
        uint256 id = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, bond);

        (
            , , address prop,, , , , , Committee.ProposalStatus status, uint256 storedBond,, ,
        ) = committee.proposals(id);

        assertEq(prop, proposer);
        assertEq(uint256(status), uint256(Committee.ProposalStatus.Active));
        assertEq(storedBond, bond);
    }

    function testFuzz_voteTallies(uint96 weight1, uint96 weight2) public {
        weight1 = uint96(bound(weight1, 1, 1_000 ether));
        weight2 = uint96(bound(weight2, 1, 1_000 ether));

        staking.setBalance(proposer, uint256(weight1));
        staking.setBalance(voter1, uint256(weight2));
        token.mint(address(staking), uint256(weight1) + uint256(weight2));

        uint256 minBond = committee.minBondAmount();
        vm.prank(proposer);
        uint256 id = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, minBond);

        vm.prank(proposer);
        committee.vote(id, Committee.VoteOption.For);
        vm.prank(voter1);
        committee.vote(id, Committee.VoteOption.Against);

        (, , , , , , uint256 forVotes, uint256 againstVotes,, , , ,) = committee.proposals(id);
        assertEq(forVotes, uint256(weight1));
        assertEq(againstVotes, uint256(weight2));
    }

    function testFuzz_updateVoteWeight(uint96 startWeight, uint96 newWeight) public {
        startWeight = uint96(bound(startWeight, 1, 1_000 ether));
        newWeight = uint96(bound(newWeight, 1, 1_000 ether));

        staking.setBalance(proposer, uint256(startWeight));
        token.mint(address(staking), uint256(startWeight) + uint256(newWeight));

        uint256 minBond = committee.minBondAmount();
        vm.prank(proposer);
        committee.createProposal(POOL_ID, Committee.ProposalType.Pause, minBond);
        vm.prank(proposer);
        committee.vote(1, Committee.VoteOption.For);

        staking.callUpdateWeight(address(committee), proposer, 1, uint256(newWeight));

        (, , , , , , uint256 forVotes,, , , , ,) = committee.proposals(1);
        assertEq(forVotes, uint256(newWeight));
    }

    function testFuzz_claimRewardDistribution(uint96 weight1, uint96 weight2, uint96 reward) public {
        weight1 = uint96(bound(weight1, 1, 1_000 ether));
        weight2 = uint96(bound(weight2, 1, 1_000 ether));
        reward = uint96(bound(reward, 1e18, 1e20));
        uint256 totalWeight = uint256(weight1) + uint256(weight2);
        staking.setBalance(proposer, uint256(weight1));
        staking.setBalance(voter1, uint256(weight2));
        token.mint(address(staking), totalWeight);

        vm.deal(address(rm), reward);

        uint256 minBond = committee.minBondAmount();
        vm.prank(proposer);
        uint256 id = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, minBond);

        vm.prank(proposer);
        committee.vote(id, Committee.VoteOption.For);
        vm.prank(voter1);
        committee.vote(id, Committee.VoteOption.For);

        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(id);
        (, , , , , , , , , , , uint256 cd,) = committee.proposals(id);

        vm.prank(address(rm));
        rm.sendFees{value: reward}(address(committee), id);

        vm.warp(cd + 1);
        committee.resolvePauseBond(id);

        uint256 beforeProp = proposer.balance;
        vm.prank(proposer);
        committee.claimReward(id);
        uint256 claimedProp = proposer.balance - beforeProp;

        assertLe(claimedProp, reward);
    }
}
