// SPDX-License-Identifier: BUSL-1.1

// IPolicyNFT.sol (Updated Version)
pragma solidity ^0.8.20;

interface IPolicyNFT {
    struct Policy {
        uint256 coverage;       // Currently active liability
        uint256 poolId;
        uint256 start;
        uint256 activation;     // Activation for the initial coverage
        uint128 premiumDeposit;
        uint128 lastDrainTime;
    }

    event PolicyMinted(address indexed owner, uint256 indexed policyId);
    event PolicyUpdated(uint256 indexed policyId);
    event PolicyBurned(uint256 indexed policyId);

    function mint(
        address owner,
        uint256 poolId,
        uint256 coverage,
        uint256 activationTimestamp,
        uint128 premiumDeposit,
        uint128 lastDrainTime
    ) external returns (uint256 policyId);
    
    // NEW: A single function to finalize multiple matured increases at once.
    function finalizeIncreases(uint256 policyId, uint256 totalAmountToAdd) external;
    
    function burn(uint256 policyId) external;
    function ownerOf(uint256 policyId) external view returns (address);
    function getPolicy(uint256 policyId) external view returns (Policy memory);
    function updatePremiumAccount(uint256 policyId, uint128 newDeposit, uint128 newDrainTime) external;

    // REMOVED: These functions are no longer needed as the logic is in PolicyManager
    // function addPendingIncrease(uint256 policyId, uint256 amount, uint256 activationTimestamp) external;
    // function finalizeIncrease(uint256 policyId) external;
}