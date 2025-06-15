// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
    function applyLosses(address underwriter, uint256 principalLossAmount) external;
    function underlyingAsset() external view returns (IERC20);
    function executePayout(PayoutData calldata payoutData) external;
    function getUnderwriterAdapterAddress(address underwriter) external view returns (address);
    function getUnderwriterAccount(address underwriter) external view returns (uint256, uint8, uint256, uint256, uint256);
    function sharesToValue(uint256 shares) external view returns (uint256);
}
