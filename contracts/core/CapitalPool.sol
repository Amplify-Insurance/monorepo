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
import "../interfaces/IYieldAdapterEmergency.sol";
import "../interfaces/IRewardDistributor.sol";
import "../interfaces/IUnderwriterManager.sol";
import "../interfaces/IRiskManagerWithBackstop.sol";

/**
 * @title CapitalPool
 * @author Gemini
 * @notice This contract acts as the central vault for the insurance protocol.
 * @dev Implements isolated loss and isolated yield models.
 */
contract CapitalPool is ReentrancyGuard, Ownable, ICapitalPool {
    using SafeERC20 for IERC20;

    /* ───────────────────────── Constants ───────────────────────── */
    uint256 public constant BPS = 10_000;
    uint256 private constant INITIAL_SHARES_LOCKED = 1000;

    /* ───────────────────────── State Variables ───────────────────────── */
    address public riskManager;
    address public lossDistributor;
    IRewardDistributor public rewardDistributor;
    IUnderwriterManager public underwriterManager;
    uint256 public underwriterNoticePeriod = 0;

    mapping(YieldPlatform => IYieldAdapter) public baseYieldAdapters;
    address[] public activeYieldAdapterAddresses;
    mapping(address => bool) public isAdapterActive;

    // NEW: Links a yield adapter to a specific reward pool ID in the RewardDistributor
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
    uint256 public totalSystemValue; // Represents total principal, not NAV
    IERC20 public immutable underlyingAsset;

    mapping(address => uint256) public principalInAdapter;

    /* ───────────────────────── Modifiers & Errors ──────────────────────── */
    modifier onlyRiskManager() {
        require(msg.sender == riskManager, "CP: Caller is not the RiskManager");
        _;
    }

    modifier onlyLossDistributor() {
        require(msg.sender == lossDistributor, "CP: Caller is not the LossDistributor");
        _;
    }
    
    error ZeroAddress();
    error InvalidAmount();
    error NoSharesToMint();
    error NotRiskManager();
    error InconsistentState();
    error NoWithdrawalRequest();
    error NoticePeriodActive();
    error InsufficientShares();
    error AdapterNotConfigured();
    error NoActiveDeposit();
    error PayoutExceedsPoolLPCapital();
    error InvalidRequestIndex();
    error NotLossDistributor();
    error MismatchedArrayLengths();

    /* ───────────────────────── Events ──────────────────────────── */
    event RiskManagerSet(address indexed newRiskManager);
    event LossDistributorSet(address indexed newLossDistributor);
    event RewardDistributorSet(address indexed newRewardDistributor);
    event UnderwriterManagerSet(address indexed newUnderwriterManager);
    event BaseYieldAdapterSet(YieldPlatform indexed platform, address indexed adapterAddress);
    event YieldAdapterRewardPoolSet(address indexed adapter, uint256 indexed rewardPoolId); // NEW
    event Deposit(address indexed user, uint256 amount, uint256 sharesMinted, YieldPlatform yieldChoice);
    event WithdrawalRequested(address indexed user, uint256 sharesToBurn, uint256 timestamp, uint256 requestIndex);
    event WithdrawalExecuted(address indexed user, uint256 assetsReceived, uint256 sharesBurned, uint256 requestIndex);
    event WithdrawalRequestCancelled(address indexed user, uint256 sharesCancelled, uint256 requestIndex);
    event SharesBurntForLoss(address indexed underwriter, uint256 sharesBurnt);
    event YieldHarvested(address indexed adapter, uint256 yieldAmount, uint256 rewardPoolId);
    event UnderwriterNoticePeriodSet(uint256 newPeriod);
    event AdapterCallFailed(address indexed adapterAddress, string functionCalled, string reason);


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
        if (_platform == YieldPlatform.NONE) revert("CP: Cannot set for NONE platform");
        if (_adapterAddress == address(0)) revert ZeroAddress();
        uint256 codeSize;
        assembly { codeSize := extcodesize(_adapterAddress) }
        require(codeSize > 0, "CP: Adapter address is not a contract");
        require(address(IYieldAdapter(_adapterAddress).asset()) == address(underlyingAsset), "CP: Adapter asset mismatch");
        baseYieldAdapters[_platform] = IYieldAdapter(_adapterAddress);
        if (!isAdapterActive[_adapterAddress]) {
            isAdapterActive[_adapterAddress] = true;
            activeYieldAdapterAddresses.push(_adapterAddress);
        }
        emit BaseYieldAdapterSet(_platform, _adapterAddress);
    }
    
    // NEW: Admin function to link an adapter to its reward pool
    function setYieldAdapterRewardPool(address adapterAddress, uint256 rewardPoolId) external onlyOwner {
        require(isAdapterActive[adapterAddress], "CP: Adapter must be active");
        yieldAdapterRewardPoolId[adapterAddress] = rewardPoolId;
        emit YieldAdapterRewardPoolSet(adapterAddress, rewardPoolId);
    }

    /* ───────────────── Underwriter Deposit & Withdrawal ────────────────── */
function deposit(uint256 _amount, YieldPlatform _yieldChoice) external override nonReentrant {
    // 1. Validate the deposit and get the chosen adapter
    IYieldAdapter chosenAdapter = _validateDeposit(_amount, _yieldChoice);

    // 2. Calculate how many shares to mint for the deposit
    uint256 sharesToMint = _calculateSharesToMint(_amount);
    if (sharesToMint == 0) revert NoSharesToMint();

    // 3. Perform the token transfer and deposit into the yield adapter
    _performDepositInteraction(chosenAdapter, _amount);

    // 4. Update all internal state variables
    UnderwriterAccount storage account = underwriterAccounts[msg.sender];
    _updateStateOnDeposit(account, _amount, sharesToMint, _yieldChoice, chosenAdapter);
    
    // 5. Call hooks for other protocol contracts
    if (address(underwriterManager) != address(0)) {
        underwriterManager.onCapitalDeposited(msg.sender, _amount);
    }
    
    emit Deposit(msg.sender, _amount, sharesToMint, _yieldChoice);
}

/**
 * @dev Validates the deposit parameters and returns the chosen yield adapter.
 */
function _validateDeposit(
    uint256 _amount,
    YieldPlatform _yieldChoice
) internal view returns (IYieldAdapter) {
    if (_amount == 0) revert InvalidAmount();
    if (_yieldChoice == YieldPlatform.NONE) revert AdapterNotConfigured();

    UnderwriterAccount storage account = underwriterAccounts[msg.sender];
    IYieldAdapter chosenAdapter = baseYieldAdapters[_yieldChoice];
    if (address(chosenAdapter) == address(0)) revert AdapterNotConfigured();

    // Prevent users from changing their chosen yield strategy without first withdrawing.
    if (account.masterShares > 0 && account.yieldChoice != _yieldChoice) {
        revert("CP: Cannot change yield platform; withdraw first.");
    }
    return chosenAdapter;
}

/**
 * @dev Calculates the number of shares to mint based on the current share price.
 */
function _calculateSharesToMint(uint256 _amount) internal view returns (uint256) {
    uint256 effectiveShares = totalMasterSharesSystem - INITIAL_SHARES_LOCKED;
    if (totalSystemValue == 0 || effectiveShares == 0) {
        return _amount; // Initial deposit sets the price at 1:1
    } else {
        return Math.mulDiv(_amount, effectiveShares, totalSystemValue);
    }
}

/**
 * @dev Handles the external calls for transferring tokens and depositing to the adapter.
 */
function _performDepositInteraction(IYieldAdapter _adapter, uint256 _amount) internal {
    underlyingAsset.safeTransferFrom(msg.sender, address(this), _amount);
    underlyingAsset.forceApprove(address(_adapter), _amount);
    _adapter.deposit(_amount);
}

/**
 * @dev Updates all necessary state variables after a successful deposit.
 */
function _updateStateOnDeposit(
    UnderwriterAccount storage account,
    uint256 _amount,
    uint256 _sharesToMint,
    YieldPlatform _yieldChoice,
    IYieldAdapter _adapter
) internal {
    // If this is the user's first deposit, set their yield choice.
    if (account.masterShares == 0) {
        account.yieldChoice = _yieldChoice;
        account.yieldAdapter = _adapter;
    }
    
    account.totalDepositedAssetPrincipal += _amount;
    account.masterShares += _sharesToMint;
    totalMasterSharesSystem += _sharesToMint;
    totalSystemValue += _amount;
    principalInAdapter[address(_adapter)] += _amount;
}

    function requestWithdrawal(uint256 _sharesToBurn) external nonReentrant {
        if (_sharesToBurn == 0) revert InvalidAmount();
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        uint256 newTotalPending = account.totalPendingWithdrawalShares + _sharesToBurn;
        if (newTotalPending > account.masterShares) revert InsufficientShares();
        account.totalPendingWithdrawalShares = newTotalPending;
        uint256 valueToWithdraw = sharesToValue(_sharesToBurn);
        if (address(underwriterManager) != address(0)) {
            underwriterManager.onWithdrawalRequested(msg.sender, valueToWithdraw);
        }
        uint256 unlockTime = block.timestamp + underwriterNoticePeriod;
        withdrawalRequests[msg.sender].push(WithdrawalRequest({
            shares: _sharesToBurn,
            unlockTimestamp: unlockTime
        }));
        uint256 requestIndex = withdrawalRequests[msg.sender].length - 1;
        emit WithdrawalRequested(msg.sender, _sharesToBurn, unlockTime, requestIndex);
    }

    function cancelWithdrawalRequest(uint256 _requestIndex) external nonReentrant {
        WithdrawalRequest[] storage requests = withdrawalRequests[msg.sender];
        if (_requestIndex >= requests.length) revert InvalidRequestIndex();
        uint256 sharesToCancel = requests[_requestIndex].shares;
        uint256 valueCancelled = sharesToValue(sharesToCancel);
        if (address(underwriterManager) != address(0)) {
            underwriterManager.onWithdrawalCancelled(msg.sender, valueCancelled);
        }
        underwriterAccounts[msg.sender].totalPendingWithdrawalShares -= sharesToCancel;
        requests[_requestIndex] = requests[requests.length - 1];
        requests.pop();
        emit WithdrawalRequestCancelled(msg.sender, sharesToCancel, _requestIndex);
    }


    function executeWithdrawal(uint256 _requestIndex) external nonReentrant {
        // 1. Validate the withdrawal request and get the necessary data
        (
            UnderwriterAccount storage account,
            uint256 sharesToBurn
        ) = _validateWithdrawalRequest(msg.sender, _requestIndex);

        // 2. Calculate values and burn shares before any external calls
        uint256 amountToReceive = sharesToValue(sharesToBurn);
        uint256 principalComponentRemoved = _burnSharesAndRemoveRequest(msg.sender, _requestIndex, sharesToBurn);

        // 3. Perform the external call to the yield adapter
        uint256 assetsActuallyWithdrawn = _performAdapterWithdrawal(account, amountToReceive);

        // 4. Update all internal state and notify other contracts
        _updateStateAfterWithdrawal(msg.sender, account, principalComponentRemoved, assetsActuallyWithdrawn);

        // 5. Transfer the final assets to the user
        if (assetsActuallyWithdrawn > 0) {
            underlyingAsset.safeTransfer(msg.sender, assetsActuallyWithdrawn);
        }
        
        emit WithdrawalExecuted(msg.sender, assetsActuallyWithdrawn, sharesToBurn, _requestIndex);
    }

function _validateWithdrawalRequest(
    address user,
    uint256 requestIndex
) internal view returns (UnderwriterAccount storage, uint256) {
    WithdrawalRequest[] storage requests = withdrawalRequests[user];
    if (requestIndex >= requests.length) revert InvalidRequestIndex();

    WithdrawalRequest memory requestToExecute = requests[requestIndex];
    if (block.timestamp < requestToExecute.unlockTimestamp) revert NoticePeriodActive();
    
    UnderwriterAccount storage account = underwriterAccounts[user];
    if (requestToExecute.shares > account.masterShares) revert InconsistentState();

    return (account, requestToExecute.shares);
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
    uint256 principalComponentRemoved,
    uint256 assetsActuallyWithdrawn
) internal {
    if (totalSystemValue >= principalComponentRemoved) {
        totalSystemValue -= principalComponentRemoved;
    } else {
        totalSystemValue = 0;
    }

    principalInAdapter[address(account.yieldAdapter)] -= assetsActuallyWithdrawn;
    
    bool isFullWithdrawal = (account.masterShares == 0);
    
    if (address(underwriterManager) != address(0)) {
        underwriterManager.onCapitalWithdrawn(user, principalComponentRemoved, isFullWithdrawal);
    }

    if (isFullWithdrawal) {
        delete underwriterAccounts[user];
    }
}

    function _burnSharesAndRemoveRequest(
        address _underwriter,
        uint256 _requestIndex,
        uint256 _sharesToBurn
    ) internal returns (uint256) {
        UnderwriterAccount storage account = underwriterAccounts[_underwriter];
        uint256 oldMasterShares = account.masterShares;
        uint256 principalComponentRemoved = 0;
        if (oldMasterShares > 0) {
             principalComponentRemoved = (account.totalDepositedAssetPrincipal * _sharesToBurn) / oldMasterShares;
        }
        account.totalDepositedAssetPrincipal -= principalComponentRemoved;
        account.masterShares -= _sharesToBurn;
        account.totalPendingWithdrawalShares -= _sharesToBurn;
        totalMasterSharesSystem -= _sharesToBurn;
        WithdrawalRequest[] storage requests = withdrawalRequests[_underwriter];
        requests[_requestIndex] = requests[requests.length - 1];
        requests.pop();
        return principalComponentRemoved;
    }

    /* ───────────────────── Yield & Reward Functions ─────────────────── */

    function harvestAndDistributeYield(address adapterAddress) external nonReentrant {
        require(isAdapterActive[adapterAddress], "CP: Adapter not active");
        IYieldAdapter adapter = IYieldAdapter(adapterAddress);
        uint256 currentValue;
        try adapter.getCurrentValueHeld() returns (uint256 valueInAdapter) {
            currentValue = valueInAdapter;
        } catch { return; }

        uint256 principal = principalInAdapter[adapterAddress];
        if (currentValue > principal) {
            uint256 yieldAmount = currentValue - principal;
            uint256 withdrawnYield = adapter.withdraw(yieldAmount, address(this));
            
            if (withdrawnYield > 0 && address(rewardDistributor) != address(0)) {
                // --- FIX: ISOLATED YIELD LOGIC ---
                // 1. Look up the specific reward pool ID for this adapter.
                uint256 rewardPoolId = yieldAdapterRewardPoolId[adapterAddress];
                require(rewardPoolId != 0, "CP: Reward pool for adapter not set");

                // 2. Distribute yield based on the capital in THIS adapter, not the whole system.
                uint256 principalInThisAdapter = principalInAdapter[adapterAddress];
                
                underlyingAsset.safeTransfer(address(rewardDistributor), withdrawnYield);
                rewardDistributor.distribute(rewardPoolId, address(underlyingAsset), withdrawnYield, principalInThisAdapter);
                
                emit YieldHarvested(adapterAddress, withdrawnYield, rewardPoolId);
            }
        }
    }

    /* ───────────────────── Trusted Functions ─────────────────── */
    
    function executePayout(PayoutData calldata _payoutData) external override nonReentrant onlyRiskManager {
        uint256 totalPayoutAmount = _payoutData.claimantAmount + _payoutData.feeAmount;
        if (totalPayoutAmount == 0) return;
        if (totalPayoutAmount > _payoutData.totalCapitalFromPoolLPs) revert PayoutExceedsPoolLPCapital();

        _gatherFundsForPayout(_payoutData);

        require(underlyingAsset.balanceOf(address(this)) >= totalPayoutAmount, "CP: Payout failed, insufficient funds gathered");

        if (totalSystemValue >= totalPayoutAmount) {
            totalSystemValue -= totalPayoutAmount;
        } else {
            totalSystemValue = 0;
        }

        if (_payoutData.claimantAmount > 0) {
            underlyingAsset.safeTransfer(_payoutData.claimant, _payoutData.claimantAmount);
        }
        if (_payoutData.feeAmount > 0 && _payoutData.feeRecipient != address(0)) {
            underlyingAsset.safeTransfer(_payoutData.feeRecipient, _payoutData.feeAmount);
        }
    }

    function _gatherFundsForPayout(PayoutData calldata _payoutData) internal {
        if (_payoutData.totalCapitalFromPoolLPs > 0) {
            IBackstopPool catPool = IRiskManagerWithBackstop(riskManager).catPool();
            uint256 totalPayoutAmount = _payoutData.claimantAmount + _payoutData.feeAmount;

            for (uint i = 0; i < _payoutData.adapters.length; i++) {
                uint256 adapterCapitalShare = _payoutData.capitalPerAdapter[i];
                if (adapterCapitalShare == 0) continue;
                uint256 amountToWithdraw = Math.mulDiv(totalPayoutAmount, adapterCapitalShare, _payoutData.totalCapitalFromPoolLPs);
                if (amountToWithdraw == 0) continue;
                _handleWithdrawalAttempt(IYieldAdapter(_payoutData.adapters[i]), amountToWithdraw, catPool);
            }
        }
    }

    function burnSharesForLoss(
        address[] calldata underwriters,
        uint256[] calldata sharesToBurn,
        uint256 totalLossAmount
    ) external nonReentrant onlyLossDistributor {
        if (underwriters.length != sharesToBurn.length) revert MismatchedArrayLengths();
        if (totalLossAmount == 0) revert InvalidAmount();

        for (uint i = 0; i < underwriters.length; i++) {
            address underwriter = underwriters[i];
            uint256 burnAmount = sharesToBurn[i];
            if (burnAmount == 0) continue;

            UnderwriterAccount storage account = underwriterAccounts[underwriter];
            if (account.masterShares < burnAmount) revert InsufficientShares();

            account.masterShares -= burnAmount;
            
            uint256 principalLoss = Math.min(burnAmount, account.totalDepositedAssetPrincipal);
            account.totalDepositedAssetPrincipal -= principalLoss;

            bool wipedOut = (account.masterShares == 0);
            if (wipedOut) {
                delete underwriterAccounts[underwriter];
                delete withdrawalRequests[underwriter];
            }
            emit SharesBurntForLoss(underwriter, burnAmount);
        }

        // Reduce total shares and value by the same amount to keep the share price stable
        uint256 sharesEquivalentOfLoss = valueToShares(totalLossAmount);
        totalMasterSharesSystem -= sharesEquivalentOfLoss;
        if (totalSystemValue >= totalLossAmount) {
            totalSystemValue -= totalLossAmount;
        } else {
            totalSystemValue = 0;
        }
    }

    /* ───────────────────────── View Functions ──────────────────────── */
    function getUnderwriterAdapterAddress(address _underwriter) external view override returns(address) {
        return address(underwriterAccounts[_underwriter].yieldAdapter);
    }
    
    function getUnderwriterAccount(address _underwriter)
        external
        view
        override
        returns (
            uint256 totalDepositedAssetPrincipal,
            YieldPlatform yieldChoice,
            uint256 masterShares,
            uint256 totalPendingWithdrawalShares
        )
    {
        UnderwriterAccount storage account = underwriterAccounts[_underwriter];
        return (
            account.totalDepositedAssetPrincipal,
            account.yieldChoice,
            account.masterShares,
            account.totalPendingWithdrawalShares
        );
    }

    function _handleWithdrawalAttempt(
        IYieldAdapter adapter,
        uint256 amountToWithdraw,
        IBackstopPool catPool
    ) internal {
        try adapter.withdraw(amountToWithdraw, address(this)) {
            // Success
        } catch {
            emit AdapterCallFailed(address(adapter), "withdraw", "withdraw failed");
            uint256 sent = 0;
            try IYieldAdapterEmergency(address(adapter)).emergencyTransfer(address(this), amountToWithdraw) returns (uint256 v) {
                sent = v;
            } catch { /* Emergency transfer is not supported or failed. */ }
            if (sent == 0) {
                catPool.drawFund(amountToWithdraw);
            }
        }
    }
    function getWithdrawalRequestCount(address _underwriter) external view returns (uint256) {
        return withdrawalRequests[_underwriter].length;
    }

    function sharesToValue(uint256 _shares) public view override returns (uint256) {
        if (totalMasterSharesSystem <= INITIAL_SHARES_LOCKED) return 0;
        return Math.mulDiv(_shares, totalSystemValue, totalMasterSharesSystem - INITIAL_SHARES_LOCKED);
    }

    function valueToShares(uint256 _value) public view override returns (uint256) {
        if (totalSystemValue == 0) return _value;
        return Math.mulDiv(_value, totalMasterSharesSystem - INITIAL_SHARES_LOCKED, totalSystemValue);
    }
}