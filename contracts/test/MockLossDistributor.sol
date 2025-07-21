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

    uint256 public distributeLossCallCount;
    uint256 public last_distributeLoss_poolId;
    uint256 public last_distributeLoss_lossAmount;
    uint256 public last_distributeLoss_totalPledge;

    event LossDistributed(uint256 poolId, uint256 lossAmount, uint256 totalPledge);

    function setPendingLoss(address user, uint256 poolId, uint256 amount) external {
        pending[user][poolId] = amount;
    }

    function setRealizeLosses(address user, uint256 poolId, uint256, uint256 amount) external {
        pending[user][poolId] = amount;
    }

    // Added for backward compatibility with older tests expecting a 4-argument function
    function setPendingLosses(address user, uint256 poolId, uint256, uint256 amount) external {
        pending[user][poolId] = amount;
    }

    function distributeLoss(uint256 poolId, uint256 lossAmount, uint256 totalPledgeInPool) external override {
        last_distributeLoss_poolId = poolId;
        last_distributeLoss_lossAmount = lossAmount;
        last_distributeLoss_totalPledge = totalPledgeInPool;
        distributeLossCallCount++;
        emit LossDistributed(poolId, lossAmount, totalPledgeInPool);
    }

    // Updated interface now expects a 2-argument function without a return value
    function realizeLosses(address user, uint256 poolId) external override {
        pending[user][poolId] = 0;
    }

    // Legacy helper used by older tests which returns the realized amount
    function realizeLosses(address user, uint256 poolId, uint256 userPledge) external returns (uint256) {
        userPledge; // silence unused variable warning
        uint256 amount = pending[user][poolId];
        pending[user][poolId] = 0;
        return amount;
    }

    function getPendingLosses(address user, uint256 poolId, uint256 userPledge) external view override returns (uint256) {
        // `userPledge` is unused in this mock but kept for interface compatibility
        userPledge;
        return pending[user][poolId];
    }

    function realizeAggregateLoss(address user, uint256 totalLossValue, uint256[] calldata poolIds) external override {
        pending[user][totalLossValue] = 0;
    }
}
