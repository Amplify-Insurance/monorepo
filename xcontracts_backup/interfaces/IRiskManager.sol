// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IRiskManager {
    function reportIncident(uint256 _poolId, bool _pauseState) external;
    function setPoolFeeRecipient(uint256 _poolId, address _recipient) external;
    function setCommittee(address _newCommittee) external;
}
