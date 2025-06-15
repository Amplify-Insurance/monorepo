// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title StakingContract
 * @author Gemini
 * @notice A simple contract for users to stake and unstake governance tokens.
 * The staked balance is used by the Committee contract to determine voting power.
 */
contract StakingContract is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable governanceToken;
    address public committeeAddress;

    mapping(address => uint256) public stakedBalance;
    uint256 public totalStaked;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event CommitteeAddressSet(address indexed committeeAddress);

    error NotCommittee();
    error ZeroAddress();
    error InvalidAmount();
    error InsufficientStakedBalance();

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
    function setCommitteeAddress(address _committeeAddress) external onlyOwner {
        require(committeeAddress == address(0), "Committee address already set");
        if (_committeeAddress == address(0)) revert ZeroAddress();
        committeeAddress = _committeeAddress;
        emit CommitteeAddressSet(_committeeAddress);
    }

    /**
     * @notice Stake governance tokens to participate in voting.
     */
    function stake(uint256 _amount) external {
        if (_amount == 0) revert InvalidAmount();
        stakedBalance[msg.sender] += _amount;
        totalStaked += _amount;
        governanceToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit Staked(msg.sender, _amount);
    }

    /**
     * @notice Unstake governance tokens.
     */
    function unstake(uint256 _amount) external {
        if (_amount == 0) revert InvalidAmount();
        if (stakedBalance[msg.sender] < _amount) revert InsufficientStakedBalance();
        
        stakedBalance[msg.sender] -= _amount;
        totalStaked -= _amount;
        governanceToken.safeTransfer(msg.sender, _amount);
        emit Unstaked(msg.sender, _amount);
    }

    /**
     * @notice Function for the Committee to slash a user's staked tokens.
     * @param _user The user whose stake is to be slashed.
     * @param _amount The amount to slash.
     */
    function slash(address _user, uint256 _amount) external onlyCommittee {
        if (_amount == 0) revert InvalidAmount();
        uint256 userStake = stakedBalance[_user];
        if (userStake < _amount) revert InsufficientStakedBalance();

        stakedBalance[_user] = userStake - _amount;
        totalStaked -= _amount;
        // The slashed tokens are transferred to the committee for distribution.
        governanceToken.safeTransfer(committeeAddress, _amount);
    }
}
