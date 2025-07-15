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
    address nonStaker = address(0x4);

    uint256 constant POOL_ID = 1;
    uint256 constant VOTING_PERIOD = 7 days;
    uint256 constant CHALLENGE_PERIOD = 7 days;
    uint256 constant QUORUM_BPS = 4000; // 40%
    uint256 constant SLASH_BPS = 1000; // 10%

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

        // Mint tokens for participants
        token.mint(proposer, 10_000 ether);
        token.mint(voter1, 10_000 ether);
        token.mint(voter2, 10_000 ether);

        // Approve committee to spend tokens
        vm.startPrank(proposer);
        token.approve(address(committee), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(voter1);
        token.approve(address(committee), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(voter2);
        token.approve(address(committee), type(uint256).max);
        vm.stopPrank();

        // Set initial staking balances
        staking.setBalance(proposer, 1000 ether);
        staking.setBalance(voter1, 1000 ether);
        staking.setBalance(voter2, 1000 ether);
        // nonStaker has 0 balance by default
    }

    /* ───────────────────────── Proposal Creation Tests ──────────────────────── */

    function testFuzz_createPauseProposal(uint256 bond) public {
        uint256 min = committee.minBondAmount();
        uint256 max = committee.maxBondAmount();
        bond = bound(bond, min, max);

        vm.prank(proposer);
        uint256 id = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, bond);

        (
            uint256 __ignored,
            Committee.ProposalType pType,
            address prop,
            uint256 __p1,
            uint256 __p2,
            uint256 __p3,
            uint256 __p4,
            uint256 __p5,
            Committee.ProposalStatus status,
            uint256 storedBond,
            uint256 __p6,
            uint256 __p7,
            uint256 __p8
        ) = committee.proposals(id);

        assertEq(uint256(pType), uint256(Committee.ProposalType.Pause));
        assertEq(prop, proposer);
        assertEq(uint256(status), uint256(Committee.ProposalStatus.Active));
        assertEq(storedBond, bond);
        assertTrue(committee.activeProposalForPool(POOL_ID));
    }

    function testFuzz_createUnpauseProposal() public {
        // To create an unpause proposal, the pool must first be paused.
        // We achieve this by running a full pause proposal lifecycle first.
        // --- Part 1: Create, execute, and resolve a PAUSE proposal to set state ---
        uint256 pauseBond = committee.minBondAmount();
        staking.setBalance(proposer, 2000 ether);
        token.mint(address(staking), (2000 ether * 100) / QUORUM_BPS + 1);

        vm.startPrank(proposer);
        uint256 pauseId = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, pauseBond);
        committee.vote(pauseId, Committee.VoteOption.For);
        vm.stopPrank();

        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(pauseId);

        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
        committee.resolvePauseBond(pauseId);
        assertFalse(committee.activeProposalForPool(POOL_ID));

        // --- Part 2: Create the UNPAUSE proposal ---
        vm.prank(proposer);
        uint256 id = committee.createProposal(POOL_ID, Committee.ProposalType.Unpause, 0);

        (
            uint256 __u0,
            Committee.ProposalType pType,
            address prop,
            uint256 __u1,
            uint256 __u2,
            uint256 __u3,
            uint256 __u4,
            uint256 __u5,
            Committee.ProposalStatus status,
            uint256 storedBond,
            uint256 __u6,
            uint256 __u7,
            uint256 __u8
        ) = committee.proposals(id);

        assertEq(uint256(pType), uint256(Committee.ProposalType.Unpause));
        assertEq(prop, proposer);
        assertEq(uint256(status), uint256(Committee.ProposalStatus.Active));
        assertEq(storedBond, 0, "Unpause proposals should have no bond");
        assertTrue(committee.activeProposalForPool(POOL_ID));
    }

    function testFuzz_revert_createProposal_InvalidState(uint256 bond) public {
        // Revert if not a staker
        vm.prank(nonStaker);
        vm.expectRevert("Must be a staker");
        committee.createProposal(POOL_ID, Committee.ProposalType.Pause, committee.minBondAmount());

        // Revert if proposal already exists for the pool
        vm.prank(proposer);
        committee.createProposal(POOL_ID, Committee.ProposalType.Pause, committee.minBondAmount());
        vm.prank(voter1);
        vm.expectRevert("Proposal already exists");
        committee.createProposal(POOL_ID, Committee.ProposalType.Pause, committee.minBondAmount());

        // Revert if bond is out of bounds for Pause proposal
        uint256 tooLowBond = committee.minBondAmount() - 1;
        uint256 tooHighBond = committee.maxBondAmount() + 1;
        vm.prank(proposer);
        vm.expectRevert("Invalid bond");
        committee.createProposal(2, Committee.ProposalType.Pause, tooLowBond);
        vm.expectRevert("Invalid bond");
        committee.createProposal(2, Committee.ProposalType.Pause, tooHighBond);

        // Revert if bond is not zero for Unpause proposal
        vm.expectRevert("No bond for unpause");
        committee.createProposal(3, Committee.ProposalType.Unpause, 1);
    }

    /* ───────────────────────── Voting Logic Tests ──────────────────────── */

    function testFuzz_voteTallies(uint96 weight1, uint96 weight2) public {
        weight1 = uint96(bound(weight1, 1, 1_000_000 ether));
        weight2 = uint96(bound(weight2, 1, 1_000_000 ether));

        staking.setBalance(proposer, uint256(weight1));
        staking.setBalance(voter1, uint256(weight2));

        uint256 minBond = committee.minBondAmount();
        vm.prank(proposer);
        uint256 id = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, minBond);

        vm.prank(proposer);
        committee.vote(id, Committee.VoteOption.For);
        vm.prank(voter1);
        committee.vote(id, Committee.VoteOption.Against);

        (, , , , , , uint256 forVotes, uint256 againstVotes, , , , , ) = committee.proposals(id);
        assertEq(forVotes, uint256(weight1));
        assertEq(againstVotes, uint256(weight2));
    }

    function testFuzz_changeVote(uint96 weight) public {
        weight = uint96(bound(weight, 1, 1_000_000 ether));
        staking.setBalance(proposer, uint256(weight));

        uint256 minBond = committee.minBondAmount();
        vm.prank(proposer);
        uint256 id = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, minBond);

        // First vote For
        vm.prank(proposer);
        committee.vote(id, Committee.VoteOption.For);
        (, , , , , , uint256 forVotes, uint256 againstVotes, , , , , ) = committee.proposals(id);
        assertEq(forVotes, weight);
        assertEq(againstVotes, 0);

        // Change vote to Against
        vm.prank(proposer);
        committee.vote(id, Committee.VoteOption.Against);
        (, , , , , , forVotes, againstVotes, , , , , ) = committee.proposals(id);
        assertEq(forVotes, 0);
        assertEq(againstVotes, weight);
    }

    function testFuzz_updateVoteWeight(uint96 startWeight, uint96 newWeight) public {
        startWeight = uint96(bound(startWeight, 1, 1_000 ether));
        newWeight = uint96(bound(newWeight, 1, 1_000 ether));

        staking.setBalance(proposer, uint256(startWeight));

        uint256 minBond = committee.minBondAmount();
        vm.prank(proposer);
        committee.createProposal(POOL_ID, Committee.ProposalType.Pause, minBond);
        vm.prank(proposer);
        committee.vote(1, Committee.VoteOption.For);

        // Simulate staking contract calling to update weight
        staking.callUpdateWeight(address(committee), proposer, 1, uint256(newWeight));

        (, , , , , , uint256 forVotes, , , , , , ) = committee.proposals(1);
        assertEq(forVotes, uint256(newWeight));
    }

    function testFuzz_revert_vote_InvalidState(uint96 weight) public {
        weight = uint96(bound(weight, 1, 1_000 ether));
        staking.setBalance(proposer, weight);

        vm.prank(proposer);
        uint256 id = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, committee.minBondAmount());

        // Revert if voting on a non-active proposal
        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(id); // Proposal becomes Defeated

        vm.prank(proposer);
        vm.expectRevert("Proposal not active");
        committee.vote(id, Committee.VoteOption.For);

        // Create a new proposal for the next tests
        vm.prank(proposer);
        uint256 id2 = committee.createProposal(POOL_ID + 1, Committee.ProposalType.Pause, committee.minBondAmount());

        // Revert if voting period is over
        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        vm.prank(proposer);
        vm.expectRevert("Voting ended");
        committee.vote(id2, Committee.VoteOption.For);

        // Revert on invalid vote option
        (,,,,uint256 creationTime,,,,,,,,) = committee.proposals(id2);
        vm.warp(creationTime); // Reset time
        vm.prank(proposer);
        vm.expectRevert("Invalid vote option");
        committee.vote(id2, Committee.VoteOption.None);
    }

    /* ─────────────────── Proposal Execution & Resolution Tests ─────────────────── */

    function testFuzz_execute_Defeated_QuorumNotMet(uint96 voteWeight) public {
        voteWeight = uint96(bound(voteWeight, 1, 1000 ether));
        uint256 totalStaked = (uint256(voteWeight) * 100) / (QUORUM_BPS - 1); // Ensure quorum is not met
        staking.setBalance(proposer, voteWeight);
        token.mint(address(staking), totalStaked); // Mock total supply

        uint256 bond = committee.minBondAmount();
        vm.startPrank(proposer);
        uint256 id = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, bond);
        committee.vote(id, Committee.VoteOption.For);
        vm.stopPrank();

        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(id);

        (, , , , , , , , Committee.ProposalStatus status, , , , ) = committee.proposals(id);
        assertEq(uint256(status), uint256(Committee.ProposalStatus.Defeated));
        assertFalse(committee.activeProposalForPool(POOL_ID));

        // Check bond slashing
        uint256 expectedRefund = bond - (bond * SLASH_BPS / 10000);
        assertEq(token.balanceOf(proposer), expectedRefund);
    }

    function testFuzz_execute_Defeated_AgainstWins(uint96 forWeight, uint96 againstWeight) public {
        // Ensure against votes are >= for votes, and quorum is met
        forWeight = uint96(bound(forWeight, 1, 1000 ether));
        againstWeight = uint96(bound(againstWeight, forWeight, 2000 ether));

        staking.setBalance(proposer, forWeight);
        staking.setBalance(voter1, againstWeight);
        uint256 totalStaked = uint256(forWeight) + uint256(againstWeight);
        token.mint(address(staking), (totalStaked * 100) / QUORUM_BPS + 1); // Ensure quorum met

        uint256 bond = committee.minBondAmount();
        vm.startPrank(proposer);
        uint256 id = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, bond);
        committee.vote(id, Committee.VoteOption.For);
        vm.stopPrank();
        vm.prank(voter1);
        committee.vote(id, Committee.VoteOption.Against);

        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(id);

        (, , , , , , , , Committee.ProposalStatus status, , , , ) = committee.proposals(id);
        assertEq(uint256(status), uint256(Committee.ProposalStatus.Defeated));
    }

    function testFuzz_execute_SuccessfulUnpause() public {
        // To test an unpause proposal, we must first create and pass a pause proposal
        // to put the pool into a paused state. This avoids needing a mock-specific setup function.

        // --- Part 1: Create, execute, and resolve a PAUSE proposal to set state ---
        uint256 pauseBond = committee.minBondAmount();
        // Ensure proposer has enough stake and the total stake is enough for quorum
        staking.setBalance(proposer, 2000 ether);
        token.mint(address(staking), (2000 ether * 100) / QUORUM_BPS + 1);

        // Proposer creates and votes for a pause proposal
        vm.startPrank(proposer);
        uint256 pauseId = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, pauseBond);
        committee.vote(pauseId, Committee.VoteOption.For);
        vm.stopPrank();

        // Execute the pause proposal after the voting period
        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(pauseId);

        // The pause proposal is now 'Challenged'. To create a new proposal for the same pool,
        // the first one must be resolved to clear the 'activeProposalForPool' flag.
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
        committee.resolvePauseBond(pauseId);
        assertFalse(committee.activeProposalForPool(POOL_ID), "Pre-condition failed: activeProposalForPool should be false");


        // --- Part 2: Create and execute the UNPAUSE proposal ---
        // Proposer creates and votes for an unpause proposal
        vm.startPrank(proposer);
        uint256 unpauseId = committee.createProposal(POOL_ID, Committee.ProposalType.Unpause, 0);
        committee.vote(unpauseId, Committee.VoteOption.For);
        vm.stopPrank();

        // Execute the unpause proposal after its voting period
        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(unpauseId);

        // --- Part 3: Assert final state ---
        (, , , , , , , , Committee.ProposalStatus status, , , , ) = committee.proposals(unpauseId);
        assertEq(uint256(status), uint256(Committee.ProposalStatus.Executed), "Unpause proposal should be Executed");
        assertFalse(committee.activeProposalForPool(POOL_ID), "activeProposalForPool should be false after unpause");
    }

    function testFuzz_execute_SuccessfulPause_then_Resolve_Slashed(uint256 bond) public {
        bond = bound(bond, committee.minBondAmount(), committee.maxBondAmount());
        staking.setBalance(proposer, 1000 ether);
        token.mint(address(staking), (1000 ether * 100) / QUORUM_BPS + 1); // Ensure quorum

        uint256 initialProposerBalance = token.balanceOf(proposer);
        vm.startPrank(proposer);
        uint256 id = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, bond);
        committee.vote(id, Committee.VoteOption.For);
        vm.stopPrank();

        // Execute
        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(id);

        ( , , , , , , , , Committee.ProposalStatus status, , , uint256 challengeDeadline,) = committee.proposals(id);
        assertEq(uint256(status), uint256(Committee.ProposalStatus.Challenged));
        assertEq(challengeDeadline, block.timestamp + CHALLENGE_PERIOD);

        // Resolve (Slashed because no fees received)
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
        vm.expectEmit(true, true, true, true);
        emit Committee.BondResolved(id, true);
        committee.resolvePauseBond(id);

        (, , , , , , , , status, , , , ) = committee.proposals(id);
        assertEq(uint256(status), uint256(Committee.ProposalStatus.Resolved));
        assertFalse(committee.activeProposalForPool(POOL_ID));
        // Proposer balance should be less original bond, since it was transferred to contract and not returned
        assertEq(token.balanceOf(proposer), initialProposerBalance - bond);
        assertEq(token.balanceOf(address(committee)), bond); // Slashed bond stays in contract
    }

    function testFuzz_execute_SuccessfulPause_then_Resolve_NotSlashed(uint256 bond, uint256 reward) public {
        bond = bound(bond, committee.minBondAmount(), committee.maxBondAmount());
        reward = bound(reward, 1, 1e20);
        staking.setBalance(proposer, 1000 ether);
        token.mint(address(staking), (1000 ether * 100) / QUORUM_BPS + 1); // Ensure quorum

        uint256 initialProposerBalance = token.balanceOf(proposer);
        vm.startPrank(proposer);
        uint256 id = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, bond);
        committee.vote(id, Committee.VoteOption.For);
        vm.stopPrank();

        // Execute
        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(id);

        // Simulate fees being sent from Risk Manager
        vm.deal(address(rm), reward);
        vm.prank(address(rm));
        committee.receiveFees{value: reward}(id);

        // Resolve (Not Slashed)
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
        vm.expectEmit(true, true, true, true);
        emit Committee.BondResolved(id, false);
        committee.resolvePauseBond(id);

        (, , , , , , , , Committee.ProposalStatus status, , , , uint256 totalReward) = committee.proposals(id);
        assertEq(uint256(status), uint256(Committee.ProposalStatus.Resolved));
        assertEq(totalReward, reward);
        // Proposer gets bond back
        assertEq(token.balanceOf(proposer), initialProposerBalance);
    }

    /* ───────────────────────── Reward Claiming Tests ──────────────────────── */

    function testFuzz_claimReward_MultiVoter(uint96 w1, uint96 w2, uint96 w3, uint256 reward) public {
        // Setup weights and reward
        w1 = uint96(bound(w1, 1 ether, 1000 ether));
        w2 = uint96(bound(w2, 1 ether, 1000 ether));
        w3 = uint96(bound(w3, 1 ether, 1000 ether));
        reward = bound(reward, 1 ether, 100 ether);
        uint256 totalForVotes = uint256(w1) + uint256(w2) + uint256(w3);

        // Setup stakers
        staking.setBalance(proposer, w1);
        staking.setBalance(voter1, w2);
        staking.setBalance(voter2, w3);
        token.mint(address(staking), (totalForVotes * 100) / QUORUM_BPS + 1);

        // Create and pass proposal
        uint256 bond = committee.minBondAmount();
        vm.startPrank(proposer);
        uint256 id = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, bond);
        committee.vote(id, Committee.VoteOption.For);
        vm.stopPrank();
        vm.prank(voter1);
        committee.vote(id, Committee.VoteOption.For);
        vm.prank(voter2);
        committee.vote(id, Committee.VoteOption.For);

        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(id);

        // Send fees and resolve bond
        vm.deal(address(rm), reward);
        vm.prank(address(rm));
        committee.receiveFees{value: reward}(id);
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
        committee.resolvePauseBond(id);

        // --- Claim Rewards ---
        (,,,,,,,,,,uint256 feeShareBps,,) = committee.proposals(id);
        uint256 proposerBonus = (reward * feeShareBps) / 10000;
        uint256 remainingFees = reward - proposerBonus;

        // Proposer claims
        uint256 expectedRewardProp = proposerBonus + (remainingFees * w1) / totalForVotes;
        uint256 beforeProp = proposer.balance;
        vm.prank(proposer);
        committee.claimReward(id);
        assertApproxEqAbs(proposer.balance, beforeProp + expectedRewardProp, 1);

        // Voter1 claims
        uint256 expectedRewardV1 = (remainingFees * w2) / totalForVotes;
        uint256 beforeV1 = voter1.balance;
        vm.prank(voter1);
        committee.claimReward(id);
        assertApproxEqAbs(voter1.balance, beforeV1 + expectedRewardV1, 1);

        // Voter2 claims
        uint256 expectedRewardV2 = (remainingFees * w3) / totalForVotes;
        uint256 beforeV2 = voter2.balance;
        vm.prank(voter2);
        committee.claimReward(id);
        assertApproxEqAbs(voter2.balance, beforeV2 + expectedRewardV2, 1);
        
        // Total claimed should be close to total reward
        assertApproxEqAbs(address(committee).balance, 0, 1); // Allow for rounding dust
    }

    function testFuzz_revert_claimReward_InvalidState() public {
        staking.setBalance(proposer, 1000 ether);
        token.mint(address(staking), (1000 ether * 100) / QUORUM_BPS + 1);
        
        vm.startPrank(proposer);
        uint256 id = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, committee.minBondAmount());
        committee.vote(id, Committee.VoteOption.For);
        vm.stopPrank();

        // Revert: Proposal not resolved yet
        vm.prank(proposer);
        vm.expectRevert("Proposal not resolved");
        committee.claimReward(id);

        // Pass proposal and send fees
        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(id);
        vm.deal(address(rm), 1 ether);
        vm.prank(address(rm));
        committee.receiveFees{value: 1 ether}(id);
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
        committee.resolvePauseBond(id);

        // Revert: Claimant did not vote 'For'
        vm.prank(voter1); // voter1 did not vote
        vm.expectRevert("Must have voted 'For' to claim rewards");
        committee.claimReward(id);

        // Revert: No rewards to claim (create new proposal)
        vm.startPrank(proposer);
        uint256 id2 = committee.createProposal(POOL_ID + 1, Committee.ProposalType.Pause, committee.minBondAmount());
        committee.vote(id2, Committee.VoteOption.For);
        vm.stopPrank();
        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(id2);
        vm.warp(block.timestamp + CHALLENGE_PERIOD + 1);
        committee.resolvePauseBond(id2);
        vm.prank(proposer);
        vm.expectRevert("No rewards to claim");
        committee.claimReward(id2);

        // Revert: Already claimed
        vm.prank(proposer);
        committee.claimReward(id); // First claim works
        vm.expectRevert("Reward already claimed");
        committee.claimReward(id); // Second claim fails
    }
}
