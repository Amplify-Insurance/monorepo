// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Interfaces for other contracts
interface IRiskManager {
    function reportIncident(uint256 _poolId, bool _pauseState) external;
    function setPoolFeeRecipient(uint256 _poolId, address _recipient) external;
}

interface IStakingContract {
    function slash(address _user, uint256 _amount) external;
    function stakedBalance(address _user) external view returns (uint256);
    function governanceToken() external view returns (IERC20);
}

contract Committee is Ownable {

    /* ───────────────────────── State Variables ──────────────────────── */

    IRiskManager public immutable riskManager;
    IStakingContract public immutable stakingContract;
    IERC20 public immutable governanceToken;

    uint256 public proposalCounter;
    uint256 public votingPeriod;
    uint256 public challengePeriod; // e.g., 7 days
    uint256 public quorumBps;
    uint256 public proposalBondAmount; // Amount of governance tokens for a pause proposal
    uint256 public proposerFeeShareBps; // Share of fees going to the proposer (e.g., 1000 = 10%)

    enum ProposalType { Unpause, Pause }
    enum VoteOption { Against, For }
    enum ProposalStatus { Pending, Active, Succeeded, Defeated, Executed, Challenged, Resolved }

    struct Proposal {
        uint256 id;
        ProposalType pType;
        address proposer;
        uint256 poolId;
        uint256 creationTime;
        uint256 votingDeadline;
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
        // Bond-specific fields
        ProposalStatus status;
        uint256 bondAmount;
        uint256 challengeDeadline;
        uint256 totalRewardFees;
        // Mappings
        mapping(address => bool) hasVoted;
        mapping(address => uint256) voterRewards;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasClaimedReward;
    
    // ... (Events from previous Committee contract) ...
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, uint256 poolId, ProposalType pType);
    event Voted(uint256 indexed proposalId, address indexed voter, VoteOption vote, uint256 weight);
    event ProposalExecuted(uint256 indexed proposalId);
    event BondResolved(uint256 indexed proposalId, bool wasSlashed);
    event RewardClaimed(uint256 indexed proposalId, address indexed user, uint256 amount);


    /* ───────────────────────── Constructor ──────────────────────── */

    constructor(
        address _riskManagerAddress,
        address _stakingContractAddress,
        uint256 _votingPeriod,
        uint256 _challengePeriod,
        uint256 _quorumBps,
        uint256 _proposalBond,
        uint256 _proposerFeeShare
    ) Ownable(msg.sender) {
        riskManager = IRiskManager(_riskManagerAddress);
        stakingContract = IStakingContract(_stakingContractAddress);
        governanceToken = stakingContract.governanceToken();
        votingPeriod = _votingPeriod;
        challengePeriod = _challengePeriod;
        quorumBps = _quorumBps;
        proposalBondAmount = _proposalBond;
        proposerFeeShareBps = _proposerFeeShare;
    }

    /* ─────────────────── Governance Core Functions ─────────────────── */

    function createProposal(uint256 _poolId, ProposalType _pType) external returns (uint256) {
        require(stakingContract.stakedBalance(msg.sender) > 0, "Must be a staker");

        uint256 proposalId = ++proposalCounter;
        Proposal storage p = proposals[proposalId];

        p.id = proposalId;
        p.proposer = msg.sender;
        p.poolId = _poolId;
        p.pType = _pType;
        p.creationTime = block.timestamp;
        p.votingDeadline = block.timestamp + votingPeriod;
        p.status = ProposalStatus.Active;

        if (_pType == ProposalType.Pause) {
            p.bondAmount = proposalBondAmount;
            governanceToken.transferFrom(msg.sender, address(this), proposalBondAmount);
        }

        emit ProposalCreated(proposalId, msg.sender, _poolId, _pType);
        return proposalId;
    }

    function vote(uint256 _proposalId, VoteOption _vote) external {
        Proposal storage p = proposals[_proposalId];
        require(p.status == ProposalStatus.Active, "Proposal not active");
        require(block.timestamp < p.votingDeadline, "Voting ended");
        require(!p.hasVoted[msg.sender], "Already voted");

        p.hasVoted[msg.sender] = true;
        uint256 weight = stakingContract.stakedBalance(msg.sender);

        if (_vote == VoteOption.For) p.forVotes += weight;
        else p.againstVotes += weight;

        emit Voted(_proposalId, msg.sender, _vote, weight);
    }
    
    function executeProposal(uint256 _proposalId) external {
        Proposal storage p = proposals[_proposalId];
        require(p.status == ProposalStatus.Active, "Proposal not active for execution");
        require(block.timestamp >= p.votingDeadline, "Voting not over");
        
        uint256 totalStaked = governanceToken.balanceOf(address(stakingContract));
        uint256 requiredQuorum = (totalStaked * quorumBps) / 10000;
        
        if (p.forVotes + p.againstVotes < requiredQuorum || p.forVotes <= p.againstVotes) {
            p.status = ProposalStatus.Defeated;
            // If a pause proposal is defeated, return the bond immediately.
            if (p.pType == ProposalType.Pause) {
                governanceToken.transfer(p.proposer, p.bondAmount);
            }
            return;
        }

        p.status = ProposalStatus.Succeeded;
        p.executed = true;

        if (p.pType == ProposalType.Pause) {
            riskManager.reportIncident(p.poolId, true);
            riskManager.setPoolFeeRecipient(p.poolId, address(this));
            p.status = ProposalStatus.Challenged;
            p.challengeDeadline = block.timestamp + challengePeriod;
        } else { // Unpause
            riskManager.reportIncident(p.poolId, false);
            p.status = ProposalStatus.Executed;
        }
        
        emit ProposalExecuted(_proposalId);
    }
    
    /**
     * @notice After a challenge period for a PAUSE proposal, anyone can call this to
     * resolve the bond, either returning it or slashing it.
     */
    function resolvePauseBond(uint256 _proposalId) external {
        Proposal storage p = proposals[_proposalId];
        require(p.pType == ProposalType.Pause, "Not a pause proposal");
        require(p.status == ProposalStatus.Challenged, "Not in challenge phase");
        require(block.timestamp >= p.challengeDeadline, "Challenge period not over");

        p.status = ProposalStatus.Resolved;
        
        // This is the crucial check. If any fees were collected, the pause was legitimate.
        if (p.totalRewardFees > 0) {
            // Return bond to proposer
            governanceToken.transfer(p.proposer, p.bondAmount);
            emit BondResolved(_proposalId, false); // Not slashed
        } else {
            // Slash bond and transfer it for distribution
            stakingContract.slash(p.proposer, p.bondAmount);
            // The slashed tokens are now held by this contract for distribution to 'Against' voters.
            // A separate claim function would handle this. For now, we simplify.
            emit BondResolved(_proposalId, true); // Slashed
        }
    }

    /* ───────────────────── Reward Functions ───────────────────── */

    /**
     * @notice Entry point for the RiskManager to send claim fees.
     */
    function receiveFees(uint256 _proposalId) external payable {
        // This function would be called by RM, but for simplicity we allow anyone to deposit
        // and link it to a proposal. A real implementation would secure this.
        proposals[_proposalId].totalRewardFees += msg.value;
    }

    function claimReward(uint256 _proposalId) external {
        Proposal storage p = proposals[_proposalId];
        require(p.status == ProposalStatus.Resolved || p.status == ProposalStatus.Executed, "Proposal not resolved");
        require(p.totalRewardFees > 0, "No rewards to claim");
        require(p.hasVoted[msg.sender], "You did not vote"); // Simplification: must have voted For
        require(!hasClaimedReward[_proposalId][msg.sender], "Reward already claimed");

        hasClaimedReward[_proposalId][msg.sender] = true;
        uint256 userReward;
        uint256 totalFees = p.totalRewardFees;

        if (msg.sender == p.proposer) {
            uint256 proposerBonus = (totalFees * proposerFeeShareBps) / 10000;
            userReward += proposerBonus;
        }
        
        uint256 remainingFees = totalFees - ((totalFees * proposerFeeShareBps) / 10000);
        uint256 userWeight = stakingContract.stakedBalance(msg.sender);
        userReward += (remainingFees * userWeight) / p.forVotes;

        (bool sent, ) = msg.sender.call{value: userReward}("");
        require(sent, "Failed to send reward");
        
        emit RewardClaimed(_proposalId, msg.sender, userReward);
    }
}
