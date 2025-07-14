// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IPolicyManagerAdmin {
    function setCatPool(address catPoolAddress) external;
    function setCatPremiumShareBps(uint256 newBps) external;
    function setCoverCooldownPeriod(uint256 newPeriod) external;
}
