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

    function getPoolData(uint256 _poolId) external view returns (
        IERC20 protocolTokenToCover,
        uint256 totalCapitalPledgedToPool,
        uint256 totalCoverageSold,
        uint256 capitalPendingWithdrawal,
        bool isPaused,
        address feeRecipient,
        uint256 claimFeeBps
    );

    function getPoolRateModel(uint256 _poolId) external view returns (RateModel memory);
    function getPoolPayoutData(uint256 _poolId) external view returns (address[] memory, uint256[] memory, uint256);
    function getPoolActiveAdapters(uint256 _poolId) external view returns (address[] memory);
    function getCapitalPerAdapter(uint256 _poolId, address _adapter) external view returns (uint256);
    function addProtocolRiskPool(address, RateModel calldata, uint256) external returns (uint256);
    function updateCapitalAllocation(uint256 poolId, address adapterAddress, uint256 pledgeAmount, bool isAllocation) external;
    function updateCapitalPendingWithdrawal(uint256 poolId, uint256 amount, bool isRequest) external;
    function updateCoverageSold(uint256 poolId, uint256 amount, bool isSale) external;
    function getPoolCount() external view returns (uint256);
    function setPauseState(uint256 _poolId, bool _isPaused) external;
    function setFeeRecipient(uint256 _poolId, address _recipient) external;
    function getMultiplePoolData(uint256[] calldata _poolIds) external view returns (PoolInfo[] memory);
}
