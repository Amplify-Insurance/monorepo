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
 * @author Gemini
 * @notice Orchestrates claim processing and liquidations.
 * @dev CORRECTED: processClaim now correctly records the loss against underwriter pledges
 * in the UnderwriterManager, ensuring available capacity is accurately calculated.
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
    event ClaimProcessed(uint256 indexed policyId, uint256 amountClaimed, bool isFullClaim);

    // --- Errors ---

    error NotPolicyManager();
    error UnderwriterNotInsolvent();
    error ZeroAddressNotAllowed();
    error OnlyPolicyOwner();
    error PolicyNotActive();
    error InvalidClaimAmount();

    // --- Constructor ---

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    // --- Owner Functions ---

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
            _capital == address(0) || _registry == address(0) || _policyManager == address(0) ||
            _cat == address(0) || _loss == address(0) || _rewards == address(0) ||
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

    function setCommittee(address _newCommittee) external onlyOwner {
        if (_newCommittee == address(0)) revert ZeroAddressNotAllowed();
        committee = _newCommittee;
        emit CommitteeSet(_newCommittee);
    }

    // --- Public Functions ---

    function liquidateInsolventUnderwriter(address _underwriter) external nonReentrant {
        _checkInsolvency(_underwriter);
        underwriterManager.realizeLossesForAllPools(_underwriter);
        emit UnderwriterLiquidated(msg.sender, _underwriter);
    }

    function processClaim(uint256 policyId, uint256 claimAmount) external nonReentrant {
        address claimant = policyNFT.ownerOf(policyId);
        if (msg.sender != claimant) revert OnlyPolicyOwner();

        IPolicyNFT.Policy memory policy = policyNFT.getPolicy(policyId);
        if (block.timestamp < policy.activation) revert PolicyNotActive();
        if (claimAmount == 0 || claimAmount > policy.coverage) revert InvalidClaimAmount();

        ClaimData memory data = _prepareClaimData(policy, claimant);

        uint256 pendingAmountCancelled = IPolicyManager(policyManager)
            .clearIncreasesAndGetPendingAmount(policyId);
        uint256 totalReduction = claimAmount + pendingAmountCancelled;

        _distributePremium(data, claimAmount);
        
        uint256 lossBorneByPool = _distributeLossesAndRecord(data, claimAmount);
        
        // --- FIX: Notify UnderwriterManager of the loss to update pledges ---
        address[] memory underwriters = underwriterManager.getPoolUnderwriters(policy.poolId);
        for (uint i = 0; i < underwriters.length; i++) {
            underwriterManager.recordLossAgainstPledge(underwriters[i], policy.poolId, claimAmount);
        }
        // --- End of FIX ---
        
        _executePayout(data, claimAmount, lossBorneByPool);

        bool isFullClaim = (claimAmount == policy.coverage);
        
        if (isFullClaim) {
            policyNFT.burn(policyId);
        } else {
            policyNFT.reduceCoverage(policyId, claimAmount);
        }
        
        poolRegistry.updateCoverageSold(policy.poolId, totalReduction, false);

        emit ClaimProcessed(policyId, claimAmount, isFullClaim);
    }

    function updateCoverageSold(uint256 poolId, uint256 amount, bool isSale) external {
        if (msg.sender != policyManager) revert NotPolicyManager();
        poolRegistry.updateCoverageSold(poolId, amount, isSale);
    }

    // --- Internal Functions ---

    function _distributePremium(ClaimData memory _data, uint256 _claimAmount) internal {
        if (_claimAmount == 0 || address(_data.protocolToken) == address(0)) return;

        uint8 protocolDecimals = IERC20Metadata(address(_data.protocolToken)).decimals();
        uint8 underlyingDecimals = IERC20Metadata(address(capitalPool.underlyingAsset())).decimals();
        uint256 protocolCoverage = _scaleAmount(_claimAmount, underlyingDecimals, protocolDecimals);

        _data.protocolToken.safeTransferFrom(msg.sender, address(rewardDistributor), protocolCoverage);
        rewardDistributor.distribute(
            _data.policy.poolId,
            address(_data.protocolToken),
            protocolCoverage,
            _data.totalCapitalPledged
        );
    }

    function _distributeLossesAndRecord(ClaimData memory _data, uint256 _claimAmount) internal returns (uint256) {
        uint256 lossBorneByPool = Math.min(_claimAmount, _data.totalCapitalPledged);

        if (lossBorneByPool > 0) {
            lossDistributor.distributeLoss(
                _data.policy.poolId,
                lossBorneByPool,
                _data.totalCapitalPledged
            );
        }
        
        uint256 shortfall = _claimAmount > lossBorneByPool ? _claimAmount - lossBorneByPool : 0;
        if (shortfall > 0) {
            catPool.drawFund(shortfall);
        }
        return lossBorneByPool;
    }

    function _executePayout(ClaimData memory _data, uint256 _claimAmount, uint256 _lossBorneByPool) internal {
        uint256 claimFee = (_claimAmount * _data.poolClaimFeeBps) / BPS;
        uint256 payoutAmount = _claimAmount > claimFee ? _claimAmount - claimFee : 0;

        ICapitalPool.PayoutData memory payoutData = ICapitalPool.PayoutData({
            claimant: _data.claimant,
            claimantAmount: payoutAmount,
            feeRecipient: committee,
            feeAmount: claimFee,
            adapters: _data.adapters,
            capitalPerAdapter: _data.capitalPerAdapter,
            totalCapitalFromPoolLPs: _lossBorneByPool
        });
        capitalPool.executePayout(payoutData);
    }

    function _prepareClaimData(
        IPolicyNFT.Policy memory _policy,
        address _claimant
    ) internal view returns (ClaimData memory data) {
        data.policy = _policy;
        data.claimant = _claimant;
        
        (data.adapters, data.capitalPerAdapter, data.totalCapitalPledged) =
            underwriterManager.getPoolPayoutData(data.policy.poolId);
        
        (data.protocolToken,,,,data.poolClaimFeeBps,) = poolRegistry.getPoolStaticData(data.policy.poolId);
    }

    function _checkInsolvency(address _underwriter) internal view {
        (, , uint256 masterShares, ) = capitalPool.getUnderwriterAccount(_underwriter);
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
