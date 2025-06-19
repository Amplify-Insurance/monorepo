// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../interfaces/IRiskManager.sol";
contract MockGovernanceRiskManager is IRiskManager {
    uint256 public lastReportPoolId;
    bool public lastPauseState;
    uint256 public lastFeePoolId;
    address public lastFeeRecipient;
    function reportIncident(uint256 _poolId, bool _pauseState) external override {
        lastReportPoolId = _poolId;
        lastPauseState = _pauseState;
    }
    function setPoolFeeRecipient(uint256 _poolId, address _recipient) external override {
        lastFeePoolId = _poolId;
        lastFeeRecipient = _recipient;
    }

    function callReceiveFees(address committee, uint256 proposalId) external payable {
        (bool ok,) = committee.call{value: msg.value}(abi.encodeWithSignature("receiveFees(uint256)", proposalId));
        require(ok, "call failed");
    }
}
