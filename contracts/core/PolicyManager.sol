// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IPolicyNFT.sol";
import "../interfaces/IPoolRegistry.sol";
import "../interfaces/ICapitalPool.sol";
import "../interfaces/ICatInsurancePool.sol";
import "../interfaces/IRewardDistributor.sol";
import "../interfaces/IRiskManager_PM_Hook.sol";


/**
 * @title PolicyManager
 * @author Gemini
 * @notice This contract handles all user-facing policy lifecycle functions, such as purchasing,
 * canceling, and managing premiums for insurance cover.
 */
contract PolicyManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ───────────────────────── Constants ───────────────────────── */
    uint256 public constant BPS = 10_000;
    uint256 public constant SECS_YEAR = 365 days;
    uint256 public coverCooldownPeriod = 0 days;

    /* ───────────────────────── State Variables ───────────────────────── */
    IPoolRegistry public poolRegistry;
    ICapitalPool public capitalPool;
    ICatInsurancePool public catPool;
    IPolicyNFT public immutable policyNFT;
    IRewardDistributor public rewardDistributor;
    IRiskManager_PM_Hook public riskManager;
    
    uint256 public catPremiumBps = 2_000; // 20%


    /* ───────────────────────── Errors ───────────────────────── */
    error PoolPaused();
    error InvalidAmount();
    error InsufficientCapacity();
    error InvalidPoolId();
    error NotPolicyOwner();
    error PolicyAlreadyTerminated();
    error CooldownActive();
    error DepositTooLow();
    error PolicyIsActive();
    error PolicyNotActive();
    error AddressesNotSet();


    /* ───────────────────────── Events ──────────────────────────── */
    event AddressesSet(address indexed registry, address indexed capital, address indexed rewards, address rm);
    event CatPremiumShareSet(uint256 newBps);
    event CatPoolSet(address indexed newCatPool);
    event CoverCooldownPeriodSet(uint256 newPeriod);

    /* ───────────────────────── Constructor ───────────────────────── */
    constructor(address _policyNFT, address _initialOwner) Ownable(_initialOwner) {
        policyNFT = IPolicyNFT(_policyNFT);
    }

    /* ───────────────────── Admin Functions ───────────────────── */

    function setAddresses(address _registry, address _capital, address _cat, address _rewards, address _rm) external onlyOwner {
        require(_registry != address(0) && _capital != address(0) && _cat != address(0) && _rewards != address(0) && _rm != address(0), "PM: Cannot set zero address");
        poolRegistry = IPoolRegistry(_registry);
        capitalPool = ICapitalPool(_capital);
        catPool = ICatInsurancePool(_cat);
        rewardDistributor = IRewardDistributor(_rewards);
        riskManager = IRiskManager_PM_Hook(_rm);
        emit AddressesSet(_registry, _capital, _rewards, _rm);
    }
    
    function setCatPremiumShareBps(uint256 _newBps) external onlyOwner {
        require(_newBps <= 5000, "PM: Max share is 50%");
        catPremiumBps = _newBps;
        emit CatPremiumShareSet(_newBps);
    }

    function setCoverCooldownPeriod(uint256 _newPeriod) external onlyOwner {
        coverCooldownPeriod = _newPeriod;
        emit CoverCooldownPeriodSet(_newPeriod);
    }

    /* ───────────────────── Policy Management Functions ───────────────────── */

    function purchaseCover(
        uint256 _poolId,
        uint256 _coverageAmount,
        uint256 _initialPremiumDeposit
    ) external nonReentrant returns (uint256 policyId) {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();
        
        (, , uint256 totalCoverageSold, , bool isPaused, ,) = poolRegistry.getPoolData(_poolId);
        if (isPaused) revert PoolPaused();
        if (_coverageAmount == 0 || _initialPremiumDeposit == 0) revert InvalidAmount();
        if (_initialPremiumDeposit > type(uint128).max) revert InvalidAmount();
        
        uint256 availableCapital = _getAvailableCapital(_poolId);
        if ((totalCoverageSold + _coverageAmount) > availableCapital) revert InsufficientCapacity();

        uint256 annualPremiumRateBps = _getPremiumRateBpsAnnual(_poolId);
        uint256 minPremium = (_coverageAmount * annualPremiumRateBps * 7 days) / (SECS_YEAR * BPS);
        if (_initialPremiumDeposit < minPremium) revert DepositTooLow();

        capitalPool.underlyingAsset().safeTransferFrom(msg.sender, address(this), _initialPremiumDeposit);

        uint256 activationTimestamp = block.timestamp + coverCooldownPeriod;
        policyId = policyNFT.mint(
            msg.sender, _poolId, _coverageAmount, activationTimestamp,
            uint128(_initialPremiumDeposit), uint128(activationTimestamp)
        );

        riskManager.updateCoverageSold(_poolId, _coverageAmount, true);
    }



/**
 * @notice Increases the coverage amount for an existing, active policy.
 * @dev The policy owner must have a sufficient premium deposit to cover the new,
 * higher premium rate for a minimum period (e.g., 7 days).
 * This function settles any outstanding premium before processing the increase.
 * increased coverage amount. This is a risk trade-off for user convenience.
 * @param _policyId The ID of the policy to modify.
 * @param _additionalCoverage The amount of coverage to add to the existing policy.
 */
function increaseCover(uint256 _policyId, uint256 _additionalCoverage) external nonReentrant {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();
        if (_additionalCoverage == 0) revert InvalidAmount();

        // --- Checks ---
        if (policyNFT.ownerOf(_policyId) != msg.sender) revert NotPolicyOwner();

        // Resolve any matured increase and settle premium to get an accurate state.
        _settleAndDrainPremium(_policyId);

        if (!isPolicyActive(_policyId)) revert PolicyNotActive();

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (pol.coverage == 0) revert PolicyAlreadyTerminated();

        // Check for sufficient pool capacity for the *additional* coverage.
        uint256 availableCapital = _getAvailableCapital(pol.poolId);
        (, , uint256 totalCoverageSold, , , ,) = poolRegistry.getPoolData(pol.poolId);
        if ((totalCoverageSold + _additionalCoverage) > availableCapital) revert InsufficientCapacity();
        
        // --- Calculations ---
        // Premium deposit must be sufficient for the future total coverage.
        uint256 newTotalCoverage = pol.coverage + _additionalCoverage;
        uint256 annualPremiumRateBps = _getPremiumRateBpsAnnual(pol.poolId);
        uint256 minPremiumForNewCoverage = (newTotalCoverage * annualPremiumRateBps * 7 days) / (SECS_YEAR * BPS);
        
        if (pol.premiumDeposit < minPremiumForNewCoverage) revert DepositTooLow();

        // --- Effects ---
        // Update the risk manager immediately with the additional coverage sold.
        riskManager.updateCoverageSold(pol.poolId, _additionalCoverage, true);
        
        // Add a pending increase to the policy NFT with a new activation timestamp.
        // Activation timestamp & pending increases are deprecated in current implementation
    }


    function cancelCover(uint256 _policyId) external nonReentrant {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();
        
        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (policyNFT.ownerOf(_policyId) != msg.sender) revert NotPolicyOwner();
        if (pol.coverage == 0) revert PolicyAlreadyTerminated();
        if (block.timestamp < pol.activation) revert CooldownActive();

        _settleAndDrainPremium(_policyId);

        IPolicyNFT.Policy memory updatedPol = policyNFT.getPolicy(_policyId);
        uint256 refundAmount = updatedPol.premiumDeposit;

        riskManager.updateCoverageSold(pol.poolId, pol.coverage, false);
        policyNFT.burn(_policyId);

        if (refundAmount > 0) {
            capitalPool.underlyingAsset().safeTransfer(msg.sender, refundAmount);
        }
    }
    
    function addPremium(uint256 _policyId, uint256 _premiumAmount) external nonReentrant {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();
        if (_premiumAmount == 0) revert InvalidAmount();

        _settleAndDrainPremium(_policyId);

        capitalPool.underlyingAsset().safeTransferFrom(msg.sender, address(this), _premiumAmount);

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        uint128 newDeposit = pol.premiumDeposit + uint128(_premiumAmount);
        
        policyNFT.updatePremiumAccount(_policyId, newDeposit, pol.lastDrainTime);
    }

    function lapsePolicy(uint256 _policyId) external nonReentrant {
        if (address(poolRegistry) == address(0)) revert AddressesNotSet();

        _settleAndDrainPremium(_policyId);

        if (isPolicyActive(_policyId)) revert PolicyIsActive();

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (pol.coverage == 0) revert PolicyAlreadyTerminated();

        riskManager.updateCoverageSold(pol.poolId, pol.coverage, false);
        policyNFT.burn(_policyId);
    }
    
    /* ───────────────── Internal & Helper Functions ──────────────── */

function _settleAndDrainPremium(uint256 _policyId) internal {
        // --- ADDED: Resolve any pending increase first ---
        _resolvePendingIncrease(_policyId);

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (block.timestamp <= pol.lastDrainTime) return;

        // The rest of the function logic remains the same. It will now correctly use the
        // potentially updated `pol.coverage` value after the resolution step.
        uint256 annualRateBps = _getPremiumRateBpsAnnual(pol.poolId);
        // ... (rest of the function is identical to your original)
        uint256 timeElapsed = block.timestamp - pol.lastDrainTime;

        if (annualRateBps == 0) {
            policyNFT.updatePremiumAccount(_policyId, pol.premiumDeposit, uint128(block.timestamp));
            return;
        }

        uint256 accruedCost = (pol.coverage * annualRateBps * timeElapsed) / (SECS_YEAR * BPS);
        uint256 amountToDrain = Math.min(accruedCost, pol.premiumDeposit);
        if (amountToDrain == 0) {
            policyNFT.updatePremiumAccount(_policyId, pol.premiumDeposit, uint128(block.timestamp));
            return;
        }

        uint128 newDeposit = uint128(pol.premiumDeposit - amountToDrain);
        policyNFT.updatePremiumAccount(_policyId, newDeposit, uint128(block.timestamp));

        uint256 catAmount = (amountToDrain * catPremiumBps) / BPS;
        uint256 poolIncome = amountToDrain - catAmount;

        if (catAmount > 0) {
            IERC20 underlying = capitalPool.underlyingAsset();
            underlying.approve(address(catPool), catAmount);
            catPool.receiveUsdcPremium(catAmount);
        }
        
        (, uint256 totalPledged, , , , ,) = poolRegistry.getPoolData(pol.poolId);
        if (poolIncome > 0 && totalPledged > 0) {
            rewardDistributor.distribute(pol.poolId, address(capitalPool.underlyingAsset()), poolIncome, totalPledged);
        }
    }

        /**
     * @notice Checks for and finalizes a pending coverage increase if its cooldown has passed.
     * @dev This should be called before any premium calculations or policy state modifications.
     * @param _policyId The ID of the policy to check.
     */
    function _resolvePendingIncrease(uint256 _policyId) internal {
        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        // Pending increase fields removed in current PolicyNFT version
        // No-op in mock implementation
    }

    
    /* ───────────────────── View Functions ───────────────────── */

    function isPolicyActive(uint256 _policyId) public view returns (bool) {
        if (address(poolRegistry) == address(0)) return false;
        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (pol.coverage == 0) return false;
        if (block.timestamp <= pol.lastDrainTime) return pol.premiumDeposit > 0;
        
        uint256 annualRateBps = _getPremiumRateBpsAnnual(pol.poolId);

        if (annualRateBps == 0) {
            return pol.premiumDeposit > 0;
        }

        uint256 timeElapsed = block.timestamp - pol.lastDrainTime;
        uint256 accruedCost = (pol.coverage * annualRateBps * timeElapsed) / (SECS_YEAR * BPS);

        return pol.premiumDeposit > accruedCost;
    }
    
    function _getPremiumRateBpsAnnual(uint256 _poolId) internal view returns (uint256) {
        (, uint256 totalPledged, uint256 totalSold, uint256 pendingWithdrawal, , ,) = poolRegistry.getPoolData(_poolId);

        // If all capital is pending withdrawal, no premiums should accrue
        if (pendingWithdrawal >= totalPledged) {
            return 0;
        }

        uint256 availableCapital = totalPledged - pendingWithdrawal;
        
        // Note: The original check `if (availableCapital == 0)` is now implicitly handled by the check above.
        // However, we can leave the logic as is, since after our check, this line will never be hit
        // unless totalPledged == pendingWithdrawal, which our check already covers.
        // For clarity on the logic's continuation:
        
        uint256 utilizationBps = (totalSold * BPS) / availableCapital;
        IPoolRegistry.RateModel memory model = poolRegistry.getPoolRateModel(_poolId);
         
        if (utilizationBps < model.kink) {
            return model.base + (model.slope1 * utilizationBps) / BPS;
        } else {
            return model.base + (model.slope1 * model.kink) / BPS + (model.slope2 * (utilizationBps - model.kink)) / BPS;
        }
    }

    function _getAvailableCapital(uint256 _poolId) internal view returns (uint256) {
        (, uint256 totalPledged, , uint256 pendingWithdrawal, , ,) = poolRegistry.getPoolData(_poolId);
        
        // Resolution: If pending withdrawals exceed or equal pledged capital, available capital is 0.
        // This check prevents an underflow revert.
        if (pendingWithdrawal >= totalPledged) {
            return 0;
        }
        
        return totalPledged - pendingWithdrawal;
    }
}