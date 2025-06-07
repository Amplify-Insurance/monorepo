// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RiskManager.sol";

/**
 * @title ReentrancyAttacker
 * @dev Simple contract used in tests to ensure RiskManager's nonReentrant
 *      modifiers correctly block re-entrancy attempts. Each attack function
 *      performs the desired action twice in the same transaction.
 */
contract ReentrancyAttacker {
    RiskManager public riskManager;

    constructor(address _riskManager) {
        riskManager = RiskManager(_riskManager);
    }

    function beginAttack(uint256[] calldata poolIds) external {
        riskManager.allocateCapital(poolIds);
        riskManager.allocateCapital(poolIds);
    }

    function beginAttack(uint256 poolId) external {
        riskManager.claimPremiumRewards(poolId);
        riskManager.claimPremiumRewards(poolId);
    }

    function beginDistressedAssetAttack(uint256 poolId) external {
        riskManager.claimDistressedAssets(poolId);
        riskManager.claimDistressedAssets(poolId);
    }
}
