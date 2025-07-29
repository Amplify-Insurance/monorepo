// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ICommittee {
    function isProposalFinalized(uint256 proposalId) external view returns (bool);
    function updateVoteWeight(address voter, uint256 proposalId, uint256 newWeight) external;
}

/**
 * @title StakingContract
 * @author Gemini
 * @notice A simple contract for users to stake and unstake governance tokens.
 * The staked balance is used by the Committee contract to determine voting power.
 */
contract StakingContract is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable governanceToken;
    address public committeeAddress;

    uint256 public constant UNSTAKE_LOCK_PERIOD = 7 days;

    mapping(address => uint256) public lastVotedProposal;
    mapping(address => uint256) public lastVoteTime;

    mapping(address => uint256) public stakedBalance;
    uint256 public totalStaked;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event CommitteeAddressSet(address indexed committeeAddress);
    event Slashed(address indexed user, uint256 amount);

    error NotCommittee();
    error ZeroAddress();
    error InvalidAmount();
    error InsufficientStakedBalance();
    error VoteLockActive();

    modifier onlyCommittee() {
        if (msg.sender != committeeAddress) revert NotCommittee();
        _;
    }

    constructor(address _governanceTokenAddress, address _initialOwner) Ownable(_initialOwner) {
        if (_governanceTokenAddress == address(0)) revert ZeroAddress();
        governanceToken = IERC20(_governanceTokenAddress);
    }

    /**
     * @notice Sets the address of the Committee contract. Can only be called once.
     * This is the only address that needs special privileges (e.g., for slashing).
     */
    function setCommitteeAddress(address committeeAddr) external onlyOwner {
        require(committeeAddress == address(0), "Committee address already set");
        if (committeeAddr == address(0)) revert ZeroAddress();
        committeeAddress = committeeAddr;
        emit CommitteeAddressSet(committeeAddr);
    }

    /**
     * @notice Stake governance tokens to participate in voting.
     */
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        stakedBalance[msg.sender] += amount;
        totalStaked += amount;
        governanceToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function recordVote(address voter, uint256 proposalId) external onlyCommittee {
        lastVotedProposal[voter] = proposalId;
        lastVoteTime[voter] = block.timestamp;
    }

    /**
     * @notice Unstake governance tokens.
     */
    function unstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (stakedBalance[msg.sender] < amount) revert InsufficientStakedBalance();
        uint256 proposalId = lastVotedProposal[msg.sender];
        if (proposalId != 0) {
            bool finalized = ICommittee(committeeAddress).isProposalFinalized(proposalId);
            if (!finalized) {
                if (block.timestamp < lastVoteTime[msg.sender] + UNSTAKE_LOCK_PERIOD) {
                    revert VoteLockActive();
                }
                uint256 newBalance = stakedBalance[msg.sender] - amount;
                stakedBalance[msg.sender] = newBalance;
                totalStaked -= amount;
                ICommittee(committeeAddress).updateVoteWeight(msg.sender, proposalId, newBalance);
                governanceToken.safeTransfer(msg.sender, amount);
                emit Unstaked(msg.sender, amount);
                return;
            } else {
                lastVotedProposal[msg.sender] = 0;
                lastVoteTime[msg.sender] = 0;
            }
        }

        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;
        governanceToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /**
     * @notice Function for the Committee to slash a user's staked tokens.
     * @param user The user whose stake is to be slashed.
     * @param amount The amount to slash.
     */
    function slash(address user, uint256 amount) external onlyCommittee nonReentrant {
        if (amount == 0) revert InvalidAmount();
        uint256 userStake = stakedBalance[user];
        if (userStake < amount) revert InsufficientStakedBalance();

        stakedBalance[user] = userStake - amount;
        totalStaked -= amount;
        // The slashed tokens are transferred to the committee for distribution.
        governanceToken.safeTransfer(committeeAddress, amount);
        emit Slashed(user, amount);
    }
}
