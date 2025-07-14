// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

// --- Interfaces ---
import {IPoolRegistry} from "../interfaces/IPoolRegistry.sol";
import {IPoolRegistryAdmin} from "../interfaces/IPoolRegistryAdmin.sol";
import {ICapitalPoolAdmin} from "../interfaces/ICapitalPoolAdmin.sol";
import {IUnderwriterManagerAdmin} from "../interfaces/IUnderwriterManagerAdmin.sol";
import {IPolicyManagerAdmin} from "../interfaces/IPolicyManagerAdmin.sol";
import {IRiskManagerAdmin} from "../interfaces/IRiskManagerAdmin.sol";

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
    address public capitalPool;
    address public policyManager;
    address public underwriterManager;

    /* ───────────────────────── Events ───────────────────────── */
    event Initialized(address registry, address capitalPool, address policyManager, address underwriterManager);
    event CommitteeSet(address indexed newCommittee);
    event PoolAdded(uint256 indexed poolId, address indexed protocolToken);
    event IncidentReported(uint256 indexed poolId, bool isPaused);
    event PoolFeeRecipientSet(uint256 indexed poolId, address indexed recipient);

    /* ───────────────────────── Errors ───────────────────────── */
    error NotCommittee();
    error ZeroAddressNotAllowed();
    error AlreadyInitialized();
    error NotInitialized();

    /* ───────────────────────── Modifiers ───────────────────────── */
    modifier initialized() {
        if (address(poolRegistry) == address(0)) revert NotInitialized();
        _;
    }

    /* ───────────────────── Constructor & Setup ───────────────────── */

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    /**
     * @notice Initializes the core contract addresses. Can only be called once by the owner.
     * @dev This approach ensures that all critical addresses are set in a single, atomic transaction.
     */
    function initialize(address _registry, address _capitalPool, address _policyManager, address _underwriterManager)
        external
        onlyOwner
    {
        if (address(poolRegistry) != address(0)) revert AlreadyInitialized();
        if (
            _registry == address(0) || _capitalPool == address(0) || _policyManager == address(0)
                || _underwriterManager == address(0)
        ) revert ZeroAddressNotAllowed();

        poolRegistry = IPoolRegistry(_registry);
        capitalPool = _capitalPool;
        policyManager = _policyManager;
        underwriterManager = _underwriterManager;

        emit Initialized(_registry, _capitalPool, _policyManager, _underwriterManager);
    }

    /**
     * @notice Sets the address of the governance committee and synchronizes it with the RiskManager contract.
     * @dev The committee has special privileges, such as pausing pools.
     */
    function setCommittee(address _newCommittee, address _riskManager) external onlyOwner initialized {
        if (_newCommittee == address(0)) revert ZeroAddressNotAllowed();
        committee = _newCommittee;
        // Synchronize the committee address with the external RiskManager contract
        IRiskManagerAdmin(_riskManager).setCommittee(_newCommittee);
        emit CommitteeSet(_newCommittee);
    }

    /* ───────────────────── Governance Functions ───────────────────── */

    /**
     * @notice Adds a new risk pool to the protocol.
     * @dev Can only be called by the owner (DAO/multisig).
     */
    function addProtocolRiskPool(
        address protocolTokenToCover,
        IPoolRegistry.RateModel calldata rateModel,
        uint256 claimFeeBps
    ) external onlyOwner initialized returns (uint256) {
        uint256 poolId = poolRegistry.addProtocolRiskPool(protocolTokenToCover, rateModel, claimFeeBps);
        emit PoolAdded(poolId, protocolTokenToCover);
        return poolId;
    }

    function setPoolRegistryRiskManager(address newRiskManager) external onlyOwner initialized {
        IPoolRegistryAdmin(address(poolRegistry)).setRiskManager(newRiskManager);
    }

    function setCapitalPoolRiskManager(address newRiskManager) external onlyOwner initialized {
        ICapitalPoolAdmin(capitalPool).setRiskManager(newRiskManager);
    }

    function setCapitalPoolNoticePeriod(uint256 newPeriod) external onlyOwner initialized {
        ICapitalPoolAdmin(capitalPool).setUnderwriterNoticePeriod(newPeriod);
    }

    function setCapitalPoolBaseYieldAdapter(ICapitalPoolAdmin.YieldPlatform platform, address adapter)
        external
        onlyOwner
        initialized
    {
        ICapitalPoolAdmin(capitalPool).setBaseYieldAdapter(platform, adapter);
    }

    function setUnderwriterMaxAllocations(uint256 newMax) external onlyOwner initialized {
        IUnderwriterManagerAdmin(underwriterManager).setMaxAllocationsPerUnderwriter(newMax);
    }

    function setUnderwriterDeallocationNotice(uint256 newPeriod) external onlyOwner initialized {
        IUnderwriterManagerAdmin(underwriterManager).setDeallocationNoticePeriod(newPeriod);
    }

    function setPolicyCatPool(address catPoolAddress) external onlyOwner initialized {
        IPolicyManagerAdmin(policyManager).setCatPool(catPoolAddress);
    }

    function setPolicyCatPremiumShare(uint256 newBps) external onlyOwner initialized {
        IPolicyManagerAdmin(policyManager).setCatPremiumShareBps(newBps);
    }

    function setPolicyCoverCooldown(uint256 newPeriod) external onlyOwner initialized {
        IPolicyManagerAdmin(policyManager).setCoverCooldownPeriod(newPeriod);
    }

    /* ───────────────────── Committee Hooks ───────────────────── */

    /**
     * @notice Called by the Committee to pause or unpause a pool.
     * @dev This is a critical safety function to be used during incidents.
     */
    function reportIncident(uint256 poolId, bool pauseState) external initialized {
        if (msg.sender != committee) revert NotCommittee();
        poolRegistry.setPauseState(poolId, pauseState);
        emit IncidentReported(poolId, pauseState);
    }

    /**
     * @notice Called by the Committee to set the fee recipient for a pool.
     * @dev Typically used to redirect fees during an incident.
     */
    function setPoolFeeRecipient(uint256 poolId, address recipient) external initialized {
        if (msg.sender != committee) revert NotCommittee();
        if (recipient == address(0)) revert ZeroAddressNotAllowed(); // Prevents burning fees
        poolRegistry.setFeeRecipient(poolId, recipient);
        emit PoolFeeRecipientSet(poolId, recipient);
    }
}
