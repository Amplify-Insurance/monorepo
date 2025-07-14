// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// --- Interfaces ---
import {IPolicyNFT} from "../interfaces/IPolicyNFT.sol";
import {IPoolRegistry} from "../interfaces/IPoolRegistry.sol";
import {ICapitalPool} from "../interfaces/ICapitalPool.sol";
import {IBackstopPool} from "../interfaces/IBackstopPool.sol";
import {ILossDistributor} from "../interfaces/ILossDistributor.sol";
import {IRewardDistributor} from "../interfaces/IRewardDistributor.sol";
import {IUnderwriterManager} from "../interfaces/IUnderwriterManager.sol";
import {IPolicyManager} from "../interfaces/IPolicyManager.sol";

/**
 * @title RiskManager
 * @author Gemini
 * @notice A lean orchestrator for a decentralized insurance protocol. It manages
 * claim processing and liquidations by coordinating with specialized satellite contracts.
 * This contract is not intended for direct user interaction.
 */
contract RiskManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ───────────────────────── State Variables ───────────────────────── */
    ICapitalPool public capitalPool;
    IPoolRegistry public poolRegistry;
    IPolicyNFT public policyNFT;
    IBackstopPool public catPool;
    ILossDistributor public lossDistributor;
    IRewardDistributor public rewardDistributor;
    IUnderwriterManager public underwriterManager;
    address public policyManager;
    address public committee; // Governance or emergency committee

    uint256 public constant CLAIM_FEE_BPS = 500;
    uint256 public constant BPS = 10_000;

    /**
     * @dev A struct to hold all necessary data for claim processing,
     * used to avoid "Stack too deep" errors.
     */
    struct ClaimData {
        IPolicyNFT.Policy policy;
        address claimant;
        uint256 totalCapitalPledged;
        IERC20 protocolToken;
        uint256 poolClaimFeeBps;
        address[] adapters;
        uint256[] capitalPerAdapter;
        uint256 totalCoverageSold;
    }

    /* ───────────────────────── Events ───────────────────────── */
    event AddressesSet(
        address capital,
        address registry,
        address policyMgr,
        address cat,
        address loss,
        address rewards,
        address underwriterMgr
    );
    event CommitteeSet(address committee);
    event UnderwriterLiquidated(address indexed liquidator, address indexed underwriter);

    /* ───────────────────────── Errors ───────────────────────── */
    error NotPolicyManager();
    error UnderwriterNotInsolvent();
    error ZeroAddressNotAllowed();
    error OnlyPolicyOwner();

    /* ───────────────────── Constructor & Setup ───────────────────── */

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    function setAddresses(
        address _capital,
        address _registry,
        address _policyManager,
        address _cat,
        address _loss,
        address _rewards,
        address _underwriterManager
    ) external onlyOwner {
        if (
            _capital == address(0) || _registry == address(0) || _policyManager == address(0) || _cat == address(0)
                || _loss == address(0) || _rewards == address(0) || _underwriterManager == address(0)
        ) {
            revert ZeroAddressNotAllowed();
        }

        capitalPool = ICapitalPool(_capital);
        poolRegistry = IPoolRegistry(_registry);
        policyManager = _policyManager;
        policyNFT = IPolicyManager(_policyManager).policyNFT();
        catPool = IBackstopPool(_cat);
        lossDistributor = ILossDistributor(_loss);
        rewardDistributor = IRewardDistributor(_rewards);
        underwriterManager = IUnderwriterManager(_underwriterManager);

        emit AddressesSet(_capital, _registry, _policyManager, _cat, _loss, _rewards, _underwriterManager);
    }

    function setCommittee(address _newCommittee) external onlyOwner {
        if (_newCommittee == address(0)) revert ZeroAddressNotAllowed();
        committee = _newCommittee;
        emit CommitteeSet(_newCommittee);
    }

    /* ───────────────────── Keeper & Liquidation Functions ───────────────────── */

    function liquidateInsolventUnderwriter(address _underwriter) external nonReentrant {
        // --- CHECKS & PREPARE ---
        _checkInsolvency(_underwriter);

        // --- EFFECTS ---
        // The UnderwriterManager is responsible for realizing the losses.
        underwriterManager.realizeLossesForAllPools(_underwriter);

        emit UnderwriterLiquidated(msg.sender, _underwriter);
    }

    /* ───────────────────── Claim Processing ───────────────────── */

    /**
     * @notice Processes a claim against a policy.
     * @dev This function is the core of the claim process, orchestrating loss distribution,
     * payouts, and state updates.
     * @param policyId The ID of the policy NFT being claimed.
     */

     function processClaim(uint256 policyId) external nonReentrant {
    // --- 1. PREPARE & VALIDATE ---
    ClaimData memory data = _prepareClaimData(policyId);
    if (msg.sender != data.claimant) revert OnlyPolicyOwner();

<<<<<<< HEAD
    // --- 2. PREMIUM DISTRIBUTION ---
    _distributePremium(data);
=======
        // --- 2. PREMIUM DISTRIBUTION (if applicable) ---
        if (coverage > 0) {
            uint8 protocolDecimals = IERC20Metadata(address(data.protocolToken)).decimals();
            uint8 underlyingDecimals = IERC20Metadata(address(capitalPool.underlyingAsset())).decimals();
            uint256 protocolCoverage = _scaleAmount(coverage, underlyingDecimals, protocolDecimals);
            data.protocolToken.safeTransferFrom(msg.sender, address(rewardDistributor), protocolCoverage);
            rewardDistributor.distribute(
                poolId, address(data.protocolToken), protocolCoverage, data.totalCapitalPledged
            );
        }
>>>>>>> c99a8210815d585e217060ce2b5165e07bcfc74f

    // --- 3. LOSS DISTRIBUTION ---
    uint256 lossBorneByPool = _distributeLosses(data);

    // --- 4. PAYOUT EXECUTION ---
    _executePayout(data);

    // --- 5. STATE UPDATES ---
    _updatePoolState(data, lossBorneByPool);

    policyNFT.burn(policyId);
}

function _distributePremium(ClaimData memory _data) internal {
    if (_data.policy.coverage == 0) return;

    uint8 protocolDecimals = IERC20Metadata(address(_data.protocolToken)).decimals();
    uint8 underlyingDecimals = IERC20Metadata(address(capitalPool.underlyingAsset())).decimals();
    uint256 protocolCoverage = _scaleAmount(_data.policy.coverage, underlyingDecimals, protocolDecimals);

    _data.protocolToken.safeTransferFrom(msg.sender, address(rewardDistributor), protocolCoverage);
    rewardDistributor.distribute(_data.policy.poolId, address(_data.protocolToken), protocolCoverage, _data.totalCapitalPledged);
}

function _distributeLosses(ClaimData memory _data) internal returns (uint256) {
    uint256 coverage = _data.policy.coverage;
    uint256 totalCapitalPledged = _data.totalCapitalPledged;

    lossDistributor.distributeLoss(_data.policy.poolId, coverage, totalCapitalPledged);

    uint256 lossBorneByPool = Math.min(coverage, totalCapitalPledged);
    uint256 shortfall = coverage > lossBorneByPool ? coverage - lossBorneByPool : 0;
    if (shortfall > 0) {
        catPool.drawFund(shortfall);
    }
    return lossBorneByPool;
}

function _executePayout(ClaimData memory _data) internal {
    uint256 claimFee = (_data.policy.coverage * _data.poolClaimFeeBps) / BPS;
    ICapitalPool.PayoutData memory payoutData = ICapitalPool.PayoutData({
        claimant: _data.claimant,
        claimantAmount: _data.policy.coverage - claimFee,
        feeRecipient: committee,
        feeAmount: claimFee,
        adapters: _data.adapters,
        capitalPerAdapter: _data.capitalPerAdapter,
        totalCapitalFromPoolLPs: _data.totalCapitalPledged
    });
    capitalPool.executePayout(payoutData);
}

function _updatePoolState(ClaimData memory _data, uint256 _lossBorneByPool) internal {
    if (_lossBorneByPool > 0 && _data.totalCapitalPledged > 0) {
        for (uint256 i = 0; i < _data.adapters.length; i++) {
            uint256 adapterLoss = (_lossBorneByPool * _data.capitalPerAdapter[i]) / _data.totalCapitalPledged;
            if (adapterLoss > 0) {
                poolRegistry.updateCapitalAllocation(_data.policy.poolId, _data.adapters[i], adapterLoss, false);
            }
        }
    }

    uint256 reduction = Math.min(_data.policy.coverage, _data.totalCoverageSold);
    if (reduction > 0) {
        poolRegistry.updateCoverageSold(_data.policy.poolId, reduction, false);
    }
}

    /* ───────────────── Hooks ───────────────── */

    function updateCoverageSold(uint256 poolId, uint256 amount, bool isSale) external {
        if (msg.sender != policyManager) revert NotPolicyManager();
        poolRegistry.updateCoverageSold(poolId, amount, isSale);
    }

    /* ───────────────── Internal Helper Functions ───────────────── */

    function _prepareClaimData(uint256 _policyId) internal view returns (ClaimData memory data) {
        data.policy = policyNFT.getPolicy(_policyId);
        require(block.timestamp >= data.policy.activation, "Policy not active");

        data.claimant = policyNFT.ownerOf(_policyId);

        (data.adapters, data.capitalPerAdapter, data.totalCapitalPledged) =
            poolRegistry.getPoolPayoutData(data.policy.poolId);

        (
            data.protocolToken,
            , // _pledged
            data.totalCoverageSold,
            , // _pending
            , // _paused
            , // _feeRecipient
            data.poolClaimFeeBps
        ) = poolRegistry.getPoolData(data.policy.poolId);
    }

    function _checkInsolvency(address _underwriter) internal view {
        // 1a) Read the underwriter’s account value from CapitalPool
        (,, uint256 masterShares,,) = capitalPool.getUnderwriterAccount(_underwriter);
        if (masterShares == 0) {
            revert UnderwriterNotInsolvent();
        }
        uint256 totalShareValue = capitalPool.sharesToValue(masterShares);

        // 1b) Loop over allocations (from UnderwriterManager) to sum up pending losses
        uint256[] memory allocs = underwriterManager.getUnderwriterAllocations(_underwriter);
        uint256 totalPendingLosses = 0;
        for (uint256 i = 0; i < allocs.length; i++) {
            uint256 pid = allocs[i];
            uint256 pledge = underwriterManager.underwriterPoolPledge(_underwriter, pid);
            totalPendingLosses += lossDistributor.getPendingLosses(_underwriter, pid, pledge);
        }

        // 1c) Verify insolvency condition
        if (totalPendingLosses < totalShareValue) {
            revert UnderwriterNotInsolvent();
        }
    }

    function _scaleAmount(uint256 amount, uint8 fromDecimals, uint8 toDecimals) internal pure returns (uint256) {
        if (toDecimals > fromDecimals) {
            return amount * (10 ** (toDecimals - fromDecimals));
        } else if (toDecimals < fromDecimals) {
            return amount / (10 ** (fromDecimals - toDecimals));
        }
        return amount;
    }
}
