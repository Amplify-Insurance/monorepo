// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

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
 * @notice Orchestrates claim processing and liquidations for the protocol.
 */
contract RiskManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- State Variables ---

    ICapitalPool public capitalPool;
    IPoolRegistry public poolRegistry;
    IPolicyNFT public policyNFT;
    IBackstopPool public catPool;
    ILossDistributor public lossDistributor;
    IRewardDistributor public rewardDistributor;
    IUnderwriterManager public underwriterManager;
    address public policyManager;
    address public committee;

    uint256 public constant CLAIM_FEE_BPS = 500; // 5%
    uint256 public constant BPS = 10_000;

    // --- Structs ---

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

    // --- Events ---

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

    // --- Errors ---

    error NotPolicyManager();
    error UnderwriterNotInsolvent();
    error ZeroAddressNotAllowed();
    error OnlyPolicyOwner();

    // --- Constructor ---

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    // --- Owner Functions ---

    /**
     * @notice Set core contract addresses. Owner only.
     */
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
            _capital == address(0) ||
            _registry == address(0) ||
            _policyManager == address(0) ||
            _cat == address(0) ||
            _loss == address(0) ||
            _rewards == address(0) ||
            _underwriterManager == address(0)
        ) revert ZeroAddressNotAllowed();

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

    /**
     * @notice Update the committee address. Owner only.
     */
    function setCommittee(address _newCommittee) external onlyOwner {
        if (_newCommittee == address(0)) revert ZeroAddressNotAllowed();
        committee = _newCommittee;
        emit CommitteeSet(_newCommittee);
    }

    // --- Public Functions ---

    /**
     * @notice Liquidate an underwriter if their pending losses exceed their capital.
     */
    function liquidateInsolventUnderwriter(address _underwriter) external nonReentrant {
        _checkInsolvency(_underwriter);
        underwriterManager.realizeLossesForAllPools(_underwriter);
        emit UnderwriterLiquidated(msg.sender, _underwriter);
    }

    /**
     * @notice Process a claim: distribute premium, allocate losses, payout claimant, update state, burn policy.
     */
    function processClaim(uint256 policyId) external nonReentrant {
        ClaimData memory data = _prepareClaimData(policyId);
        if (msg.sender != data.claimant) revert OnlyPolicyOwner();

        _distributePremium(data);
        uint256 lossBorneByPool = _distributeLosses(data);
        _executePayout(data);
        _updatePoolState(data, lossBorneByPool);

        policyNFT.burn(policyId);
    }

    /**
     * @notice Update coverage sold; only callable by PolicyManager.
     */
    function updateCoverageSold(uint256 poolId, uint256 amount, bool isSale) external {
        if (msg.sender != policyManager) revert NotPolicyManager();
        poolRegistry.updateCoverageSold(poolId, amount, isSale);
    }

    // --- Internal Functions ---

    /**
     * @dev Distributes premium to the reward distributor if applicable.
     */
    function _distributePremium(ClaimData memory _data) internal {
        if (_data.policy.coverage == 0 || address(_data.protocolToken) == address(0)) return;

        uint8 protocolDecimals = IERC20Metadata(address(_data.protocolToken)).decimals();
        uint8 underlyingDecimals = IERC20Metadata(address(capitalPool.underlyingAsset())).decimals();
        uint256 protocolCoverage = _scaleAmount(_data.policy.coverage, underlyingDecimals, protocolDecimals);

        _data.protocolToken.safeTransferFrom(msg.sender, address(rewardDistributor), protocolCoverage);
        rewardDistributor.distribute(
            _data.policy.poolId,
            address(_data.protocolToken),
            protocolCoverage,
            _data.totalCapitalPledged
        );
    }

    /**
     * @dev Distributes losses to LPs and draws from the backstop pool if there's a shortfall.
     */
    function _distributeLosses(ClaimData memory _data) internal returns (uint256) {
        uint256 coverage = _data.policy.coverage;
        uint256 totalCapital = _data.totalCapitalPledged;

        lossDistributor.distributeLoss(_data.policy.poolId, coverage, totalCapital);

        uint256 lossBorneByPool = Math.min(coverage, totalCapital);
        uint256 shortfall = coverage > lossBorneByPool ? coverage - lossBorneByPool : 0;
        if (shortfall > 0) {
            catPool.drawFund(shortfall);
        }
        return lossBorneByPool;
    }

    /**
     * @dev Executes the claim payout to the claimant and sends the fee to the committee.
     */
    function _executePayout(ClaimData memory _data) internal {
        uint256 claimFee = (_data.policy.coverage * _data.poolClaimFeeBps) / BPS;
        uint256 payoutAmount = _data.policy.coverage > claimFee ? _data.policy.coverage - claimFee : 0;

        ICapitalPool.PayoutData memory payoutData = ICapitalPool.PayoutData({
            claimant: _data.claimant,
            claimantAmount: payoutAmount,
            feeRecipient: committee,
            feeAmount: claimFee,
            adapters: _data.adapters,
            capitalPerAdapter: _data.capitalPerAdapter,
            totalCapitalFromPoolLPs: _data.totalCapitalPledged
        });
        capitalPool.executePayout(payoutData);
    }

    /**
     * @dev Updates the pool's capital allocation and total coverage sold after a claim.
     */
    function _updatePoolState(ClaimData memory _data, uint256 lossBorneByPool) internal {
        if (lossBorneByPool > 0 && _data.totalCapitalPledged > 0) {
            for (uint256 i = 0; i < _data.adapters.length; i++) {
                uint256 adapterLoss = Math.mulDiv(
                    lossBorneByPool,
                    _data.capitalPerAdapter[i],
                    _data.totalCapitalPledged
                );
                if (adapterLoss > 0) {
                    poolRegistry.updateCapitalAllocation(_data.policy.poolId, _data.adapters[i], adapterLoss, false);
                }
            }
        }
        // Only reduce coverage sold if there is existing coverage to deduct
        uint256 reduction = Math.min(_data.policy.coverage, _data.totalCoverageSold);
        if (reduction > 0) {
            poolRegistry.updateCoverageSold(_data.policy.poolId, reduction, false);
        }
    }

    /**
     * @dev Gather all data needed for claim processing and enforce activation.
     */
    function _prepareClaimData(uint256 _policyId) internal view returns (ClaimData memory data) {
        data.policy = policyNFT.getPolicy(_policyId);
        require(block.timestamp >= data.policy.activation, "Policy not active");
        data.claimant = policyNFT.ownerOf(_policyId);
        (data.adapters, data.capitalPerAdapter, data.totalCapitalPledged) =
            poolRegistry.getPoolPayoutData(data.policy.poolId);
        (
            data.protocolToken,
            ,
            data.totalCoverageSold,
            ,
            ,
            ,
            data.poolClaimFeeBps
        ) = poolRegistry.getPoolData(data.policy.poolId);
    }

    /**
     * @dev Checks if an underwriter's pending losses exceed their total capital value.
     */
    function _checkInsolvency(address _underwriter) internal view {
        (, , uint256 masterShares, , ) = capitalPool.getUnderwriterAccount(_underwriter);
        if (masterShares == 0) revert UnderwriterNotInsolvent();

        uint256 totalValue = capitalPool.sharesToValue(masterShares);
        uint256[] memory allocs = underwriterManager.getUnderwriterAllocations(_underwriter);
        uint256 totalPendingLosses;
        for (uint256 i = 0; i < allocs.length; i++) {
            uint256 pid = allocs[i];
            uint256 pledge = underwriterManager.underwriterPoolPledge(_underwriter, pid);
            totalPendingLosses += lossDistributor.getPendingLosses(_underwriter, pid, pledge);
        }
        if (totalPendingLosses <= totalValue) revert UnderwriterNotInsolvent();
    }

    /**
     * @dev Scales an amount between different decimal precisions.
     */
    function _scaleAmount(
        uint256 amount,
        uint8 fromDecimals,
        uint8 toDecimals
    ) internal pure returns (uint256) {
        if (toDecimals > fromDecimals) {
            return amount * (10**(toDecimals - fromDecimals));
        } else if (toDecimals < fromDecimals) {
            return amount / (10**(fromDecimals - toDecimals));
        }
        return amount;
    }
}
