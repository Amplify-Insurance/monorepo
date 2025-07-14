// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// --- Interfaces ---

interface IPolicyNFT {
    struct Policy {
        uint256 poolId;
        uint256 coverage;
        uint256 premium;
        uint256 activation;
        uint256 expiration;
    }
    function getPolicy(uint256 policyId) external view returns (Policy memory);
    function ownerOf(uint256 policyId) external view returns (address);
    function burn(uint256 policyId) external;
}

interface IPoolRegistry {
    function getPoolPayoutData(uint256 poolId) external view returns (address[] memory, uint256[] memory, uint256);
    function getPoolData(uint256 poolId) external view returns (IERC20, uint256, uint256, uint256, bool, address, uint256);
    function updateCapitalAllocation(uint256 poolId, address adapter, uint256 amount, bool isAllocation) external;
    function updateCoverageSold(uint256 poolId, uint256 amount, bool isSale) external;
}

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
    function executePayout(PayoutData calldata data) external;
    function underlyingAsset() external view returns (address);
    function getUnderwriterAccount(address underwriter) external view returns (uint256, uint256, uint256, uint256, uint256);
    function sharesToValue(uint256 shares) external view returns (uint256);
}

interface IBackstopPool {
    function drawFund(uint256 amount) external;
}

interface ILossDistributor {
    function distributeLoss(uint256 poolId, uint256 lossAmount, uint256 totalPledge) external;
    function getPendingLosses(address user, uint256 poolId, uint256 pledge) external view returns (uint256);
}

interface IRewardDistributor {
    function distribute(uint256 poolId, address token, uint256 amount, uint256 totalPledge) external;
}

// Interface for the new UnderwriterManager contract
interface IUnderwriterManager {
    function getUnderwriterAllocations(address user) external view returns (uint256[] memory);
    function underwriterPoolPledge(address user, uint256 poolId) external view returns (uint256);
    function realizeLossesForAllPools(address user) external;
}

interface IPolicyManager {
    function policyNFT() external view returns (IPolicyNFT);
}


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
        if (_capital == address(0) || _registry == address(0) || _policyManager == address(0) || _cat == address(0)
            || _loss == address(0) || _rewards == address(0) || _underwriterManager == address(0)) {
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

        uint256 poolId = data.policy.poolId;
        uint256 coverage = data.policy.coverage;

        // --- 2. PREMIUM DISTRIBUTION (if applicable) ---
        if (coverage > 0) {
            uint8 protocolDecimals = IERC20Metadata(address(data.protocolToken)).decimals();
            uint8 underlyingDecimals = IERC20Metadata(address(capitalPool.underlyingAsset())).decimals();
            uint256 protocolCoverage = _scaleAmount(coverage, underlyingDecimals, protocolDecimals);
            data.protocolToken.safeTransferFrom(msg.sender, address(rewardDistributor), protocolCoverage);
            rewardDistributor.distribute(poolId, address(data.protocolToken), protocolCoverage, data.totalCapitalPledged);
        }

        // --- 3. LOSS DISTRIBUTION ---
        lossDistributor.distributeLoss(poolId, coverage, data.totalCapitalPledged);

        uint256 lossBorneByPool = Math.min(coverage, data.totalCapitalPledged);
        uint256 shortfall = coverage > lossBorneByPool ? coverage - lossBorneByPool : 0;
        if (shortfall > 0) {
            catPool.drawFund(shortfall);
        }

        // --- 4. PAYOUT EXECUTION ---
        uint256 claimFee = (coverage * data.poolClaimFeeBps) / BPS;
        ICapitalPool.PayoutData memory payoutData = ICapitalPool.PayoutData({
            claimant: data.claimant,
            claimantAmount: coverage - claimFee,
            feeRecipient: committee,
            feeAmount: claimFee,
            adapters: data.adapters,
            capitalPerAdapter: data.capitalPerAdapter,
            totalCapitalFromPoolLPs: data.totalCapitalPledged
        });
        capitalPool.executePayout(payoutData);

        // --- 5. STATE UPDATES (Post-Payout) ---
        if (lossBorneByPool > 0 && data.totalCapitalPledged > 0) {
            for (uint256 i = 0; i < data.adapters.length; i++) {
                uint256 adapterLoss = (lossBorneByPool * data.capitalPerAdapter[i]) / data.totalCapitalPledged;
                if (adapterLoss > 0) {
                    poolRegistry.updateCapitalAllocation(poolId, data.adapters[i], adapterLoss, false);
                }
            }
        }

        uint256 reduction = Math.min(coverage, data.totalCoverageSold);
        if (reduction > 0) {
            poolRegistry.updateCoverageSold(poolId, reduction, false);
        }

        policyNFT.burn(policyId);
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