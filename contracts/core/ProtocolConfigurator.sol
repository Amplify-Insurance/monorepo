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

interface IPoolRegistryAdmin {
    function setRiskManager(address newRiskManager) external;
}

interface ICapitalPoolAdmin {
    enum YieldPlatform { NONE, AAVE, COMPOUND, OTHER_YIELD }
    function setRiskManager(address _riskManager) external;
    function setUnderwriterNoticePeriod(uint256 _newPeriod) external;
    function setBaseYieldAdapter(YieldPlatform _platform, address _adapterAddress) external;
}

interface IUnderwriterManagerAdmin {
    function setMaxAllocationsPerUnderwriter(uint256 _newMax) external;
    function setDeallocationNoticePeriod(uint256 _newPeriod) external;
}

interface IPolicyManagerAdmin {
    function setCatPool(address catPoolAddress) external;
    function setCatPremiumShareBps(uint256 newBps) external;
    function setCoverCooldownPeriod(uint256 newPeriod) external;
}

interface IRiskManagerAdmin {
    function setCommittee(address _newCommittee) external;
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
    address public capitalPool;
    address public policyManager;
    address public underwriterManager;


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