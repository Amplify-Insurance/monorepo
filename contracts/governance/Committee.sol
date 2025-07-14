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
        
    function createProposal(
        uint256 poolId,
        ProposalType pType,
        uint256 bondAmount
    ) external nonReentrant returns (uint256) {
        // 1. Validate the creation request
        _validateProposalCreation(poolId, pType, bondAmount);

        // 2. Create the core proposal object
        uint256 proposalId = _initProposal(poolId, pType, msg.sender);
        Proposal storage p = proposals[proposalId];

        // 3. Handle the specific logic for a "Pause" proposal bond
        if (pType == ProposalType.Pause) {
            _handlePauseProposalBond(p, bondAmount);
        }

        emit ProposalCreated(proposalId, msg.sender, poolId, pType);
        return proposalId;
    }

    // --- NEW HELPER FUNCTIONS ---

    function _validateProposalCreation(uint256 poolId, ProposalType pType, uint256 bondAmount) internal view {
        require(stakingContract.stakedBalance(msg.sender) > 0, "Must be a staker");
        require(!activeProposalForPool[poolId], "Proposal already exists");
        if (pType == ProposalType.Pause) {
            require(bondAmount >= minBondAmount && bondAmount <= maxBondAmount, "Invalid bond");
        } else {
            require(bondAmount == 0, "No bond for unpause");
        }
    }

    function _initProposal(uint256 poolId, ProposalType pType, address proposer) internal returns (uint256) {
        uint256 proposalId = ++proposalCounter;
        Proposal storage p = proposals[proposalId];

        p.id = proposalId;
        p.proposer = proposer;
        p.poolId = poolId;
        p.pType = pType;
        p.creationTime = block.timestamp;
        p.votingDeadline = block.timestamp + votingPeriod;
        p.status = ProposalStatus.Active;
        activeProposalForPool[poolId] = true;

        return proposalId;
    }

    function _handlePauseProposalBond(Proposal storage p, uint256 bondAmount) internal {
        p.bondAmount = bondAmount;
        p.proposerFeeShareBps = _calculateFeeShare(bondAmount);
        governanceToken.safeTransferFrom(msg.sender, address(this), bondAmount);
    }


    function vote(uint256 proposalId, VoteOption voteOption) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.Active, "Proposal not active");
        require(block.timestamp < p.votingDeadline, "Voting ended");
        require(voteOption != VoteOption.None, "Invalid vote option");

        uint256 currentWeight = stakingContract.stakedBalance(msg.sender);
        
        // Use the new helper to manage vote counts
        _updateVoteTallies(p, msg.sender, voteOption, currentWeight);

        // Update the voter's state
        p.votes[msg.sender] = voteOption;
        p.voterWeight[msg.sender] = currentWeight;

        stakingContract.recordVote(msg.sender, proposalId);
        emit Voted(proposalId, msg.sender, voteOption, currentWeight);
    }

// --- NEW HELPER FUNCTION ---

    function _updateVoteTallies(Proposal storage p, address voter, VoteOption newVote, uint256 newWeight) internal {
        VoteOption previousVote = p.votes[voter];
        uint256 previousWeight = p.voterWeight[voter];

        // Subtract previous vote's weight
        if (previousVote == VoteOption.For) {
            p.forVotes -= previousWeight;
        } else if (previousVote == VoteOption.Against) {
            p.againstVotes -= previousWeight;
        }

        // Add new vote's weight
        if (newVote == VoteOption.For) {
            p.forVotes += newWeight;
        } else { // Against
            p.againstVotes += newWeight;
        }
    }

    function updateVoteWeight(address voter, uint256 proposalId, uint256 newWeight) external nonReentrant {
        require(msg.sender == address(stakingContract), "Not staking contract");
        Proposal storage p = proposals[proposalId];
        if (p.status != ProposalStatus.Active || block.timestamp >= p.votingDeadline) {
            return;
        }

        VoteOption voteChoice = p.votes[voter];
        if (voteChoice == VoteOption.None) {
            return;
        }

        uint256 prevWeight = p.voterWeight[voter];
        if (prevWeight == newWeight) {
            return;
        }

        if (voteChoice == VoteOption.For) {
            if (newWeight > prevWeight) {
                p.forVotes += newWeight - prevWeight;
            } else {
                p.forVotes -= prevWeight - newWeight;
            }
        } else {
            if (newWeight > prevWeight) {
                p.againstVotes += newWeight - prevWeight;
            } else {
                p.againstVotes -= prevWeight - newWeight;
            }
        }

        p.voterWeight[voter] = newWeight;
    }

    /**
     * @notice REFACTORED: This function now acts as a dispatcher to prevent "stack too deep" errors.
     */
    function executeProposal(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.Active, "Proposal not active for execution");
        require(block.timestamp >= p.votingDeadline, "Voting not over");
        
        uint256 totalStaked = governanceToken.balanceOf(address(stakingContract));
        uint256 requiredQuorum = (totalStaked * quorumBps) / 10000;
        
        if (p.forVotes + p.againstVotes < requiredQuorum || p.forVotes <= p.againstVotes) {
            _handleDefeatedProposal(p);
        } else {
            _handleSuccessfulProposal(p);
            emit ProposalExecuted(proposalId);
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
    
    function resolvePauseBond(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.pType == ProposalType.Pause, "Not a pause proposal");
        require(p.status == ProposalStatus.Challenged, "Not in challenge phase");
        require(block.timestamp >= p.challengeDeadline, "Challenge period not over");

        p.status = ProposalStatus.Resolved;
        activeProposalForPool[p.poolId] = false;

        if (p.totalRewardFees > 0) {
            governanceToken.safeTransfer(p.proposer, p.bondAmount);
            emit BondResolved(proposalId, false);
        } else {
            // entire bond is slashed and kept in the contract
            emit BondResolved(proposalId, true);
        }
    }

    /* ───────────────────── Reward Functions ───────────────────── */

    function receiveFees(uint256 proposalId) external payable onlyRiskManager {
        proposals[proposalId].totalRewardFees += msg.value;
    }

    function claimReward(uint256 proposalId) external nonReentrant {
        // 1. Validate the claim request
        _validateRewardClaim(proposalId, msg.sender);
        
        // 2. Calculate the user's reward
        uint256 userReward = _calculateUserReward(proposalId, msg.sender);
        
        // 3. Mark as claimed and send the funds
        hasClaimedReward[proposalId][msg.sender] = true;
        payable(msg.sender).sendValue(userReward);
        
        emit RewardClaimed(proposalId, msg.sender, userReward);
    }

    // --- NEW HELPER FUNCTIONS ---

    function _validateRewardClaim(uint256 proposalId, address claimant) internal view {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.Resolved || p.status == ProposalStatus.Executed, "Proposal not resolved");
        require(p.totalRewardFees > 0, "No rewards to claim");
        require(p.votes[claimant] == VoteOption.For, "Must have voted 'For' to claim rewards");
        require(!hasClaimedReward[proposalId][claimant], "Reward already claimed");
    }

    function _calculateUserReward(uint256 proposalId, address claimant) internal view returns (uint256) {
        Proposal storage p = proposals[proposalId];
        uint256 totalFees = p.totalRewardFees;
        uint256 proposerBonus = 0;
        
        if (claimant == p.proposer) {
            proposerBonus = (totalFees * p.proposerFeeShareBps) / 10000;
        }
        
        uint256 remainingFees = totalFees - proposerBonus;
        uint256 userWeight = p.voterWeight[claimant];
        
        return proposerBonus + (remainingFees * userWeight) / p.forVotes;
    }

    function _calculateFeeShare(uint256 _bondAmount) internal pure returns (uint256) {
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

    function isProposalFinalized(uint256 proposalId) external view returns (bool) {
        Proposal storage p = proposals[proposalId];
        return p.status == ProposalStatus.Defeated || p.status == ProposalStatus.Executed || p.status == ProposalStatus.Resolved;
    }
}
