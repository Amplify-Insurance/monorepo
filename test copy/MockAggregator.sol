// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract MockAggregator is AggregatorV3Interface {
    int256 public price;
    uint8 public override decimals;
    uint80 public roundId;

    constructor(int256 initialPrice, uint8 _decimals) {
        price = initialPrice;
        decimals = _decimals;
        roundId = 1;
    }

    function description() external pure override returns (string memory) {
        return "mock";
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function getRoundData(uint80 _roundId) external view override returns (uint80, int256, uint256, uint256, uint80) {
        require(_roundId == roundId, "invalid round");
        return (roundId, price, block.timestamp, block.timestamp, roundId);
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, price, block.timestamp, block.timestamp, roundId);
    }
}
