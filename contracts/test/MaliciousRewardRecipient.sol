// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {UnderwriterManager} from "contracts/core/UnderwriterManager.sol";
import {IRewardDistributor} from "contracts/interfaces/IRewardDistributor.sol";

/**
 * @title MaliciousRewardRecipient
 * @author Gemini
 * @notice A mock contract designed to test reentrancy vulnerabilities.
 * @dev This contract acts as an underwriter that, upon receiving rewards,
 * immediately tries to call the claim function again before the initial call has completed.
 * This is used to verify the effectiveness of a ReentrancyGuard.
 */
contract MaliciousRewardRecipient {
    IRewardDistributor public immutable rewardDistributor;
    address public immutable riskManager;
    address public usdcToken;

    uint256 public poolIdToAttack;
    uint256 public pledgeToAttack;

    /**
     * @param _rewardDistributor The address of the RewardDistributor contract to attack.
     * @param _riskManager The address of the RiskManager, needed to impersonate for the re-entrant call.
     */
    constructor(address _rewardDistributor, address _riskManager) {
        rewardDistributor = IRewardDistributor(_rewardDistributor);
        riskManager = _riskManager;
    }

    /**
     * @notice A helper function for the test setup to deposit and allocate capital.
     * @param _capitalPool The address of the CapitalPool.
     * @param _um The address of the UnderwriterManager.
     * @param _poolId The ID of the pool to allocate capital to.
     * @param _amount The amount of USDC to deposit and pledge.
     */
    function depositAndAllocate(
        CapitalPool _capitalPool,
        UnderwriterManager _um,
        uint256 _poolId,
        uint256 _amount
    ) external {
        // Store necessary variables for the re-entrant call
        usdcToken = address(_capitalPool.underlyingAsset());
        poolIdToAttack = _poolId;
        pledgeToAttack = _amount;

        // Standard deposit and allocation flow
        IERC20(usdcToken).approve(address(_capitalPool), _amount);
        _capitalPool.deposit(_amount, CapitalPool.YieldPlatform(3));
        
        uint256[] memory pools = new uint256[](1);
        pools[0] = _poolId;
        _um.allocateCapital(pools);
    }

    /**
     * @notice This function is called when the RewardDistributor transfers rewards via `safeTransfer`.
     * @dev It immediately attempts to call the `claim` function again, simulating a reentrancy attack.
     * The test using this contract must use `vm.prank(riskManager)` to ensure the re-entrant call
     * has the necessary permissions to pass the modifier checks, thereby isolating the test
     * to the ReentrancyGuard itself.
     */
    receive() external payable {
        // To prevent an infinite loop in a scenario where the guard might fail,
        // we check if there's still a balance to drain.
        if (IERC20(usdcToken).balanceOf(address(rewardDistributor)) > 0) {
            // Maliciously re-enter the claim function.
            rewardDistributor.claim(address(this), poolIdToAttack, usdcToken, pledgeToAttack);
        }
    }
}
