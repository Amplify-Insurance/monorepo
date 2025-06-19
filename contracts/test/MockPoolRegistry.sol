// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IPoolRegistry.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockPoolRegistry is IPoolRegistry, Ownable {
    struct PoolData {
        IERC20 protocolTokenToCover;
        uint256 totalCapitalPledgedToPool;
        uint256 totalCoverageSold;
        uint256 capitalPendingWithdrawal;
        bool isPaused;
        address feeRecipient;
        uint256 claimFeeBps;
    }

    mapping(uint256 => PoolData) public pools;
    mapping(uint256 => RateModel) public rateModels;

    constructor() Ownable(msg.sender) {}

    function setPoolData(
        uint256 poolId,
        IERC20 token,
        uint256 totalCapital,
        uint256 totalSold,
        uint256 pendingWithdrawal,
        bool paused,
        address feeRecipient,
        uint256 claimFeeBps
    ) external onlyOwner {
        pools[poolId] = PoolData({
            protocolTokenToCover: token,
            totalCapitalPledgedToPool: totalCapital,
            totalCoverageSold: totalSold,
            capitalPendingWithdrawal: pendingWithdrawal,
            isPaused: paused,
            feeRecipient: feeRecipient,
            claimFeeBps: claimFeeBps
        });
    }

    function setRateModel(uint256 poolId, RateModel calldata model) external onlyOwner {
        rateModels[poolId] = model;
    }

    function getPoolData(uint256 poolId) external view override returns (
        IERC20 protocolTokenToCover,
        uint256 totalCapitalPledgedToPool,
        uint256 totalCoverageSold,
        uint256 capitalPendingWithdrawal,
        bool isPaused,
        address feeRecipient,
        uint256 claimFeeBps
    ) {
        PoolData storage d = pools[poolId];
        protocolTokenToCover = d.protocolTokenToCover;
        totalCapitalPledgedToPool = d.totalCapitalPledgedToPool;
        totalCoverageSold = d.totalCoverageSold;
        capitalPendingWithdrawal = d.capitalPendingWithdrawal;
        isPaused = d.isPaused;
        feeRecipient = d.feeRecipient;
        claimFeeBps = d.claimFeeBps;
    }

    function getPoolRateModel(uint256 poolId) external view override returns (RateModel memory) {
        return rateModels[poolId];
    }

    // The following functions are no-ops for this mock
    function getPoolPayoutData(uint256) external view override returns (address[] memory, uint256[] memory, uint256) {
        address[] memory a;
        uint256[] memory b;
        return (a, b, 0);
    }

    function getPoolActiveAdapters(uint256) external view override returns (address[] memory) {
        address[] memory a;
        return a;
    }

    function getCapitalPerAdapter(uint256, address) external view override returns (uint256) {
        return 0;
    }

    function addProtocolRiskPool(address, RateModel calldata, uint256) external override returns (uint256) {
        return 0;
    }

    function updateCapitalAllocation(uint256, address, uint256, bool) external override {}

    function updateCapitalPendingWithdrawal(uint256, uint256, bool) external override {}

    function updateCoverageSold(uint256, uint256, bool) external override {}

    function getPoolCount() external view override returns (uint256) {
        return 0;
    }

    function setPauseState(uint256, bool) external override {}

    function setFeeRecipient(uint256, address) external override {}
}

