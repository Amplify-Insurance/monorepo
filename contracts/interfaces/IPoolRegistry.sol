// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPoolRegistry {
    struct RateModel {
        uint256 base;
        uint256 slope1;
        uint256 slope2;
        uint256 kink;
    }

    struct PoolInfo {
        IERC20 protocolTokenToCover;
        uint256 totalCapitalPledgedToPool;
        uint256 totalCoverageSold;
        uint256 capitalPendingWithdrawal;
        bool isPaused;
        address feeRecipient;
        uint256 claimFeeBps;
    }

    enum ProtocolRiskIdentifier { NONE, PROTOCOL_A, PROTOCOL_B, LIDO_STETH, ROCKET_RETH }

    function isYieldRewardPool(uint256 poolId) external view returns (bool);
    function getPoolRateModel(uint256 poolId) external view returns (RateModel memory);
    function addProtocolRiskPool(address, RateModel calldata, uint256) external returns (uint256);
    function updateCoverageSold(uint256 poolId, uint256 amount, bool isSale) external;
    function getPoolCount() external view returns (uint256);
    function setPauseState(uint256 poolId, bool isPaused) external;
    function setFeeRecipient(uint256 poolId, address recipient) external;
    function getPoolStaticData(uint256 poolId) external view returns (
        IERC20 protocolTokenToCover,
        uint256 totalCoverageSold,
        bool isPaused,
        address feeRecipient,
        uint256 claimFeeBps
    );
    }
