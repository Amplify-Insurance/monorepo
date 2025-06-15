// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../core/RiskManager.sol";

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

    // The RiskManager contract no longer exposes reward claiming functions in
    // the current version of the protocol. These attack helpers previously
    // attempted to call `claimPremiumRewards` and `claimDistressedAssets` twice
    // to verify the `nonReentrant` modifier. They are retained as no-op
    // functions to keep older tests compiling.
    function beginAttack(uint256 poolId) external pure {
        revert("claimPremiumRewards removed");
    }

    function beginDistressedAssetAttack(uint256 poolId) external pure {
        revert("claimDistressedAssets removed");
    }
}
