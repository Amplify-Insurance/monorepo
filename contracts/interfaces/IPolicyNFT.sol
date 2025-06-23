// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;


interface IPolicyNFT {
    // CORRECTED: The mint function needs to accept the new premium fields
    function mint(address _owner, uint256 _poolId, uint256 _coverage, uint256 _activation, uint128 _premiumDeposit, uint128 _lastDrainTime) external returns (uint256);
    
    function burn(uint256 _policyId) external;
    function ownerOf(uint256 _policyId) external view returns (address);
    function getPolicy(uint256 _policyId) external view returns (Policy memory);
    
    // DEPRECATED in new model, but kept for compatibility during transition if needed
    function updateLastPaid(uint256 _policyId, uint256 _newLastPaid) external;

    // ADDED: The missing function declaration
    function updatePremiumAccount(uint256 _policyId, uint128 _newDeposit, uint128 _newDrainTime) external;
    function addPendingIncrease(uint256 id, uint256 amount, uint256 activationTimestamp) external;
    function finalizeIncrease(uint256 id) external;
    function updateCoverage(uint256 id, uint256 newCoverage) external;

    // This struct definition is correct as-is
    struct Policy {
        uint256 coverage;                   // Currently active liability
        uint256 poolId;
        uint256 start;
        uint256 activation;                 // Activation for the initial coverage
        uint128 premiumDeposit;
        uint128 lastDrainTime;
        uint256 pendingIncrease;            // The amount of coverage being added
        uint256 increaseActivationTimestamp; // Timestamp when the pendingIncrease becomes active
    }
}