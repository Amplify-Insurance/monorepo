// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "./IPolicyNFT.sol";

interface IPolicyManager {
    function policyNFT() external view returns (IPolicyNFT);    
    function clearIncreasesAndGetPendingAmount(uint256 policyId)
        external
        returns (uint256 totalCancelled);
    function setCatPool(address catPoolAddress) external;
    function setCatPremiumShareBps(uint256 newBps) external;
    function setCoverCooldownPeriod(uint256 newPeriod) external;
}
