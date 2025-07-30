// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

/**
 * @title IClaimsCollateralManager Interface
 * @notice Interface for the ClaimsCollateralManager contract.
 */
interface IClaimsCollateralManager {
    /**
     * @notice Called by the RiskManager to deposit a distressed asset (collateral) after a claim.
     * @param claimId A unique identifier for the claim, likely the policyId.
     * @param collateralAsset The address of the ERC20 token being deposited as collateral.
     * @param amount The amount of the collateral asset.
     * @param underwriters An array of underwriter addresses who covered the loss.
     * @param capitalProvided An array of the amount of capital each underwriter provided for the claim.
     */
    function depositCollateral(
        uint256 claimId,
        address collateralAsset,
        uint256 amount,
        address[] calldata underwriters,
        uint256[] calldata capitalProvided
    ) external;

    /**
     * @notice Called by an underwriter to claim their share of the collateral from a specific claim.
     * @param claimId The unique identifier of the claim to claim collateral from.
     */
    function claimCollateral(uint256 claimId) external;
}
