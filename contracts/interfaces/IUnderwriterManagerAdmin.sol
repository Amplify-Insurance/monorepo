// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IUnderwriterManagerAdmin {
    function setMaxAllocationsPerUnderwriter(uint256 _newMax) external;
    function setDeallocationNoticePeriod(uint256 _newPeriod) external;
}
