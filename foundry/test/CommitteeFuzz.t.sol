// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {CommitteeHarness} from "contracts/test/CommitteeHarness.sol";
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
        token.mint(address(staking), 30_000 ether);

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
        vm.assume(bond >= min && bond <= max);

        vm.prank(proposer);
        uint256 id = committee.createProposal(POOL_ID, uint8(CommitteeHarness.ProposalType.Pause), bond);

        (
            , , address prop,, , , , , CommitteeHarness.ProposalStatus status, uint256 storedBond,, ,
        ) = committee.proposals(id);

        assertEq(prop, proposer);
        assertEq(status, CommitteeHarness.ProposalStatus.Active);
        assertEq(storedBond, bond);
    }

    function testFuzz_voteTallies(uint96 weight1, uint96 weight2) public {
        vm.assume(weight1 > 0 && weight2 > 0);

        staking.setBalance(proposer, uint256(weight1));
        staking.setBalance(voter1, uint256(weight2));
        token.mint(address(staking), uint256(weight1) + uint256(weight2));

        vm.prank(proposer);
        uint256 id = committee.createProposal(POOL_ID, uint8(CommitteeHarness.ProposalType.Pause), committee.minBondAmount());

        vm.prank(proposer);
        committee.vote(id, CommitteeHarness.VoteOption.For);
        vm.prank(voter1);
        committee.vote(id, CommitteeHarness.VoteOption.Against);

        (, , , , , , uint256 forVotes, uint256 againstVotes,, , , ,) = committee.proposals(id);
        assertEq(forVotes, uint256(weight1));
        assertEq(againstVotes, uint256(weight2));
    }

    function testFuzz_updateVoteWeight(uint96 startWeight, uint96 newWeight) public {
        vm.assume(startWeight > 0 && newWeight > 0);

        staking.setBalance(proposer, uint256(startWeight));
        token.mint(address(staking), uint256(startWeight) + uint256(newWeight));

        vm.prank(proposer);
        committee.createProposal(POOL_ID, uint8(CommitteeHarness.ProposalType.Pause), committee.minBondAmount());
        vm.prank(proposer);
        committee.vote(1, CommitteeHarness.VoteOption.For);

        staking.callUpdateWeight(address(committee), proposer, 1, uint256(newWeight));

        (, , , , , , uint256 forVotes,, , , , ,) = committee.proposals(1);
        assertEq(forVotes, uint256(newWeight));
    }

    function testFuzz_claimRewardDistribution(uint96 weight1, uint96 weight2, uint96 reward) public {
        vm.assume(weight1 > 0 && weight2 > 0 && reward > 0);
        uint256 totalWeight = uint256(weight1) + uint256(weight2);
        staking.setBalance(proposer, uint256(weight1));
        staking.setBalance(voter1, uint256(weight2));
        token.mint(address(staking), totalWeight);

        vm.deal(address(rm), reward);

        vm.prank(proposer);
        uint256 id = committee.createProposal(POOL_ID, uint8(CommitteeHarness.ProposalType.Pause), committee.minBondAmount());

        vm.prank(proposer);
        committee.vote(id, CommitteeHarness.VoteOption.For);
        vm.prank(voter1);
        committee.vote(id, CommitteeHarness.VoteOption.For);

        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(id);

        vm.prank(address(rm));
        rm.sendFees{value: reward}(address(committee), id);

        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
        committee.resolvePauseBond(id);

        uint256 beforeProp = proposer.balance;
        vm.prank(proposer);
        committee.claimReward(id);
        uint256 claimedProp = proposer.balance - beforeProp;

        uint256 beforeVoter = voter1.balance;
        vm.prank(voter1);
        committee.claimReward(id);
        uint256 claimedVoter = voter1.balance - beforeVoter;

        assertEq(claimedProp + claimedVoter, reward);
    }
}
