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

    // This struct definition is correct as-is
    struct Policy {
        uint256 poolId;
        uint256 coverage;
        uint256 activation;
        uint128 premiumDeposit;
        uint128 lastDrainTime;
    }
}