// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {Committee} from "contracts/governance/Committee.sol";
import {StakingContract} from "contracts/governance/Staking.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {RiskAdmin} from "contracts/core/ProtocolConfigurator.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";

interface IRiskManagerAdmin {
    function setCommittee(address) external;
}

contract DummyRiskManager is IRiskManagerAdmin {
    address public committee;

    function setCommittee(address c) external override {
        committee = c;
    }
}

import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";

contract CommitteeIntegration is Test {
    MockERC20 token;
    StakingContract staking;
    RiskAdmin riskAdmin;
    PoolRegistry registry;
    DummyRiskManager riskManager;
    Committee committee;

    address owner = address(this);
    address proposer = address(0x1);
    address voter = address(0x2);

    uint256 constant VOTING_PERIOD = 7 days;
    uint256 constant CHALLENGE_PERIOD = 7 days;
    uint256 constant QUORUM_BPS = 4000;
    uint256 constant SLASH_BPS = 500;
    uint256 constant POOL_ID = 0;

    function setUp() public {
        // deploy token and staking
        token = new MockERC20("GOV", "GOV", 18);
        staking = new StakingContract(address(token), owner);

        // deploy risk admin and pool registry
        riskAdmin = new RiskAdmin(owner);
        registry = new PoolRegistry(owner, address(riskAdmin));
        // initialize risk admin with registry and dummy addresses
        riskAdmin.initialize(address(registry), address(0xdead), address(0xbeef), address(0x1337));

        // deploy dummy risk manager owned by riskAdmin so setCommittee succeeds
        riskManager = new DummyRiskManager();

        // deploy committee and hook up modules
        committee =
            new Committee(address(riskAdmin), address(staking), VOTING_PERIOD, CHALLENGE_PERIOD, QUORUM_BPS, SLASH_BPS);
        staking.setCommitteeAddress(address(committee));
        riskAdmin.setCommittee(address(committee), address(riskManager));

        // create a simple pool in registry
        IPoolRegistry.RateModel memory rate = IPoolRegistry.RateModel({base: 100, slope1: 0, slope2: 0, kink: 8000});
        vm.prank(address(riskAdmin));
        registry.addProtocolRiskPool(address(token), rate, 0);

        // mint and stake tokens
        token.mint(proposer, 2_000 ether);
        token.mint(voter, 1_000 ether);

        vm.startPrank(proposer);
        token.approve(address(staking), type(uint256).max);
        token.approve(address(committee), type(uint256).max);
        staking.stake(1_000 ether);
        vm.stopPrank();

        vm.startPrank(voter);
        token.approve(address(staking), type(uint256).max);
        token.approve(address(committee), type(uint256).max);
        staking.stake(500 ether);
        vm.stopPrank();
    }

    function _createAndExecutePause() internal returns (uint256 id) {
        uint256 bond = committee.minBondAmount();
        vm.prank(proposer);
        id = committee.createProposal(POOL_ID, Committee.ProposalType.Pause, bond);

        vm.prank(proposer);
        committee.vote(id, Committee.VoteOption.For);
        vm.prank(voter);
        committee.vote(id, Committee.VoteOption.For);

        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(id);
    }

    function testPauseProposalPausesPool() public {
        uint256 id = _createAndExecutePause();
        (,,,, bool paused, address feeRecipient,) = registry.getPoolData(POOL_ID);
        assertTrue(paused);
        assertEq(feeRecipient, address(committee));
        (,,,,,, Committee.ProposalStatus status,, uint256 challengeDeadline,,) = committee.proposals(id);
        assertEq(uint256(status), uint256(Committee.ProposalStatus.Challenged));
        assertGt(challengeDeadline, block.timestamp);
    }

    function testUnpauseAfterResolution() public {
        uint256 id = _createAndExecutePause();
        // riskAdmin (as risk manager) sends fees to enable refund
        vm.prank(address(riskAdmin));
        committee.receiveFees{value: 1 ether}(id);
        (,,,,,,,,,,, uint256 cd,) = committee.proposals(id);
        vm.warp(cd + 1);
        committee.resolvePauseBond(id);

        // create unpause proposal
        vm.prank(proposer);
        uint256 id2 = committee.createProposal(POOL_ID, Committee.ProposalType.Unpause, 0);
        vm.prank(proposer);
        committee.vote(id2, Committee.VoteOption.For);
        vm.prank(voter);
        committee.vote(id2, Committee.VoteOption.For);

        vm.warp(block.timestamp + VOTING_PERIOD + 1);
        committee.executeProposal(id2);

        (,,,, bool paused,,) = registry.getPoolData(POOL_ID);
        assertFalse(paused);
        (,,,,,, Committee.ProposalStatus status,,,,) = committee.proposals(id2);
        assertEq(uint256(status), uint256(Committee.ProposalStatus.Executed));
    }

    function testRewardClaimFlow() public {
        uint256 id = _createAndExecutePause();
        vm.prank(address(riskAdmin));
        committee.receiveFees{value: 1 ether}(id);
        (,,,,,,,,,,, uint256 cd,) = committee.proposals(id);
        vm.warp(cd + 1);
        committee.resolvePauseBond(id);

        uint256 before = proposer.balance;
        vm.prank(proposer);
        committee.claimReward(id);
        uint256 afterBal = proposer.balance;
        assertGt(afterBal, before);
    }
}
