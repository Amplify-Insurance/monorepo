// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IStakingContract.sol";

contract MockProposalFinalization {
    bool public finalized = false;

    function setFinalized(bool _finalized) external {
        finalized = _finalized;
    }

    function isProposalFinalized(uint256) external view returns (bool) {
        return finalized;
    }

    function callRecordVote(address staking, address voter, uint256 proposalId) external {
        IStakingContract(staking).recordVote(voter, proposalId);
    }
}
