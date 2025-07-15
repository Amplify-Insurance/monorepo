// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

// OpenZeppelin Imports
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IYieldAdapterEmergency.sol";
import "../interfaces/IRewardDistributor.sol";
import "../interfaces/IRiskManagerWithBackstop.sol";

/**
 * @title CapitalPool
 * @author Gemini
 * @notice This contract acts as the central vault for the insurance protocol.
 * @dev It manages the principal capital of underwriters and interacts with an external
 * RewardDistributor contract to handle the distribution of yield.
 */
contract CapitalPool is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /* ───────────────────────── Constants ───────────────────────── */
    uint256 public constant BPS = 10_000;
    uint256 private constant INITIAL_SHARES_LOCKED = 1000;

    /* ───────────────────────── State Variables ───────────────────────── */
    address public riskManager;
    IRewardDistributor public rewardDistributor;
    uint256 public underwriterNoticePeriod = 0;

    enum YieldPlatform { NONE, AAVE, COMPOUND, OTHER_YIELD }
    mapping(YieldPlatform => IYieldAdapter) public baseYieldAdapters;
    address[] public activeYieldAdapterAddresses;
    mapping(address => bool) public isAdapterActive;

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
    
    struct PayoutData {
        address claimant;
        uint256 claimantAmount;
        address feeRecipient;
        uint256 feeAmount;
        address[] adapters;
        uint256[] capitalPerAdapter;
        uint256 totalCapitalFromPoolLPs;
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

    /* ───────────────────────── Events ──────────────────────────── */
    event RiskManagerSet(address indexed newRiskManager);
    event RewardDistributorSet(address indexed newRewardDistributor);
    event BaseYieldAdapterSet(YieldPlatform indexed platform, address indexed adapterAddress);
    event Deposit(address indexed user, uint256 amount, uint256 sharesMinted, YieldPlatform yieldChoice);
    event WithdrawalRequested(address indexed user, uint256 sharesToBurn, uint256 timestamp, uint256 requestIndex);
    event WithdrawalExecuted(address indexed user, uint256 assetsReceived, uint256 sharesBurned, uint256 requestIndex);
    event WithdrawalRequestCancelled(address indexed user, uint256 sharesCancelled, uint256 requestIndex);
    event LossesApplied(address indexed underwriter, uint256 principalLossAmount, bool wipedOut);
    event YieldHarvested(address indexed adapter, uint256 yieldAmount);
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

    /* ───────────────── Underwriter Deposit & Withdrawal ────────────────── */    
    

/**
 * @notice The main entry point for an underwriter to deposit capital.
 * @dev This function orchestrates the deposit process by calling internal helpers for
 * validation, share calculation, state updates, and external interactions.
 * It follows the Checks-Effects-Interactions pattern.
 * @param _amount The amount of the underlying asset to deposit.
 * @param _yieldChoice The target yield platform for the deposited capital.
 */
function deposit(uint256 _amount, YieldPlatform _yieldChoice) external nonReentrant {
    // State needed by helpers
    UnderwriterAccount storage account = underwriterAccounts[msg.sender];
    IYieldAdapter chosenAdapter = baseYieldAdapters[_yieldChoice];

    // 1. Checks: Validate all preconditions for the deposit.
    _validateDeposit(account, _amount, _yieldChoice, chosenAdapter);

    // 2. Calculations: Determine the number of shares to mint for the deposit.
    uint256 sharesToMint = _calculateSharesToMint(_amount);

    // 3. Effects: Update all relevant contract state variables.
    _updateStateOnDeposit(account, _amount, sharesToMint, _yieldChoice, chosenAdapter);

    // 4. Interactions: Execute external calls to other contracts.
    _executeDepositAndHooks(msg.sender, _amount, sharesToMint, chosenAdapter);

    // 5. Emit Event
    emit Deposit(msg.sender, _amount, sharesToMint, _yieldChoice);
}


/**
 * @dev Validates all inputs and state conditions before proceeding with a deposit.
 */
function _validateDeposit(
    UnderwriterAccount storage account,
    uint256 _amount,
    YieldPlatform _yieldChoice,
    IYieldAdapter chosenAdapter
) internal view {
    if (_amount == 0) revert InvalidAmount();
    if (_yieldChoice == YieldPlatform.NONE) revert AdapterNotConfigured();
    if (address(chosenAdapter) == address(0)) revert AdapterNotConfigured();

    // Prevent user from depositing into a new yield platform before withdrawing from the old one.
    if (account.masterShares > 0 && account.yieldChoice != _yieldChoice) {
        revert("CP: Cannot change yield platform; withdraw first.");
    }
}

/**
 * @dev Calculates the number of master shares to mint for a given deposit amount.
 */
    function _calculateSharesToMint(uint256 _amount) internal view returns (uint256) {
        // Subtract the locked shares to get the active supply
        uint256 effectiveShares = totalMasterSharesSystem - INITIAL_SHARES_LOCKED;

        // First depositor or empty pool mints 1:1
        if (totalSystemValue == 0 || effectiveShares == 0) {
            return _amount;
        }

        // Compute the ceiling of current NAV per share
        uint256 pricePerShare = Math.ceilDiv(totalSystemValue, effectiveShares);
        // Require deposit to exceed cost of one share
        if (_amount <= pricePerShare) {
            revert NoSharesToMint();
        }

        // Mint floor(_amount * activeShares / totalSystemValue)
        return Math.mulDiv(_amount, effectiveShares, totalSystemValue);
    }


/**
 * @dev Updates all system and user state variables related to the deposit.
 */
function _updateStateOnDeposit(
    UnderwriterAccount storage account,
    uint256 _amount,
    uint256 _sharesToMint,
    YieldPlatform _yieldChoice,
    IYieldAdapter _chosenAdapter
) internal {
    // Set the user's yield choice on their first deposit.
    if (account.masterShares == 0) {
        account.yieldChoice  = _yieldChoice;
        account.yieldAdapter = _chosenAdapter;
    }

    account.totalDepositedAssetPrincipal += _amount;
    account.masterShares                 += _sharesToMint;
    totalMasterSharesSystem             += _sharesToMint;
    totalSystemValue                    += _amount;

    principalInAdapter[address(_chosenAdapter)] += _amount;
}

/**
 * @dev Executes all external calls: token transfers, adapter deposits, and hooks.
 */
function _executeDepositAndHooks(
    address _depositor,
    uint256 _amount,
    uint256 _sharesToMint,
    IYieldAdapter _chosenAdapter
) internal {
    // Core interaction with the yield adapter
    underlyingAsset.safeTransferFrom(_depositor, address(this), _amount);
    underlyingAsset.forceApprove(address(_chosenAdapter), _amount);
    _chosenAdapter.deposit(_amount);

    // Post-deposit hooks for other system components
    if (address(rewardDistributor) != address(0)) {
        rewardDistributor.updateUserState(_depositor, 0, address(underlyingAsset), _sharesToMint);
    }

    (bool success,) = riskManager.call(
        abi.encodeWithSignature("onCapitalDeposited(address,uint256)", _depositor, _amount)
    );
    require(success, "CP: Failed to notify RiskManager of deposit");
}

    function requestWithdrawal(uint256 _sharesToBurn) external nonReentrant {
        if (_sharesToBurn == 0) revert InvalidAmount();
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        
        uint256 newTotalPending = account.totalPendingWithdrawalShares + _sharesToBurn;
        if (newTotalPending > account.masterShares) revert InsufficientShares();

        account.totalPendingWithdrawalShares = newTotalPending;

        uint256 valueToWithdraw = sharesToValue(_sharesToBurn);
        (bool success,) = riskManager.call(abi.encodeWithSignature("onWithdrawalRequested(address,uint256)", msg.sender, valueToWithdraw));
        require(success, "CP: RiskManager rejected withdrawal request");
        
        uint256 unlockTime = block.timestamp + underwriterNoticePeriod;
        withdrawalRequests[msg.sender].push(WithdrawalRequest({
            shares: _sharesToBurn,
            unlockTimestamp: unlockTime
        }));
        
        uint256 requestIndex = withdrawalRequests[msg.sender].length - 1;
        emit WithdrawalRequested(msg.sender, _sharesToBurn, block.timestamp, requestIndex);
    }

    function cancelWithdrawalRequest(uint256 _requestIndex) external nonReentrant {
        WithdrawalRequest[] storage requests = withdrawalRequests[msg.sender];
        if (_requestIndex >= requests.length) revert InvalidRequestIndex();

        uint256 sharesToCancel = requests[_requestIndex].shares;

        uint256 valueCancelled = sharesToValue(sharesToCancel);
        (bool success,) = riskManager.call(abi.encodeWithSignature("onWithdrawalCancelled(address,uint256)", msg.sender, valueCancelled));
        require(success, "CP: RiskManager rejected withdrawal cancellation");

        underwriterAccounts[msg.sender].totalPendingWithdrawalShares -= sharesToCancel;

        requests[_requestIndex] = requests[requests.length - 1];
        requests.pop();

        emit WithdrawalRequestCancelled(msg.sender, sharesToCancel, _requestIndex);
    }

    function executeWithdrawal(uint256 _requestIndex) external nonReentrant {
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        WithdrawalRequest[] storage requests = withdrawalRequests[msg.sender];
        if (_requestIndex >= requests.length) revert InvalidRequestIndex();

        WithdrawalRequest memory requestToExecute = requests[_requestIndex];
        uint256 sharesToBurn = requestToExecute.shares;

        if (block.timestamp < requestToExecute.unlockTimestamp) revert NoticePeriodActive();
        if (sharesToBurn > account.masterShares) revert InconsistentState();

        uint256 amountToReceiveBasedOnNAV = sharesToValue(sharesToBurn);
        uint256 principalComponentRemoved = _burnSharesAndRemoveRequest(msg.sender, _requestIndex, sharesToBurn);

        uint256 assetsActuallyWithdrawn = 0;
        if (amountToReceiveBasedOnNAV > 0) {
            assetsActuallyWithdrawn = account.yieldAdapter.withdraw(amountToReceiveBasedOnNAV, address(this));
        }

        if (totalSystemValue >= principalComponentRemoved) {
            totalSystemValue -= principalComponentRemoved;
        } else {
            totalSystemValue = 0;
        }

        principalInAdapter[address(account.yieldAdapter)] -= assetsActuallyWithdrawn;
        
        if (address(rewardDistributor) != address(0)) {
            rewardDistributor.updateUserState(msg.sender, 0, address(underlyingAsset), account.masterShares);
        }

        bool isFullWithdrawal = (account.masterShares == 0);
        (bool success,) = riskManager.call(abi.encodeWithSignature("onCapitalWithdrawn(address,uint256,bool)", msg.sender, principalComponentRemoved, isFullWithdrawal));
        require(success, "CP: Failed to notify RiskManager of withdrawal");

        if (isFullWithdrawal) {
            delete underwriterAccounts[msg.sender];
        }

        if (assetsActuallyWithdrawn > 0) {
            underlyingAsset.safeTransfer(msg.sender, assetsActuallyWithdrawn);
        }
        
        emit WithdrawalExecuted(msg.sender, assetsActuallyWithdrawn, sharesToBurn, _requestIndex);
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
        } catch {
            return; // Skip on failure
        }

        uint256 principal = principalInAdapter[adapterAddress];
        if (currentValue > principal) {
            uint256 yieldAmount = currentValue - principal;
            
            uint256 withdrawnYield = adapter.withdraw(yieldAmount, address(this));
            
            if (withdrawnYield > 0 && address(rewardDistributor) != address(0)) {
                underlyingAsset.safeTransfer(address(rewardDistributor), withdrawnYield);
                rewardDistributor.distribute(0, address(underlyingAsset), withdrawnYield, totalMasterSharesSystem);
                emit YieldHarvested(adapterAddress, withdrawnYield);
            }
        }
    }

    /* ───────────────────── Trusted Functions (RiskManager Only) ─────────────────── */
    
    function executePayout(PayoutData calldata _payoutData) external nonReentrant onlyRiskManager {
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

                _handleWithdrawalAttempt(
                    IYieldAdapter(_payoutData.adapters[i]),
                    amountToWithdraw,
                    catPool
                );
            }
        }
    }

    function applyLosses(address _underwriter, uint256 _principalLossAmount) external nonReentrant onlyRiskManager {
        if (_principalLossAmount == 0) revert InvalidAmount();
        UnderwriterAccount storage account = underwriterAccounts[_underwriter];
        if (account.totalDepositedAssetPrincipal == 0) revert NoActiveDeposit();

        uint256 actualLoss = Math.min(_principalLossAmount, account.totalDepositedAssetPrincipal);

        _applyLossToAccount(account, actualLoss);

        if (totalSystemValue >= actualLoss) {
            totalSystemValue -= actualLoss;
        } else {
            totalSystemValue = 0;
        }
        
        principalInAdapter[address(account.yieldAdapter)] -= actualLoss;

        if (address(rewardDistributor) != address(0)) {
            rewardDistributor.updateUserState(_underwriter, 0, address(underlyingAsset), account.masterShares);
        }

        bool wipedOut = (account.totalDepositedAssetPrincipal == 0);
        if (wipedOut) {
            if(account.masterShares > 0) {
                totalMasterSharesSystem -= account.masterShares;
            }
            delete underwriterAccounts[_underwriter];
            delete withdrawalRequests[_underwriter];
        }
        emit LossesApplied(_underwriter, actualLoss, wipedOut);
    }

    function _applyLossToAccount(UnderwriterAccount storage account, uint256 _lossAmount) internal {
        if (account.totalDepositedAssetPrincipal > 0) {
            uint256 sharesToBurn = Math.mulDiv(_lossAmount, account.masterShares, account.totalDepositedAssetPrincipal);
            if (sharesToBurn > account.masterShares) {
                sharesToBurn = account.masterShares;
            }
            account.masterShares -= sharesToBurn;
            totalMasterSharesSystem -= sharesToBurn;
        }
        account.totalDepositedAssetPrincipal -= _lossAmount;
    }

    /* ───────────────────────── View Functions ──────────────────────── */
    function getUnderwriterAdapterAddress(address _underwriter) external view returns(address) {
        return address(underwriterAccounts[_underwriter].yieldAdapter);
    }
    
    function getUnderwriterAccount(address _underwriter)
        external
        view
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
            } catch {
                // Emergency transfer is not supported or failed.
            }

            if (sent == 0) {
                // Fallback: Draw from the backstop pool into this contract.
                catPool.drawFund(amountToWithdraw);
            }
        }
    }
    function getWithdrawalRequestCount(address _underwriter) external view returns (uint256) {
        return withdrawalRequests[_underwriter].length;
    }

    function sharesToValue(uint256 _shares) public view returns (uint256) {
        if (totalMasterSharesSystem <= INITIAL_SHARES_LOCKED) return 0;
        return Math.mulDiv(_shares, totalSystemValue, totalMasterSharesSystem - INITIAL_SHARES_LOCKED);
    }

    function valueToShares(uint256 _value) external view returns (uint256) {
        if (totalSystemValue == 0) {
            return _value;
        }
        return Math.mulDiv(_value, totalMasterSharesSystem - INITIAL_SHARES_LOCKED, totalSystemValue);
    }
}
