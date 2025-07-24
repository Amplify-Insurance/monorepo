// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IPoolRegistry
 * @notice Interface for the PoolRegistry contract.
 * @dev CORRECTED: Removed duplicate function declarations and unused enums.
 * The RiskRating enum is now the single source of truth.
 */
interface IPoolRegistry {
    struct RateModel {
        uint256 base;
        uint256 slope1;
        uint256 slope2;
        uint256 kink;
    }

    /**
     * @notice Defines the risk tiers for covered assets.
     * @dev This is the single source of truth for RiskRating.
     * Contracts implementing this interface will inherit this enum.
     */
    enum RiskRating {
        Low,
        Moderate,
        Elevated,
        Speculative
    }

    // --- Functions ---

    function isYieldRewardPool(uint256 poolId) external view returns (bool);

    function getPoolRateModel(uint256 poolId) external view returns (RateModel memory);

    function updateCoverageSold(uint256 poolId, uint256 amount, bool isSale) external;

    function getPoolCount() external view returns (uint256);

    function setPauseState(uint256 poolId, bool isPaused) external;

    function setFeeRecipient(uint256 poolId, address recipient) external;

     function setPoolRiskRating(uint256 poolId, RiskRating newRating) external;

    function getPoolStaticData(uint256 poolId) external view returns (
        IERC20 protocolTokenToCover,
        uint256 totalCoverageSold,
        bool isPaused,
        address feeRecipient,
        uint256 claimFeeBps,
        RiskRating riskRating
    );
    
    function addProtocolRiskPool(
        address protocolTokenToCover,
        RateModel calldata rateModel,
        uint256 claimFeeBps,
        RiskRating riskRating
    ) external returns (uint256);

    function getPoolRiskRating(uint256 poolId) external view returns (RiskRating);
}