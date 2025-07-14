// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

// --- Interfaces ---

interface IPoolRegistry {
    struct RateModel {
        uint128 U_1;
        uint128 U_2;
        uint128 R_0;
        uint128 R_1;
        uint128 R_2;
    }
    function addProtocolRiskPool(
        address protocolTokenToCover,
        RateModel calldata rateModel,
        uint256 claimFeeBps
    ) external returns (uint256);
    function setPauseState(uint256 poolId, bool pauseState) external;
    function setFeeRecipient(uint256 poolId, address recipient) external;
}

/**
 * @title RiskAdmin
 * @author Gemini
 * @notice Handles administrative and governance functions for the protocol.
 * This contract is intended to be controlled by a DAO or a multisig wallet.
 * Its purpose is to manage system-level parameters and critical safety features.
 */
contract RiskAdmin is Ownable {

    /* ───────────────────────── State Variables ───────────────────────── */
    IPoolRegistry public poolRegistry;
    address public committee;

    /* ───────────────────────── Events ───────────────────────── */
    event AddressesSet(address registry);
    event CommitteeSet(address indexed newCommittee);
    event PoolAdded(uint256 indexed poolId, address indexed protocolToken);
    event IncidentReported(uint256 indexed poolId, bool isPaused);
    event PoolFeeRecipientSet(uint256 indexed poolId, address indexed recipient);

    /* ───────────────────────── Errors ───────────────────────── */
    error NotCommittee();
    error ZeroAddressNotAllowed();

    /* ───────────────────── Constructor & Setup ───────────────────── */

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    /**
     * @notice Sets the address of the PoolRegistry contract.
     * @dev Can only be called by the owner.
     */
    function setAddresses(address _registry) external onlyOwner {
        if (_registry == address(0)) revert ZeroAddressNotAllowed();
        poolRegistry = IPoolRegistry(_registry);
        emit AddressesSet(_registry);
    }

    /**
     * @notice Sets the address of the governance committee.
     * @dev The committee has special privileges, such as pausing pools.
     */
    function setCommittee(address _newCommittee) external onlyOwner {
        if (_newCommittee == address(0)) revert ZeroAddressNotAllowed();
        committee = _newCommittee;
        emit CommitteeSet(_newCommittee);
    }

    /* ───────────────────── Governance Functions ───────────────────── */

    /**
     * @notice Adds a new risk pool to the protocol.
     * @dev Can only be called by the owner (DAO/multisig).
     * @param protocolTokenToCover The address of the token being insured.
     * @param rateModel The rate model parameters for calculating premiums.
     * @param claimFeeBps The fee taken on claims, in basis points.
     * @return poolId The ID of the newly created pool.
     */
    function addProtocolRiskPool(
        address protocolTokenToCover,
        IPoolRegistry.RateModel calldata rateModel,
        uint256 claimFeeBps
    ) external onlyOwner returns (uint256) {
        uint256 poolId = poolRegistry.addProtocolRiskPool(protocolTokenToCover, rateModel, claimFeeBps);
        emit PoolAdded(poolId, protocolTokenToCover);
        return poolId;
    }

    /* ───────────────────── Committee Hooks ───────────────────── */

    /**
     * @notice Called by the Committee to pause or unpause a pool.
     * @dev This is a critical safety function to be used during incidents.
     * @param poolId The ID of the pool to update.
     * @param pauseState The new pause state (true = paused, false = unpaused).
     */
    function reportIncident(uint256 poolId, bool pauseState) external {
        if (msg.sender != committee) revert NotCommittee();
        poolRegistry.setPauseState(poolId, pauseState);
        emit IncidentReported(poolId, pauseState);
    }

    /**
     * @notice Called by the Committee to set the fee recipient for a pool.
     * @dev Typically used to redirect fees during an incident.
     * @param poolId The ID of the pool to update.
     * @param recipient The address of the new fee recipient.
     */
    function setPoolFeeRecipient(uint256 poolId, address recipient) external {
        if (msg.sender != committee) revert NotCommittee();
        poolRegistry.setFeeRecipient(poolId, recipient);
        emit PoolFeeRecipientSet(poolId, recipient);
    }
}