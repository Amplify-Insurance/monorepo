// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IClaimsCollateralManager.sol";

/**
 * @title ClaimsCollateralManager
 * @author Gemini
 * @notice Manages distressed assets (collateral) from claims and distributes them to the liable underwriters.
 * @dev This contract acts as a secure escrow for non-fungible claim assets, separating them from fungible premiums.
 */
contract ClaimsCollateralManager is IClaimsCollateralManager, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- State Variables ---
    address public riskManagerAddress;

    struct CollateralShare {
        uint256 amount;
        bool hasClaimed;
    }

    struct ClaimCollateral {
        address collateralAsset;
        uint256 totalAmount;
        uint256 totalCapitalProvided;
        mapping(address => CollateralShare) underwriterShares;
    }

    mapping(uint256 => ClaimCollateral) public claims;

    // --- Events ---
    event RiskManagerSet(address indexed newRiskManager);
    event CollateralDeposited(
        uint256 indexed claimId,
        address indexed collateralAsset,
        uint256 amount
    );
    event CollateralClaimed(
        uint256 indexed claimId,
        address indexed underwriter,
        uint256 amount
    );

    // --- Errors ---
    error ZeroAddress();
    error NotRiskManager();
    error InvalidInput();
    error NoCollateralToClaim();
    error AlreadyClaimed();

    // --- Constructor ---
    constructor(address _riskManagerAddress, address _initialOwner) Ownable(_initialOwner) {
        if (_riskManagerAddress == address(0)) revert ZeroAddress();
        riskManagerAddress = _riskManagerAddress;
        emit RiskManagerSet(_riskManagerAddress);
    }

    /* ───────────────────── Modifiers ───────────────────── */
    modifier onlyRiskManager() {
        if (msg.sender != riskManagerAddress) revert NotRiskManager();
        _;
    }

    /* ───────────────────── Admin Functions ───────────────────── */
    function setRiskManager(address _newRiskManagerAddress) external onlyOwner {
        if (_newRiskManagerAddress == address(0)) revert ZeroAddress();
        riskManagerAddress = _newRiskManagerAddress;
        emit RiskManagerSet(_newRiskManagerAddress);
    }

    /* ───────────────────── Core Logic ───────────────────── */

    /**
     * @notice Called by the RiskManager to deposit a distressed asset (collateral) after a claim.
     */
    function depositCollateral(
        uint256 claimId,
        address collateralAsset,
        uint256 amount,
        address[] calldata underwriters,
        uint256[] calldata capitalProvided
    ) external override onlyRiskManager {
        if (collateralAsset == address(0) || amount == 0 || underwriters.length != capitalProvided.length || underwriters.length == 0) {
            revert InvalidInput();
        }

        ClaimCollateral storage claim = claims[claimId];
        require(claim.collateralAsset == address(0), "Claim already exists"); // Prevent re-initialization

        // Pull the asset from the RiskManager
        IERC20(collateralAsset).safeTransferFrom(msg.sender, address(this), amount);

        claim.collateralAsset = collateralAsset;
        claim.totalAmount = amount;

        uint256 totalCapital = 0;
        for (uint i = 0; i < underwriters.length; i++) {
            claim.underwriterShares[underwriters[i]].amount = capitalProvided[i];
            totalCapital += capitalProvided[i];
        }
        claim.totalCapitalProvided = totalCapital;

        emit CollateralDeposited(claimId, collateralAsset, amount);
    }

    /**
     * @notice Called by an underwriter to claim their share of the collateral from a specific claim.
     */
    function claimCollateral(uint256 claimId) external override nonReentrant {
        ClaimCollateral storage claim = claims[claimId];
        CollateralShare storage share = claim.underwriterShares[msg.sender];

        if (share.amount == 0) revert NoCollateralToClaim();
        if (share.hasClaimed) revert AlreadyClaimed();

        share.hasClaimed = true;

        // Calculate the proportional share of the collateral
        uint256 claimableAmount = (claim.totalAmount * share.amount) / claim.totalCapitalProvided;

        if (claimableAmount > 0) {
            IERC20(claim.collateralAsset).safeTransfer(msg.sender, claimableAmount);
        }

        emit CollateralClaimed(claimId, msg.sender, claimableAmount);
    }

    /* ───────────────────── View Functions ───────────────────── */

    /**
     * @notice View a specific underwriter's share of collateral for a given claim.
     * @param claimId The ID of the claim.
     * @param underwriter The address of the underwriter.
     * @return amount The proportional amount of collateral the underwriter is entitled to.
     * @return hasClaimed Whether the underwriter has already claimed their share.
     */
    function getUnderwriterClaimStatus(uint256 claimId, address underwriter) 
        public 
        view 
        returns (uint256 amount, bool hasClaimed)
    {
        ClaimCollateral storage claim = claims[claimId];
        CollateralShare storage share = claim.underwriterShares[underwriter];
        
        if (share.amount == 0 || claim.totalCapitalProvided == 0) {
            return (0, share.hasClaimed);
        }

        amount = (claim.totalAmount * share.amount) / claim.totalCapitalProvided;
        hasClaimed = share.hasClaimed;
    }
}