// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IRiskManager
 * @notice An interface for the RiskManager contract to allow this Committee
 * contract to call its `reportIncident` function.
 */
interface IRiskManager {
    function reportIncident(uint256 _poolId, bool _pauseState) external;
}

/**
 * @title Committee
 * @author Gemini
 * @notice This contract manages a decentralized committee of token holders who can
 * vote on proposals to pause or unpause risk pools in the RiskManager contract.
 * It is designed to replace the single `committee` address in the RiskManager.
 */
contract Committee is Ownable {

    /* ───────────────────────── State Variables ──────────────────────── */

    // --- CORRECTED: Replaced 'final' with 'immutable' ---
    IRiskManager public immutable riskManager;
    IERC20 public immutable governanceToken;

    uint256 public proposalCounter;
    uint256 public votingPeriod; // Duration of a vote in seconds
    uint256 public quorumBps;    // Quorum requirement in basis points (e.g., 400 = 4%)

    enum VoteOption { Against, For, Abstain }

    struct Proposal {
        uint256 id;
        address proposer;
        uint256 poolId;
        bool pauseState; // The action to be taken (true = pause, false = unpause)
        uint256 creationTime;
        uint256 votingDeadline;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool executed;
        mapping(address => bool) hasVoted;
    }

    mapping(uint256 => Proposal) public proposals;

    /* ─────────────────────────── Events ─────────────────────────── */

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        uint256 poolId,
        bool pauseState,
        uint256 votingDeadline
    );
    event Voted(
        uint256 indexed proposalId,
        address indexed voter,
        VoteOption vote,
        uint256 weight
    );
    event ProposalExecuted(uint256 indexed proposalId, bool passed);
    event VotingPeriodUpdated(uint256 newVotingPeriod);
    event QuorumUpdated(uint256 newQuorumBps);


    /* ───────────────────────── Constructor ──────────────────────── */

    constructor(
        address _governanceTokenAddress,
        address _riskManagerAddress,
        uint256 _initialVotingPeriod, // e.g., 3 days in seconds
        uint256 _initialQuorumBps,    // e.g., 400 for 4%
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_governanceTokenAddress != address(0) && _riskManagerAddress != address(0), "Zero address");
        governanceToken = IERC20(_governanceTokenAddress);
        riskManager = IRiskManager(_riskManagerAddress);
        votingPeriod = _initialVotingPeriod;
        quorumBps = _initialQuorumBps;
    }


    /* ───────────────────── Admin Functions ───────────────────── */

    /**
     * @notice Updates the duration of the voting period for new proposals.
     * @param _newVotingPeriod The new duration in seconds.
     */
    function setVotingPeriod(uint256 _newVotingPeriod) external onlyOwner {
        votingPeriod = _newVotingPeriod;
        emit VotingPeriodUpdated(_newVotingPeriod);
    }

    /**
     * @notice Updates the quorum required for a proposal to pass.
     * @param _newQuorumBps The new quorum in basis points (1% = 100).
     */
    function setQuorum(uint256 _newQuorumBps) external onlyOwner {
        require(_newQuorumBps <= 10000, "Quorum cannot exceed 100%");
        quorumBps = _newQuorumBps;
        emit QuorumUpdated(_newQuorumBps);
    }


    /* ─────────────────── Governance Functions ─────────────────── */

    /**
     * @notice Creates a new proposal to pause or unpause a risk pool.
     * @param _poolId The ID of the pool in the RiskManager.
     * @param _pauseState The desired action (true to pause, false to unpause).
     */
    function createProposal(uint256 _poolId, bool _pauseState) external returns (uint256 proposalId) {
        // A minimum token balance could be required to prevent spam.
        require(governanceToken.balanceOf(msg.sender) > 0, "Must hold tokens to create proposal");

        proposalId = ++proposalCounter;
        Proposal storage newProposal = proposals[proposalId];

        newProposal.id = proposalId;
        newProposal.proposer = msg.sender;
        newProposal.poolId = _poolId;
        newProposal.pauseState = _pauseState;
        newProposal.creationTime = block.timestamp;
        newProposal.votingDeadline = block.timestamp + votingPeriod;

        emit ProposalCreated(proposalId, msg.sender, _poolId, _pauseState, newProposal.votingDeadline);
    }

    /**
     * @notice Cast a vote on an active proposal.
     * @param _proposalId The ID of the proposal to vote on.
     * @param _vote The chosen vote option (0=Against, 1=For, 2=Abstain).
     */
    function vote(uint256 _proposalId, VoteOption _vote) external {
        Proposal storage p = proposals[_proposalId];

        require(p.id != 0, "Proposal does not exist");
        require(block.timestamp < p.votingDeadline, "Voting period has ended");
        require(!p.hasVoted[msg.sender], "Already voted");

        p.hasVoted[msg.sender] = true;
        // Snapshot voting power at the time of voting.
        // For more robust governance, you might snapshot at proposal creation time,
        // which requires a more complex token contract (e.g., ERC20Votes).
        uint256 weight = governanceToken.balanceOf(msg.sender);

        if (_vote == VoteOption.For) {
            p.forVotes += weight;
        } else if (_vote == VoteOption.Against) {
            p.againstVotes += weight;
        } else {
            p.abstainVotes += weight;
        }

        emit Voted(_proposalId, msg.sender, _vote, weight);
    }

    /**
     * @notice Executes a proposal after the voting period has ended.
     * @dev Anyone can call this function. It checks for quorum and vote results.
     * If the proposal passes, it calls `reportIncident` on the RiskManager.
     * @param _proposalId The ID of the proposal to execute.
     */
    function executeProposal(uint256 _proposalId) external {
        Proposal storage p = proposals[_proposalId];

        require(p.id != 0, "Proposal does not exist");
        require(block.timestamp >= p.votingDeadline, "Voting period not over");
        require(!p.executed, "Proposal already executed");

        p.executed = true;

        uint256 totalVotes = p.forVotes + p.againstVotes; // Abstain votes don't count towards quorum
        uint256 requiredQuorum = (governanceToken.totalSupply() * quorumBps) / 10000;

        bool passed = (totalVotes >= requiredQuorum) && (p.forVotes > p.againstVotes);

        if (passed) {
            riskManager.reportIncident(p.poolId, p.pauseState);
        }

        emit ProposalExecuted(_proposalId, passed);
    }

    /* ───────────────────── View Functions ───────────────────── */

    /**
     * @notice Gets the current state of a proposal.
     */
    function getProposalState(uint256 _proposalId)
        external
        view
        returns (
            uint256 id,
            address proposer,
            uint256 votingDeadline,
            bool executed,
            uint256 forVotes,
            uint256 againstVotes
        )
    {
        Proposal storage p = proposals[_proposalId];
        return (p.id, p.proposer, p.votingDeadline, p.executed, p.forVotes, p.againstVotes);
    }
}