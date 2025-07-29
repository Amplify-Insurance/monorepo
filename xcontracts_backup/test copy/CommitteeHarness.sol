// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Committee} from "../governance/Committee.sol";

contract CommitteeHarness is Committee {
    constructor(
        address riskManager,
        address staking,
        uint256 votingPeriod,
        uint256 challengePeriod,
        uint256 quorumBps,
        uint256 slashBps
    ) Committee(riskManager, staking, votingPeriod, challengePeriod, quorumBps, slashBps) {}

    function calculateFeeShare(uint256 bondAmount) external view returns (uint256) {
        return _calculateFeeShare(bondAmount);
    }
}
