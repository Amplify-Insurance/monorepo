// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title PriceOracle
 * @notice Simple price oracle that reads Chainlink price feeds for tokens
 * and returns USD values with 18 decimals precision. Aggregators can be
 * registered by the owner. This avoids rate limits as all data is read from
 * on-chain feeds.
 */
contract PriceOracle is Ownable {
    /// @notice token => Chainlink aggregator
    mapping(address => AggregatorV3Interface) public aggregators;

    event AggregatorUpdated(address indexed token, address indexed aggregator);

    error ZeroAddress();
    error NoAggregatorConfigured(address token);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Set the Chainlink aggregator for a token.
     * @param token     Address of the ERC20 token
     * @param aggregator Address of the Chainlink price feed
     */
    function setAggregator(address token, address aggregator) external onlyOwner {
        if (token == address(0) || aggregator == address(0)) revert ZeroAddress();
        aggregators[token] = AggregatorV3Interface(aggregator);
        emit AggregatorUpdated(token, aggregator);
    }

    /**
     * @notice Get the latest USD price for a token.
     * @dev Returns price with the feed's decimals.
     */
    function getLatestUsdPrice(address token) public view returns (int256 price, uint8 decimals) {
        AggregatorV3Interface agg = aggregators[token];
        if (address(agg) == address(0)) {
            return (0, 0);
        }
        (, price, , , ) = agg.latestRoundData();
        decimals = agg.decimals();
    }

    /**
     * @notice Calculate USD value for a given token amount.
     * @param token  ERC20 token address
     * @param amount Amount of token in its native decimals
     * @return value USD amount with 18 decimals
     */
    function getUsdValue(address token, uint256 amount) external view returns (uint256 value) {
        (int256 price, uint8 feedDecimals) = getLatestUsdPrice(token);
        if (price <= 0) return 0;
        uint8 tokenDecimals = IERC20Metadata(token).decimals();
        uint256 scaledPrice = uint256(price) * (10 ** (18 - feedDecimals));
        value = (amount * scaledPrice) / (10 ** tokenDecimals);
    }
}
