// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/ILossDistributor.sol";

/**
 * @title MockLossDistributor
 * @notice Simple mock implementing ILossDistributor for testing RiskManager.
 * Allows tests to preset pending losses for a user and pool.
 */
contract MockLossDistributor is ILossDistributor {
    mapping(address => mapping(uint256 => uint256)) public pending;

    event LossDistributed(uint256 poolId, uint256 lossAmount, uint256 totalPledge);

    function setPendingLoss(address user, uint256 poolId, uint256 amount) external {
        pending[user][poolId] = amount;
    }

    function distributeLoss(uint256 poolId, uint256 lossAmount, uint256 totalPledgeInPool) external override {
        emit LossDistributed(poolId, lossAmount, totalPledgeInPool);
    }

    function realizeLosses(address user, uint256 poolId, uint256) external override returns (uint256) {
        uint256 amount = pending[user][poolId];
        pending[user][poolId] = 0;
        return amount;
    }

    function getPendingLosses(address user, uint256 poolId, uint256) external view override returns (uint256) {
        return pending[user][poolId];
    }
}
