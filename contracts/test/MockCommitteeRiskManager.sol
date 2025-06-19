// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../interfaces/IRiskManager.sol";

contract MockCommitteeRiskManager is IRiskManager {
    event IncidentReported(uint256 poolId, bool pauseState);
    event FeeRecipientSet(uint256 poolId, address recipient);

    function reportIncident(uint256 _poolId, bool _pauseState) external override {
        emit IncidentReported(_poolId, _pauseState);
    }

    function setPoolFeeRecipient(uint256 _poolId, address _recipient) external override {
        emit FeeRecipientSet(_poolId, _recipient);
    }

    function sendFees(address committee, uint256 proposalId) external payable {
        (bool ok, ) = committee.call{value: msg.value}(abi.encodeWithSignature("receiveFees(uint256)", proposalId));
        require(ok, "sendFees failed");
    }
}
