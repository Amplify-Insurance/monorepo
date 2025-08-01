// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

// OpenZeppelin Imports
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Interface Imports
import "../interfaces/ICapitalPool.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IRewardDistributor.sol";
import "../interfaces/IUnderwriterManager.sol";
import "../interfaces/IRiskManagerWithBackstop.sol";
import "../interfaces/ILossDistributor.sol";
import "../interfaces/IPool.sol"; 

// Minimal interface to access AaveV3Adapter-specific public variables
interface IAaveV3Adapter is IYieldAdapter {
    function aToken() external view returns (IERC20);
    function aavePool() external view returns (IPool);
}

/**
 * @title CapitalPool
 * @author Gemini
 * @notice This contract acts as the central vault for the insurance protocol.
 * @dev V4: Added call to LossDistributor on payout.
 */
contract CapitalPool is ReentrancyGuard, Ownable, ICapitalPool {
    using SafeERC20 for IERC20;

    /* ───────────────────────── Constants ───────────────────────── */
    uint256 public constant BPS = 10_000;
    uint256 private constant INITIAL_SHARES_LOCKED = 1000;
    uint256 public constant MAX_ACTIVE_ADAPTERS = 10;

    /* ───────────────────────── State Variables ───────────────────────── */
    address public riskManager;
    address public lossDistributor;
    IRewardDistributor public rewardDistributor;
    IUnderwriterManager public underwriterManager;
    uint256 public underwriterNoticePeriod = 0;

    mapping(YieldPlatform => IYieldAdapter) public baseYieldAdapters;
    address[] public activeYieldAdapterAddresses;
    mapping(address => bool) public isAdapterActive;

    mapping(address => uint256) public yieldAdapterRewardPoolId;

    struct UnderwriterAccount {
        uint256 totalDepositedAssetPrincipal;
        YieldPlatform yieldChoice;
        IYieldAdapter yieldAdapter;
        uint256 masterShares;
        uint256 totalPendingWithdrawalShares;
    }
    mapping(address => UnderwriterAccount) public underwriterAccounts;

    struct WithdrawalRequest {
        uint256 shares;
        uint256 unlockTimestamp;
    }
    mapping(address => WithdrawalRequest[]) public withdrawalRequests;

    uint256 public totalMasterSharesSystem;
    IERC20 public immutable underlyingAsset;

    mapping(address => uint256) public principalInAdapter;

    uint256 public unsettledPayouts;

    /* ───────────────────────── Modifiers & Errors ──────────────────────── */
    modifier onlyRiskManager() {
        if (msg.sender != riskManager) revert NotRiskManager(msg.sender);
        _;
    }

    modifier onlyLossDistributor() {
        if (msg.sender != lossDistributor) revert NotLossDistributor(msg.sender);
        _;
    }

    modifier onlyUnderwriterManager() {
        if (msg.sender != address(underwriterManager)) revert NotUnderwriterManager(msg.sender);
        _;
    }
    
    // Custom Errors
    error NotUnderwriterManager(address caller);
    error AdapterAssetMismatch();
    error AdapterCallFailed(address adapterAddress, string functionCalled, string reason);
    error AdapterCallReadFailed(address adapterAddress);
    error AdapterNotActive(address adapterAddress);
    error AdapterNotConfigured(uint8 platform);
    error AdapterNotFound(address adapterAddress);
    error AdapterWithdrawalFailed(address adapterAddress);
    error CannotChangeYieldPlatform();
    error CannotSetNonePlatform();
    error InconsistentState(string reason);
    error InsufficientShares(uint256 requested, uint256 available);
    error InvalidAmount(uint256 amount);
    error InvalidRequestIndex(uint256 index, uint256 length);
    error NoActiveDeposit(address user);
    error NoSharesToMint(uint256 amountDeposited);
    error NoWithdrawalRequest();
    error NotLossDistributor(address caller);
    error NotRiskManager(address caller);
    error NoticePeriodActive(uint256 unlockTimestamp, uint256 blockTimestamp);
    error PayoutExceedsPoolLPCapital(uint256 payoutAmount, uint256 availableCapital);
    error RewardPoolNotSet(address adapterAddress);
    error ZeroAddress();


    /* ───────────────────────── Events ──────────────────────────── */
    event AdapterDeactivated(address indexed adapterAddress);
    event ATokensTransferredForShortfall(address indexed claimant, uint256 valueCovered);
    event BackstopDrawn(uint256 amount);
    event AdapterInteractionSoftFailed(address indexed adapterAddress, string functionCalled, string reason);
    event BaseYieldAdapterSet(YieldPlatform indexed platform, address indexed adapterAddress);
    event Deposit(address indexed user, uint256 amount, uint256 sharesMinted, YieldPlatform yieldChoice);
    event LossDistributorSet(address indexed newLossDistributor);
    event RewardDistributorSet(address indexed newRewardDistributor);
    event RiskManagerSet(address indexed newRiskManager);
    event SharesBurntForLoss(address indexed underwriter, uint256 sharesBurnt, uint256 valueLost);
    event UnderwriterManagerSet(address indexed newUnderwriterManager);
    event UnderwriterNoticePeriodSet(uint256 newPeriod);
    event WithdrawalExecuted(address indexed user, uint256 assetsReceived, uint256 sharesBurned, uint256 requestIndex);
    event WithdrawalRequestCancelled(address indexed user, uint256 sharesCancelled, uint256 requestIndex);
    event WithdrawalRequested(address indexed user, uint256 sharesToBurn, uint256 timestamp, uint256 requestIndex);
    event YieldAdapterRewardPoolSet(address indexed adapter, uint256 indexed rewardPoolId);
    event YieldHarvested(address indexed adapter, uint256 yieldAmount, uint256 rewardPoolId);


    /* ───────────────────── Constructor ─────────────────────────── */
    constructor(address _initialOwner, address _underlyingAsset) Ownable(_initialOwner) {
        if (_underlyingAsset == address(0)) revert ZeroAddress();
        underlyingAsset = IERC20(_underlyingAsset);
        totalMasterSharesSystem = INITIAL_SHARES_LOCKED;
        underwriterAccounts[address(0)].masterShares = INITIAL_SHARES_LOCKED;
    }

    /* ───────────────────── Admin Functions ────────────────── */
    function setRiskManager(address _riskManager) external onlyOwner {
        if (_riskManager == address(0)) revert ZeroAddress();
        riskManager = _riskManager;
        emit RiskManagerSet(_riskManager);
    }
    
    function setLossDistributor(address _lossDistributor) external onlyOwner {
        if (_lossDistributor == address(0)) revert ZeroAddress();
        lossDistributor = _lossDistributor;
        emit LossDistributorSet(_lossDistributor);
    }

    function setUnderwriterManager(address _underwriterManager) external onlyOwner {
        if (_underwriterManager == address(0)) revert ZeroAddress();
        underwriterManager = IUnderwriterManager(_underwriterManager);
        emit UnderwriterManagerSet(_underwriterManager);
    }

    function setRewardDistributor(address _rewardDistributor) external onlyOwner {
        if (_rewardDistributor == address(0)) revert ZeroAddress();
        rewardDistributor = IRewardDistributor(_rewardDistributor);
        emit RewardDistributorSet(_rewardDistributor);
    }

    function setUnderwriterNoticePeriod(uint256 _newPeriod) external onlyOwner {
        underwriterNoticePeriod = _newPeriod;
        emit UnderwriterNoticePeriodSet(_newPeriod);
    }

    function setBaseYieldAdapter(YieldPlatform _platform, address _adapterAddress) external onlyOwner {
        if (_platform == YieldPlatform.NONE) revert CannotSetNonePlatform();
        if (_adapterAddress == address(0)) revert ZeroAddress();
        if (_adapterAddress.code.length == 0) revert AdapterNotConfigured(uint8(_platform));
        if (address(IYieldAdapter(_adapterAddress).asset()) != address(underlyingAsset)) revert AdapterAssetMismatch();
        
        baseYieldAdapters[_platform] = IYieldAdapter(_adapterAddress);
        if (!isAdapterActive[_adapterAddress]) {
            require(activeYieldAdapterAddresses.length < MAX_ACTIVE_ADAPTERS, "Max adapters reached");
            isAdapterActive[_adapterAddress] = true;
            activeYieldAdapterAddresses.push(_adapterAddress);
        }
        emit BaseYieldAdapterSet(_platform, _adapterAddress);
    }

    function deactivateBaseYieldAdapter(address _adapterAddress) external onlyOwner {
        if (!isAdapterActive[_adapterAddress]) revert AdapterNotActive(_adapterAddress);

        uint256 adapterCount = activeYieldAdapterAddresses.length;
        uint256 indexToRemove = adapterCount;

        for (uint256 i = 0; i < adapterCount; i++) {
            if (activeYieldAdapterAddresses[i] == _adapterAddress) {
                indexToRemove = i;
                break;
            }
        }

        if (indexToRemove == adapterCount) revert AdapterNotFound(_adapterAddress);

        activeYieldAdapterAddresses[indexToRemove] = activeYieldAdapterAddresses[adapterCount - 1];
        activeYieldAdapterAddresses.pop();

        isAdapterActive[_adapterAddress] = false;
        emit AdapterDeactivated(_adapterAddress);
    }
    
    function setYieldAdapterRewardPool(address adapterAddress, uint256 rewardPoolId) external onlyOwner {
        if (!isAdapterActive[adapterAddress]) revert AdapterNotActive(adapterAddress);
        yieldAdapterRewardPoolId[adapterAddress] = rewardPoolId;
        emit YieldAdapterRewardPoolSet(adapterAddress, rewardPoolId);
    }

    /* ───────────────── Underwriter Deposit & Withdrawal ────────────────── */
    function deposit(uint256 _amount, YieldPlatform _yieldChoice) external override nonReentrant {
        IYieldAdapter chosenAdapter = _validateDeposit(_amount, _yieldChoice);
        uint256 sharesToMint = _calculateSharesToMint(_amount);
        if (sharesToMint == 0) revert NoSharesToMint(_amount);
        _performDepositInteraction(chosenAdapter, _amount);
        
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        _updateStateOnDeposit(account, _amount, sharesToMint, _yieldChoice, chosenAdapter);
        
        if (address(underwriterManager) != address(0)) {
            underwriterManager.onCapitalDeposited(msg.sender, _amount);
        }
        emit Deposit(msg.sender, _amount, sharesToMint, _yieldChoice);
    }

    function _validateDeposit(
        uint256 _amount,
        YieldPlatform _yieldChoice
    ) internal view returns (IYieldAdapter) {
        if (_amount == 0) revert InvalidAmount(_amount);
        if (_yieldChoice == YieldPlatform.NONE) revert AdapterNotConfigured(uint8(_yieldChoice));
        
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        IYieldAdapter chosenAdapter = baseYieldAdapters[_yieldChoice];
        
        if (address(chosenAdapter) == address(0)) revert AdapterNotConfigured(uint8(_yieldChoice));
        if (account.masterShares > 0 && account.yieldChoice != _yieldChoice) {
            revert CannotChangeYieldPlatform();
        }
        return chosenAdapter;
    }

    function _calculateSharesToMint(uint256 _amount) internal view returns (uint256) {
        uint256 currentNAV = _getAccountingNAV();
        uint256 effectiveShares = totalMasterSharesSystem - INITIAL_SHARES_LOCKED;
        
        if (currentNAV == 0 || effectiveShares == 0) {
            return _amount;
        } else {
            return Math.mulDiv(_amount, effectiveShares, currentNAV);
        }
    }

    function _performDepositInteraction(IYieldAdapter _adapter, uint256 _amount) internal {
        underlyingAsset.safeTransferFrom(msg.sender, address(this), _amount);
        underlyingAsset.forceApprove(address(_adapter), _amount);
        _adapter.deposit(_amount);
    }

    function _updateStateOnDeposit(
        UnderwriterAccount storage account,
        uint256 _amount,
        uint256 _sharesToMint,
        YieldPlatform _yieldChoice,
        IYieldAdapter _adapter
    ) internal {
        if (account.masterShares == 0) {
            account.yieldChoice = _yieldChoice;
            account.yieldAdapter = _adapter;
        }
        account.totalDepositedAssetPrincipal += _amount;
        account.masterShares += _sharesToMint;
        totalMasterSharesSystem += _sharesToMint;
        principalInAdapter[address(_adapter)] += _amount;
    }

    function requestWithdrawal(address user, uint256 sharesToBurn) external onlyUnderwriterManager {
        if (sharesToBurn == 0) revert InvalidAmount(sharesToBurn);
        UnderwriterAccount storage account = underwriterAccounts[user];
        uint256 newTotalPending = account.totalPendingWithdrawalShares + sharesToBurn;
        
        if (newTotalPending > account.masterShares) revert InsufficientShares(sharesToBurn, account.masterShares - account.totalPendingWithdrawalShares);
        
        account.totalPendingWithdrawalShares = newTotalPending;
        
        uint256 unlockTime = block.timestamp + underwriterNoticePeriod;
        withdrawalRequests[user].push(WithdrawalRequest({
            shares: sharesToBurn,
            unlockTimestamp: unlockTime
        }));
        uint256 requestIndex = withdrawalRequests[user].length - 1;
        emit WithdrawalRequested(user, sharesToBurn, unlockTime, requestIndex);
    }

    function cancelWithdrawalRequest(address user, uint256 requestIndex) external onlyUnderwriterManager {
        WithdrawalRequest[] storage requests = withdrawalRequests[user];
        if (requestIndex >= requests.length) revert InvalidRequestIndex(requestIndex, requests.length);
        
        uint256 sharesToCancel = requests[requestIndex].shares;
        
        underwriterAccounts[user].totalPendingWithdrawalShares -= sharesToCancel;
        requests[requestIndex] = requests[requests.length - 1];
        requests.pop();
        emit WithdrawalRequestCancelled(user, sharesToCancel, requestIndex);
    }

    function executeWithdrawal(address user, uint256 requestIndex) external onlyUnderwriterManager {
        uint256 requestedSharesToBurn = _validateWithdrawalRequestAndGetShares(user, requestIndex);
        
        UnderwriterAccount storage account = underwriterAccounts[user];
        uint256 sharesAvailableAfterLosses = account.masterShares;
        uint256 finalSharesToBurn = Math.min(requestedSharesToBurn, sharesAvailableAfterLosses);

        if (finalSharesToBurn == 0) {
            _removeRequest(user, requestIndex);
            emit WithdrawalExecuted(user, 0, 0, requestIndex);
            return;
        }

        uint256 amountToReceive = sharesToValue(finalSharesToBurn);
        _burnShares(user, finalSharesToBurn);
        
        uint256 assetsActuallyWithdrawn = _performAdapterWithdrawal(account, amountToReceive);
        _updateStateAfterWithdrawal(user, account, assetsActuallyWithdrawn);

        _removeRequest(user, requestIndex);

        if (assetsActuallyWithdrawn > 0) {
            underlyingAsset.safeTransfer(user, assetsActuallyWithdrawn);
        }
        emit WithdrawalExecuted(user, assetsActuallyWithdrawn, finalSharesToBurn, requestIndex);
    }

    function _validateWithdrawalRequestAndGetShares(address user, uint256 requestIndex) internal view returns (uint256) {
        WithdrawalRequest[] storage requests = withdrawalRequests[user];
        if (requestIndex >= requests.length) revert InvalidRequestIndex(requestIndex, requests.length);
        
        WithdrawalRequest memory requestToExecute = requests[requestIndex];
        if (block.timestamp < requestToExecute.unlockTimestamp) revert NoticePeriodActive(requestToExecute.unlockTimestamp, block.timestamp);
        
        UnderwriterAccount storage account = underwriterAccounts[user];
        if (requestToExecute.shares > account.masterShares) revert InconsistentState("Pending withdrawal shares exceed total shares.");
        
        return requestToExecute.shares;
    }

    function _performAdapterWithdrawal(
        UnderwriterAccount storage account,
        uint256 amountToReceive
    ) internal returns (uint256 assetsWithdrawn) {
        if (amountToReceive > 0) {
            assetsWithdrawn = account.yieldAdapter.withdraw(amountToReceive, address(this));
        }
    }

    function _updateStateAfterWithdrawal(
        address user,
        UnderwriterAccount storage account,
        uint256 assetsActuallyWithdrawn
    ) internal {
        uint256 currentPrincipal = principalInAdapter[address(account.yieldAdapter)];
        principalInAdapter[address(account.yieldAdapter)] = (currentPrincipal >= assetsActuallyWithdrawn) ? currentPrincipal - assetsActuallyWithdrawn : 0;
        
        uint256 principalComponentRemoved = assetsActuallyWithdrawn;
        if (account.totalDepositedAssetPrincipal >= principalComponentRemoved) {
            account.totalDepositedAssetPrincipal -= principalComponentRemoved;
        } else {
            account.totalDepositedAssetPrincipal = 0;
        }

        bool isFullWithdrawal = (account.masterShares == 0);
        if (address(underwriterManager) != address(0)) {
            underwriterManager.onCapitalWithdrawn(user, principalComponentRemoved, isFullWithdrawal);
        }
        if (isFullWithdrawal) {
            delete underwriterAccounts[user];
        }
    }

    function _burnShares(address underwriter, uint256 sharesToBurn) internal {
        UnderwriterAccount storage account = underwriterAccounts[underwriter];
        account.masterShares -= sharesToBurn;
        account.totalPendingWithdrawalShares -= sharesToBurn;
        totalMasterSharesSystem -= sharesToBurn;
    }

    function _removeRequest(address user, uint256 requestIndex) internal {
        WithdrawalRequest[] storage requests = withdrawalRequests[user];
        requests[requestIndex] = requests[requests.length - 1];
        requests.pop();
    }

    /* ───────────────────── Yield & Reward Functions ─────────────────── */
    function harvestAndDistributeYield(address adapterAddress) external nonReentrant {
        if (!isAdapterActive[adapterAddress]) revert AdapterNotActive(adapterAddress);
        IYieldAdapter adapter = IYieldAdapter(adapterAddress);
        uint256 currentValue;
        try adapter.getCurrentValueHeld() returns (uint256 valueInAdapter) {
            currentValue = valueInAdapter;
        } catch { 
            revert AdapterCallReadFailed(adapterAddress);
        }

        uint256 principal = principalInAdapter[adapterAddress];
        if (currentValue > principal) {
            uint256 yieldAmount = currentValue - principal;
            uint256 withdrawnYield = adapter.withdraw(yieldAmount, address(this));
            if (withdrawnYield > 0 && address(rewardDistributor) != address(0)) {
                uint256 rewardPoolId = yieldAdapterRewardPoolId[adapterAddress];
                if(rewardPoolId == 0) revert RewardPoolNotSet(adapterAddress);

                underlyingAsset.safeTransfer(address(rewardDistributor), withdrawnYield);
                rewardDistributor.distribute(rewardPoolId, address(underlyingAsset), withdrawnYield, principal);
                emit YieldHarvested(adapterAddress, withdrawnYield, rewardPoolId);
            }
        }
    }

    /* ───────────────────── Trusted Functions ─────────────────── */
    function executePayout(PayoutData calldata _payoutData) external override onlyRiskManager {
        uint256 claimantAmount = _payoutData.claimantAmount;
        uint256 feeAmount = _payoutData.feeAmount;
        uint256 totalPayoutAmount = claimantAmount + feeAmount;

        if (totalPayoutAmount == 0) return;
        if (totalPayoutAmount > _payoutData.totalCapitalFromPoolLPs) {
            revert PayoutExceedsPoolLPCapital(totalPayoutAmount, _payoutData.totalCapitalFromPoolLPs);
        }
        
        // <<< FIX START: Notify the LossDistributor about the payout to register the loss.
        if (address(lossDistributor) != address(0)) {
            ILossDistributor(lossDistributor).distributeLoss(_payoutData.poolId, totalPayoutAmount);
        }
        // <<< FIX END
        
        unsettledPayouts += totalPayoutAmount;
        
        uint256 underlyingFromUnderwriters = _gatherUnderlyingFromAdapters(_payoutData, totalPayoutAmount);
        
        uint256 claimantDeficit = _payFromUnderlying(
            _payoutData.claimant,
            _payoutData.feeRecipient,
            claimantAmount,
            feeAmount,
            underlyingFromUnderwriters
        );

        if (claimantDeficit > 0) {
            claimantDeficit = _coverDeficitWithATokens(_payoutData, claimantDeficit);
        }
        
        if (claimantDeficit > 0) {
            _coverDeficitFromBackstop(_payoutData.claimant, claimantDeficit);
        }
    }

    function _gatherUnderlyingFromAdapters(PayoutData calldata _payoutData, uint256 _totalPayoutAmount) internal returns (uint256) {
        uint256 underlyingGathered = 0;
        for (uint i = 0; i < _payoutData.adapters.length; i++) {
            address adapterAddress = _payoutData.adapters[i];
            uint256 amountNeeded = Math.mulDiv(_totalPayoutAmount, _payoutData.capitalPerAdapter[i], _payoutData.totalCapitalFromPoolLPs);
            if (amountNeeded == 0) continue;

            try IYieldAdapter(adapterAddress).withdraw(amountNeeded, address(this)) returns (uint256 withdrawn) {
                if (withdrawn > 0) {
                    underlyingGathered += withdrawn;
                    uint256 currentPrincipal = principalInAdapter[adapterAddress];
                    principalInAdapter[adapterAddress] = (currentPrincipal > withdrawn) ? currentPrincipal - withdrawn : 0;
                }
            } catch {
                revert AdapterWithdrawalFailed(adapterAddress);
            }
        }
        return underlyingGathered;
    }

    function _payFromUnderlying(address _claimant, address _feeRecipient, uint256 _claimantAmount, uint256 _feeAmount, uint256 _underlyingAvailable) internal returns (uint256 claimantDeficit) {
        uint256 paidToFee = 0;
        if (_feeAmount > 0 && _feeRecipient != address(0)) {
            paidToFee = Math.min(_underlyingAvailable, _feeAmount);
            underlyingAsset.safeTransfer(_feeRecipient, paidToFee);
        }

        uint256 remainingUnderlying = _underlyingAvailable - paidToFee;
        uint256 paidToClaimantUnderlying = 0;
        if (_claimantAmount > 0) {
            paidToClaimantUnderlying = Math.min(remainingUnderlying, _claimantAmount);
            underlyingAsset.safeTransfer(_claimant, paidToClaimantUnderlying);
        }

        return _claimantAmount - paidToClaimantUnderlying;
    }

    function _coverDeficitWithATokens(PayoutData calldata _payoutData, uint256 _claimantDeficit) internal returns (uint256) {
        uint256 deficit = _claimantDeficit;
        uint256 valueCoveredByATokens = 0;

        for (uint i = 0; i < _payoutData.adapters.length; i++) {
            if (deficit == 0) break;

            address adapterAddress = _payoutData.adapters[i];
            uint256 valueToPullAsATokens = Math.mulDiv(deficit, _payoutData.capitalPerAdapter[i], _payoutData.totalCapitalFromPoolLPs);
            if (valueToPullAsATokens == 0) continue;

            try IYieldAdapter(adapterAddress).emergencyTransfer(_payoutData.claimant, valueToPullAsATokens) returns (uint256 aTokensTransferred) {
                if (aTokensTransferred > 0) {
                    uint256 valueCovered = Math.min(deficit, aTokensTransferred);
                    valueCoveredByATokens += valueCovered;
                    deficit -= valueCovered;

                    uint256 currentPrincipal = principalInAdapter[adapterAddress];
                    principalInAdapter[adapterAddress] = (currentPrincipal > valueCovered) ? currentPrincipal - valueCovered : 0;
                }
            } catch (bytes memory reason) {
                emit AdapterInteractionSoftFailed(adapterAddress, "emergencyTransfer", string(reason));
            }
        }
        if (valueCoveredByATokens > 0) {
            emit ATokensTransferredForShortfall(_payoutData.claimant, valueCoveredByATokens);
        }
        return deficit;
    }

    function _coverDeficitFromBackstop(address _claimant, uint256 _finalDeficit) internal {
        IBackstopPool catPool = IRiskManagerWithBackstop(riskManager).catPool();
        uint256 balanceBefore = underlyingAsset.balanceOf(address(this));
        catPool.drawFund(_finalDeficit);
        uint256 balanceAfter = underlyingAsset.balanceOf(address(this));
        uint256 drawnFromBackstop = balanceAfter - balanceBefore;
        if (drawnFromBackstop > 0) {
            underlyingAsset.safeTransfer(_claimant, drawnFromBackstop);
            emit BackstopDrawn(drawnFromBackstop);
        }
    }

    function burnSharesForLoss(address underwriter, uint256 burnAmount) external onlyLossDistributor  {
        if (burnAmount == 0) return;

        UnderwriterAccount storage account = underwriterAccounts[underwriter];
        if (account.masterShares < burnAmount) {
            revert InsufficientShares(burnAmount, account.masterShares);
        }
        
        uint256 valueLost = sharesToValue(burnAmount);
        if (unsettledPayouts >= valueLost) {
            unsettledPayouts -= valueLost;
        } else {
            unsettledPayouts = 0;
        }

        uint256 principalBefore = account.totalDepositedAssetPrincipal;
        uint256 sharesBefore = account.masterShares;
        uint256 principalToReduce = Math.mulDiv(principalBefore, burnAmount, sharesBefore);

        account.masterShares -= burnAmount;
        totalMasterSharesSystem -= burnAmount;

        account.totalDepositedAssetPrincipal = (principalBefore > principalToReduce) ? principalBefore - principalToReduce : 0;

        bool wipedOut = (account.masterShares == 0);
        if (wipedOut) {
            account.totalDepositedAssetPrincipal = 0;
            delete underwriterAccounts[underwriter];
        }

        if (address(underwriterManager) != address(0)) {
            underwriterManager.onLossRealized(underwriter, valueLost);
        }

        emit SharesBurntForLoss(underwriter, burnAmount, valueLost);
    }

    /* ───────────────────────── View Functions ──────────────────────── */
    function _getAccountingNAV() internal view returns (uint256) {
        return _getTotalNAV() + unsettledPayouts;
    }

    function getTotalNAV() external view returns (uint256) {
        return _getTotalNAV();
    }

    function _getTotalNAV() internal view returns (uint256) {
        uint256 totalValue;
        for (uint256 i = 0; i < activeYieldAdapterAddresses.length; i++) {
            address adapterAddress = activeYieldAdapterAddresses[i];
            IYieldAdapter adapter = IYieldAdapter(adapterAddress);
            try adapter.getCurrentValueHeld() returns (uint256 valueInAdapter) {
                totalValue += valueInAdapter;
            } catch {
                revert AdapterCallReadFailed(adapterAddress);
            }
        }
        // totalValue += underlyingAsset.balanceOf(address(this));
        return totalValue;
    }

    function getUnderwriterAdapterAddress(address _underwriter) external view override returns(address) {
        return address(underwriterAccounts[_underwriter].yieldAdapter);
    }
    
    function getUnderwriterAccount(address _underwriter)
        external view override
        returns (uint256, YieldPlatform, uint256, uint256) {
        UnderwriterAccount storage account = underwriterAccounts[_underwriter];
        return (
            account.totalDepositedAssetPrincipal,
            account.yieldChoice,
            account.masterShares,
            account.totalPendingWithdrawalShares
        );
    }

    function getWithdrawalRequestCount(address _underwriter) external view returns (uint256) {
        return withdrawalRequests[_underwriter].length;
    }

    function sharesToValue(uint256 _shares) public view override returns (uint256) {
        if (totalMasterSharesSystem <= INITIAL_SHARES_LOCKED) return 0;
        uint256 effectiveShares = totalMasterSharesSystem - INITIAL_SHARES_LOCKED;
        if (effectiveShares == 0) return 0;
        return Math.mulDiv(_shares, _getAccountingNAV(), effectiveShares);
    }

    function valueToShares(uint256 _value) public view override returns (uint256) {
        uint256 currentNAV = _getAccountingNAV();
        if (currentNAV == 0) return _value;
        uint256 effectiveShares = totalMasterSharesSystem - INITIAL_SHARES_LOCKED;
        return Math.mulDiv(_value, effectiveShares, currentNAV);
    }
}