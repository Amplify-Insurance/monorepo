// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

// OpenZeppelin Imports
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IYieldAdapterEmergency.sol";
import "../interfaces/IRiskManagerWithCat.sol";

/**
 * @title CapitalPool
 * @author Gemini
 * @notice This contract acts as the central vault for the insurance protocol. This version
 * has a highly scalable payout function and all necessary view functions for the RiskManager.
 */
contract CapitalPool is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /* ───────────────────────── Constants ───────────────────────── */
    uint256 public constant BPS = 10_000;
    uint256 public constant UNDERWRITER_NOTICE_PERIOD = 0 days;
    uint256 private constant INITIAL_SHARES_LOCKED = 1000;

    /* ───────────────────────── State Variables ───────────────────────── */
    address public riskManager;

    enum YieldPlatform { NONE, AAVE, COMPOUND, OTHER_YIELD }
    mapping(YieldPlatform => IYieldAdapter) public baseYieldAdapters;
    address[] public activeYieldAdapterAddresses;
    mapping(address => bool) public isAdapterActive;

    struct UnderwriterAccount {
        uint256 totalDepositedAssetPrincipal;
        YieldPlatform yieldChoice;
        IYieldAdapter yieldAdapter;
        uint256 masterShares;
        uint256 withdrawalRequestTimestamp;
        uint256 withdrawalRequestShares;
    }
    mapping(address => UnderwriterAccount) public underwriterAccounts;

    uint256 public totalMasterSharesSystem;
    uint256 public totalSystemValue;
    IERC20 public underlyingAsset;

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
    error WithdrawalRequestPending();
    error InsufficientShares();
    error AdapterNotConfigured();
    error NoActiveDeposit();
    error PayoutExceedsPoolLPCapital();
    error AdapterDrained();

    /* ───────────────────────── Events ──────────────────────────── */
    event RiskManagerSet(address indexed newRiskManager);
    event BaseYieldAdapterSet(YieldPlatform indexed platform, address indexed adapterAddress);
    event Deposit(address indexed user, uint256 amount, uint256 sharesMinted, YieldPlatform yieldChoice);
    event WithdrawalRequested(address indexed user, uint256 sharesToBurn, uint256 timestamp);
    event WithdrawalExecuted(address indexed user, uint256 assetsReceived, uint256 sharesBurned);
    event LossesApplied(address indexed underwriter, uint256 principalLossAmount, bool wipedOut);
    event SystemValueSynced(uint256 newTotalSystemValue, uint256 oldTotalSystemValue);
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
    function deposit(uint256 _amount, YieldPlatform _yieldChoice) external nonReentrant {
        if (_amount == 0) revert InvalidAmount();
        if (_yieldChoice == YieldPlatform.NONE) revert AdapterNotConfigured();
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        IYieldAdapter chosenAdapter = baseYieldAdapters[_yieldChoice];
        if (address(chosenAdapter) == address(0)) revert AdapterNotConfigured();
        if (account.masterShares > 0 && account.yieldChoice != _yieldChoice) {
            revert("CP: Cannot change yield platform; withdraw first.");
        }
        uint256 sharesToMint;
        if (totalSystemValue == 0) {
            sharesToMint = _amount;
        } else {
            sharesToMint = (_amount * totalMasterSharesSystem) / totalSystemValue;
        }
        if (sharesToMint == 0) revert NoSharesToMint();
        if (account.masterShares == 0) {
            account.yieldChoice = _yieldChoice;
            account.yieldAdapter = chosenAdapter;
        }
        account.totalDepositedAssetPrincipal += _amount;
        account.masterShares += sharesToMint;
        underlyingAsset.safeTransferFrom(msg.sender, address(this), _amount);
        underlyingAsset.approve(address(chosenAdapter), _amount);
        chosenAdapter.deposit(_amount);
        totalMasterSharesSystem += sharesToMint;
        totalSystemValue += _amount;
        (bool success,) = riskManager.call(abi.encodeWithSignature("onCapitalDeposited(address,uint256)", msg.sender, _amount));
        require(success, "CP: Failed to notify RiskManager of deposit");
        emit Deposit(msg.sender, _amount, sharesToMint, _yieldChoice);
    }

    function requestWithdrawal(uint256 _sharesToBurn) external nonReentrant {
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        if (_sharesToBurn == 0) revert InvalidAmount();
        if (_sharesToBurn > account.masterShares) revert InsufficientShares();
        if (account.withdrawalRequestShares > 0) revert WithdrawalRequestPending();
        uint256 valueToWithdraw = sharesToValue(_sharesToBurn);
        (bool success,) = riskManager.call(abi.encodeWithSignature("onWithdrawalRequested(address,uint256)", msg.sender, valueToWithdraw));
        require(success, "CP: RiskManager rejected withdrawal request");
        account.withdrawalRequestShares = _sharesToBurn;
        account.withdrawalRequestTimestamp = block.timestamp;
        emit WithdrawalRequested(msg.sender, _sharesToBurn, block.timestamp);
    }

    function executeWithdrawal() external nonReentrant {
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        uint256 sharesToBurn = account.withdrawalRequestShares;
        if (sharesToBurn == 0) revert NoWithdrawalRequest();
        if (block.timestamp < account.withdrawalRequestTimestamp + UNDERWRITER_NOTICE_PERIOD) revert NoticePeriodActive();
        if (sharesToBurn > account.masterShares) revert InconsistentState();
        uint256 amountToReceiveBasedOnNAV = sharesToValue(sharesToBurn);
        uint256 assetsActuallyWithdrawn = 0;
        if (amountToReceiveBasedOnNAV > 0) {
            assetsActuallyWithdrawn = account.yieldAdapter.withdraw(amountToReceiveBasedOnNAV, address(this));
        }
        uint256 principalComponentRemoved = (account.totalDepositedAssetPrincipal * sharesToBurn) / account.masterShares;
        account.totalDepositedAssetPrincipal -= principalComponentRemoved;
        account.masterShares -= sharesToBurn;
        totalMasterSharesSystem -= sharesToBurn;
        totalSystemValue = totalSystemValue > assetsActuallyWithdrawn ? totalSystemValue - assetsActuallyWithdrawn : 0;
        bool isFullWithdrawal = (account.masterShares == 0);
        if (isFullWithdrawal) {
            delete underwriterAccounts[msg.sender];
        } else {
            account.withdrawalRequestShares = 0;
            account.withdrawalRequestTimestamp = 0;
        }
        (bool success,) = riskManager.call(abi.encodeWithSignature("onCapitalWithdrawn(address,uint256,bool)", msg.sender, principalComponentRemoved, isFullWithdrawal));
        require(success, "CP: Failed to notify RiskManager of withdrawal");
        if (assetsActuallyWithdrawn > 0) {
            underlyingAsset.safeTransfer(msg.sender, assetsActuallyWithdrawn);
        }
        emit WithdrawalExecuted(msg.sender, assetsActuallyWithdrawn, sharesToBurn);
    }


    /* ───────────────────── Trusted Functions (RiskManager Only) ────────────────── */
    function executePayout(PayoutData calldata _payoutData) external nonReentrant onlyRiskManager {
        uint256 totalPayoutAmount = _payoutData.claimantAmount + _payoutData.feeAmount;
        if (totalPayoutAmount == 0) return;
        if (totalPayoutAmount > _payoutData.totalCapitalFromPoolLPs) revert PayoutExceedsPoolLPCapital();
        
        ICatInsurancePool catPool = IRiskManagerWithCat(riskManager).catPool();

        if (_payoutData.totalCapitalFromPoolLPs > 0) {
            for (uint i = 0; i < _payoutData.adapters.length; i++) {
                IYieldAdapter adapter = IYieldAdapter(_payoutData.adapters[i]);
                uint256 adapterCapitalShare = _payoutData.capitalPerAdapter[i];
                if (adapterCapitalShare > 0) {
                    uint256 amountToWithdraw = (totalPayoutAmount * adapterCapitalShare) / _payoutData.totalCapitalFromPoolLPs;
                    if(amountToWithdraw > 0) {
                        try adapter.withdraw(amountToWithdraw, address(this)) {
                        } catch {
                            emit AdapterCallFailed(_payoutData.adapters[i], "withdraw", "withdraw failed");
                            uint256 sent;
                            try IYieldAdapterEmergency(_payoutData.adapters[i]).emergencyTransfer(_payoutData.claimant, amountToWithdraw) returns (uint256 v) {
                                sent = v;
                            } catch {}
                            if (sent == 0) {
                                catPool.drawFund(amountToWithdraw);
                            }
                        }
                    }
                }
            }
        }
        require(underlyingAsset.balanceOf(address(this)) >= totalPayoutAmount, "CP: Payout failed, insufficient funds gathered");
        totalSystemValue -= totalPayoutAmount;
        if (_payoutData.claimantAmount > 0) {
            underlyingAsset.safeTransfer(_payoutData.claimant, _payoutData.claimantAmount);
        }
        if (_payoutData.feeAmount > 0 && _payoutData.feeRecipient != address(0)) {
            underlyingAsset.safeTransfer(_payoutData.feeRecipient, _payoutData.feeAmount);
        }
    }

    function applyLosses(address _underwriter, uint256 _principalLossAmount) external nonReentrant onlyRiskManager {
        if (_principalLossAmount == 0) revert InvalidAmount();
        UnderwriterAccount storage account = underwriterAccounts[_underwriter];
        if (account.totalDepositedAssetPrincipal == 0) revert NoActiveDeposit();
        uint256 actualLoss = Math.min(_principalLossAmount, account.totalDepositedAssetPrincipal);
        if (account.totalDepositedAssetPrincipal > 0) {
            uint256 sharesToBurn = (account.masterShares * actualLoss) / account.totalDepositedAssetPrincipal;
            if (sharesToBurn > account.masterShares) {
                sharesToBurn = account.masterShares;
            }
            account.masterShares -= sharesToBurn;
            totalMasterSharesSystem -= sharesToBurn;
        }
        account.totalDepositedAssetPrincipal -= actualLoss;
        totalSystemValue = totalSystemValue > actualLoss ? totalSystemValue - actualLoss : 0;
        bool wipedOut = (account.totalDepositedAssetPrincipal == 0 || account.masterShares == 0);
        if (wipedOut) {
            if(account.masterShares > 0) {
               totalMasterSharesSystem -= account.masterShares;
            }
            delete underwriterAccounts[_underwriter];
        }
        emit LossesApplied(_underwriter, actualLoss, wipedOut);
    }

    /* ─────────────────── NAV Synchronization (Keeper Function) ─────────────────── */
    function syncYieldAndAdjustSystemValue() external nonReentrant {
        uint256 newCalculatedTotalSystemValue = 0;
        for (uint i = 0; i < activeYieldAdapterAddresses.length; i++) {
            address adapterAddress = activeYieldAdapterAddresses[i];
            try IYieldAdapter(adapterAddress).getCurrentValueHeld() returns (uint256 valueInAdapter) {
                newCalculatedTotalSystemValue += valueInAdapter;
            } catch Error(string memory reason) {
                emit AdapterCallFailed(adapterAddress, "getCurrentValueHeld", reason);
            } catch {
                emit AdapterCallFailed(adapterAddress, "getCurrentValueHeld", "Unknown error");
            }
        }
        newCalculatedTotalSystemValue += underlyingAsset.balanceOf(address(this));
        uint256 oldTotalSystemValue = totalSystemValue;
        totalSystemValue = newCalculatedTotalSystemValue;
        if (totalMasterSharesSystem == 0) {
            totalSystemValue = 0;
        }
        emit SystemValueSynced(totalSystemValue, oldTotalSystemValue);
    }

    /* ───────────────────────── View Functions ──────────────────────── */
    // CORRECTED: Added the missing view function required by RiskManager
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
            uint256 withdrawalRequestTimestamp,
            uint256 withdrawalRequestShares
        )
    {
        UnderwriterAccount storage account = underwriterAccounts[_underwriter];
        return (
            account.totalDepositedAssetPrincipal,
            account.yieldChoice,
            account.masterShares,
            account.withdrawalRequestTimestamp,
            account.withdrawalRequestShares
        );
    }

    function sharesToValue(uint256 _shares) public view returns (uint256) {
        if (totalMasterSharesSystem == 0 || _shares == 0) {
            return 0;
        }
        return (_shares * totalSystemValue) / totalMasterSharesSystem;
    }

    function valueToShares(uint256 _value) external view returns (uint256) {
        if (totalSystemValue == 0 || _value == 0) {
            return _value;
        }
        return (_value * totalMasterSharesSystem) / totalSystemValue;
    }
}