// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../interfaces/IRiskManager.sol";
import "../interfaces/IStakingContract.sol";

contract Committee is Ownable, ReentrancyGuard {
    using Address for address payable;
    using SafeERC20 for IERC20;

    /* ───────────────────────── State Variables ──────────────────────── */

    IRiskManager public immutable riskManager;
    IStakingContract public immutable stakingContract;
    IERC20 public immutable governanceToken;

    uint256 public proposalCounter;
    uint256 public immutable votingPeriod;
    uint256 public immutable challengePeriod; // e.g., 7 days
    uint256 public immutable quorumBps;
    uint256 public constant minBondAmount = 1000 ether;
    uint256 public constant maxBondAmount = 2500 ether;
    uint256 public constant minProposerFeeBps = 1000; // 10%
    uint256 public constant maxProposerFeeBps = 2500; // 25%
    uint256 public immutable slashPercentageBps;

    enum ProposalType { Unpause, Pause }
    enum VoteOption { None, Against, For }
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
        // bool executed; // REMOVED: Redundant due to ProposalStatus enum
        ProposalStatus status;
        uint256 bondAmount;
        uint256 proposerFeeShareBps;
        uint256 challengeDeadline;
        uint256 totalRewardFees;
        mapping(address => VoteOption) votes;
        mapping(address => uint256) voterWeight;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasClaimedReward;
    mapping(uint256 => bool) public activeProposalForPool;
    
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, uint256 poolId, ProposalType pType);
    event Voted(uint256 indexed proposalId, address indexed voter, VoteOption vote, uint256 weight);
    event ProposalExecuted(uint256 indexed proposalId);
    event BondResolved(uint256 indexed proposalId, bool wasSlashed);
    event RewardClaimed(uint256 indexed proposalId, address indexed user, uint256 amount);

    modifier onlyRiskManager() {
        require(msg.sender == address(riskManager), "Committee: Not RiskManager");
        _;
    }

    constructor(
        address _riskManagerAddress,
        address _stakingContractAddress,
        uint256 _votingPeriod,
        uint256 _challengePeriod,
        uint256 _quorumBps,
        uint256 _slashPercentageBps
    ) Ownable(msg.sender) {
        riskManager = IRiskManager(_riskManagerAddress);
        stakingContract = IStakingContract(_stakingContractAddress);
        governanceToken = stakingContract.governanceToken();
        votingPeriod = _votingPeriod;
        challengePeriod = _challengePeriod;
        quorumBps = _quorumBps;
        require(_slashPercentageBps <= 10000, "Invalid slash bps");
        slashPercentageBps = _slashPercentageBps;
    }
        
    function createProposal(uint256 _poolId, ProposalType _pType, uint256 _bondAmount) external nonReentrant returns (uint256) {
        require(stakingContract.stakedBalance(msg.sender) > 0, "Must be a staker");
        require(!activeProposalForPool[_poolId], "Proposal already exists");

        uint256 proposalId = ++proposalCounter;
        Proposal storage p = proposals[proposalId];

        p.id = proposalId;
        p.proposer = msg.sender;
        p.poolId = _poolId;
        p.pType = _pType;
        p.creationTime = block.timestamp;
        p.votingDeadline = block.timestamp + votingPeriod;
        p.status = ProposalStatus.Active;
        activeProposalForPool[_poolId] = true;

        if (_pType == ProposalType.Pause) {
            require(_bondAmount >= minBondAmount && _bondAmount <= maxBondAmount, "Invalid bond");
            p.bondAmount = _bondAmount;
            p.proposerFeeShareBps = _calculateFeeShare(_bondAmount);
            governanceToken.safeTransferFrom(msg.sender, address(this), _bondAmount);
        } else {
            require(_bondAmount == 0, "No bond for unpause");
            p.proposerFeeShareBps = 0;
        }

        emit ProposalCreated(proposalId, msg.sender, _poolId, _pType);
        return proposalId;
    }

    function vote(uint256 _proposalId, VoteOption _vote) external nonReentrant {
        Proposal storage p = proposals[_proposalId];
        require(p.status == ProposalStatus.Active, "Proposal not active");
        require(block.timestamp < p.votingDeadline, "Voting ended");
        require(_vote != VoteOption.None, "Invalid vote option");

        VoteOption previousVote = p.votes[msg.sender];
        uint256 previousWeight = p.voterWeight[msg.sender];
        uint256 currentWeight = stakingContract.stakedBalance(msg.sender);

        // Adjust tallies for previous vote if it exists
        if (previousVote == VoteOption.For) {
            p.forVotes -= previousWeight;
        } else if (previousVote == VoteOption.Against) {
            p.againstVotes -= previousWeight;
        }

        // Record new vote and weight
        p.votes[msg.sender] = _vote;
        p.voterWeight[msg.sender] = currentWeight;

        if (_vote == VoteOption.For) {
            p.forVotes += currentWeight;
        } else {
            p.againstVotes += currentWeight;
        }

        stakingContract.recordVote(msg.sender, _proposalId);

        emit Voted(_proposalId, msg.sender, _vote, currentWeight);
    }

    function updateVoteWeight(address _voter, uint256 _proposalId, uint256 _newWeight) external nonReentrant {
        require(msg.sender == address(stakingContract), "Not staking contract");
        Proposal storage p = proposals[_proposalId];
        if (p.status != ProposalStatus.Active || block.timestamp >= p.votingDeadline) {
            return;
        }

        VoteOption voteChoice = p.votes[_voter];
        if (voteChoice == VoteOption.None) {
            return;
        }

        uint256 prevWeight = p.voterWeight[_voter];
        if (prevWeight == _newWeight) {
            return;
        }

        if (voteChoice == VoteOption.For) {
            if (_newWeight > prevWeight) {
                p.forVotes += _newWeight - prevWeight;
            } else {
                p.forVotes -= prevWeight - _newWeight;
            }
        } else {
            if (_newWeight > prevWeight) {
                p.againstVotes += _newWeight - prevWeight;
            } else {
                p.againstVotes -= prevWeight - _newWeight;
            }
        }

        p.voterWeight[_voter] = _newWeight;
    }

    /**
     * @notice REFACTORED: This function now acts as a dispatcher to prevent "stack too deep" errors.
     */
    function executeProposal(uint256 _proposalId) external nonReentrant {
        Proposal storage p = proposals[_proposalId];
        require(p.status == ProposalStatus.Active, "Proposal not active for execution");
        require(block.timestamp >= p.votingDeadline, "Voting not over");
        
        uint256 totalStaked = governanceToken.balanceOf(address(stakingContract));
        uint256 requiredQuorum = (totalStaked * quorumBps) / 10000;
        
        if (p.forVotes + p.againstVotes < requiredQuorum || p.forVotes <= p.againstVotes) {
            _handleDefeatedProposal(p);
        } else {
            _handleSuccessfulProposal(p);
            emit ProposalExecuted(_proposalId);
        }
    }

    /**
     * @notice NEW: Internal function to handle the logic for a successful proposal.
     */
    function _handleSuccessfulProposal(Proposal storage p) internal {
        if (p.pType == ProposalType.Pause) {
            p.status = ProposalStatus.Challenged;
            p.challengeDeadline = block.timestamp + challengePeriod;
            riskManager.reportIncident(p.poolId, true);
            riskManager.setPoolFeeRecipient(p.poolId, address(this));
        } else { // Unpause
            p.status = ProposalStatus.Executed;
            activeProposalForPool[p.poolId] = false;
            riskManager.reportIncident(p.poolId, false);
        }
    }

    /**
     * @notice NEW: Internal function to handle the logic for a defeated proposal.
     */
    function _handleDefeatedProposal(Proposal storage p) internal {
        p.status = ProposalStatus.Defeated;
        activeProposalForPool[p.poolId] = false;
        if (p.pType == ProposalType.Pause) {
            uint256 slashAmount = (p.bondAmount * slashPercentageBps) / 10000;
            uint256 refund = p.bondAmount - slashAmount;
            if (refund > 0) {
                governanceToken.safeTransfer(p.proposer, refund);
            }
        }
    }
    
    function resolvePauseBond(uint256 _proposalId) external nonReentrant {
        Proposal storage p = proposals[_proposalId];
        require(p.pType == ProposalType.Pause, "Not a pause proposal");
        require(p.status == ProposalStatus.Challenged, "Not in challenge phase");
        require(block.timestamp >= p.challengeDeadline, "Challenge period not over");

        p.status = ProposalStatus.Resolved;
        activeProposalForPool[p.poolId] = false;

        if (p.totalRewardFees > 0) {
            governanceToken.safeTransfer(p.proposer, p.bondAmount);
            emit BondResolved(_proposalId, false);
        } else {
            // entire bond is slashed and kept in the contract
            emit BondResolved(_proposalId, true);
        }
    }

    /* ───────────────────── Reward Functions ───────────────────── */

    function receiveFees(uint256 _proposalId) external payable onlyRiskManager {
        proposals[_proposalId].totalRewardFees += msg.value;
    }

    function claimReward(uint256 _proposalId) external nonReentrant {
        Proposal storage p = proposals[_proposalId];
        require(p.status == ProposalStatus.Resolved || p.status == ProposalStatus.Executed, "Proposal not resolved");
        require(p.totalRewardFees > 0, "No rewards to claim");
        require(p.votes[msg.sender] == VoteOption.For, "Must have voted 'For' to claim rewards");
        require(!hasClaimedReward[_proposalId][msg.sender], "Reward already claimed");

        hasClaimedReward[_proposalId][msg.sender] = true;
        uint256 totalFees = p.totalRewardFees;
        uint256 proposerBonus = 0;
        
        if (msg.sender == p.proposer) {
            proposerBonus = (totalFees * p.proposerFeeShareBps) / 10000;
        }
        
        uint256 remainingFees = totalFees - proposerBonus;
        uint256 userWeight = p.voterWeight[msg.sender];
        uint256 userReward = proposerBonus + (remainingFees * userWeight) / p.forVotes;

        payable(msg.sender).sendValue(userReward);
        
        emit RewardClaimed(_proposalId, msg.sender, userReward);
    }

    function _calculateFeeShare(uint256 _bondAmount) internal view returns (uint256) {
        if (_bondAmount <= minBondAmount) {
            return minProposerFeeBps;
        }
        if (_bondAmount >= maxBondAmount) {
            return maxProposerFeeBps;
        }
        uint256 span = maxBondAmount - minBondAmount;
        uint256 bpsSpan = maxProposerFeeBps - minProposerFeeBps;
        return minProposerFeeBps + ((_bondAmount - minBondAmount) * bpsSpan) / span;
    }

    function isProposalFinalized(uint256 _proposalId) external view returns (bool) {
        Proposal storage p = proposals[_proposalId];
        return p.status == ProposalStatus.Defeated || p.status == ProposalStatus.Executed || p.status == ProposalStatus.Resolved;
    }
}
