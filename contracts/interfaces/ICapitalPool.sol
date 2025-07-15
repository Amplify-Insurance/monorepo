// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// NEW: The YieldPlatform enum is now defined in the public interface
// so it can be used by any contract that imports it.
enum YieldPlatform { NONE, AAVE, COMPOUND, OTHER_YIELD }

interface ICapitalPool {
    struct PayoutData {
        address claimant;
        uint256 claimantAmount;
        address feeRecipient;
        uint256 feeAmount;
        address[] adapters;
        uint256[] capitalPerAdapter;
        uint256 totalCapitalFromPoolLPs;
    }
    
    function deposit(uint256 amount, YieldPlatform yieldChoice) external;
    function getUnderwriterAdapterAddress(address underwriter) external view returns(address);
    function applyLosses(address underwriter, uint256 amount) external;
    function underlyingAsset() external view returns (IERC20);
    function getUnderwriterAccount(address underwriter) external view returns (uint256, YieldPlatform, uint256, uint256);
    function sharesToValue(uint256 shares) external view returns (uint256);
    function executePayout(PayoutData calldata payoutData) external;
}
