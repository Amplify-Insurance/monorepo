
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
import "../interfaces/IRiskManagerWithBackstop.sol";

/**
 * @title CapitalPool
 * @author Gemini
 * @notice This contract acts as the central vault for the insurance protocol. This version
 * allows for multiple concurrent withdrawal requests per underwriter.
 */
contract CapitalPool is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /* ───────────────────────── Constants ───────────────────────── */
    uint256 public constant BPS = 10_000;
    uint256 public underwriterNoticePeriod = 0;
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
        uint256 totalPendingWithdrawalShares; // CHANGED: Replaced single request with total pending shares
    }
    mapping(address => UnderwriterAccount) public underwriterAccounts;

    // NEW: Struct to hold details of a single withdrawal request.
    struct WithdrawalRequest {
        uint256 shares;
        uint256 unlockTimestamp;
    }

    // NEW: Mapping to store multiple pending withdrawal requests per user.
    mapping(address => WithdrawalRequest[]) public withdrawalRequests;

    uint256 public totalMasterSharesSystem;
    uint256 public totalSystemValue;
    IERC20 public immutable underlyingAsset;

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
    error AdapterDrained();
    error InvalidRequestIndex(); // NEW: For executing/cancelling a request with a bad index.

    /* ───────────────────────── Events ──────────────────────────── */
    event RiskManagerSet(address indexed newRiskManager);
    event BaseYieldAdapterSet(YieldPlatform indexed platform, address indexed adapterAddress);
    event Deposit(address indexed user, uint256 amount, uint256 sharesMinted, YieldPlatform yieldChoice);
    event WithdrawalRequested(address indexed user, uint256 sharesToBurn, uint256 timestamp, uint256 requestIndex);
    event WithdrawalExecuted(address indexed user, uint256 assetsReceived, uint256 sharesBurned, uint256 requestIndex);
    event WithdrawalRequestCancelled(address indexed user, uint256 sharesCancelled, uint256 requestIndex); // NEW
    event LossesApplied(address indexed underwriter, uint256 principalLossAmount, bool wipedOut);
    event SystemValueSynced(uint256 newTotalSystemValue, uint256 oldTotalSystemValue);
    event AdapterCallFailed(address indexed adapterAddress, string functionCalled, string reason);
    event UnderwriterNoticePeriodSet(uint256 newPeriod);
    event PayoutExecuted(address indexed claimant, uint256 claimantAmount, address indexed feeRecipient, uint256 feeAmount, uint256 newTotalSystemValue);


    /* ───────────────────── Constructor ─────────────────────────── */
    constructor(address _initialOwner, address _underlyingAsset) Ownable(_initialOwner) {
        if (_underlyingAsset == address(0)) revert ZeroAddress();
        underlyingAsset = IERC20(_underlyingAsset);
        totalMasterSharesSystem = INITIAL_SHARES_LOCKED;
        underwriterAccounts[address(0)].masterShares = INITIAL_SHARES_LOCKED;
    }

    /* ───────────────────── Admin Functions ────────────────── */
    function setRiskManager(address riskManagerAddress) external onlyOwner {
        if (riskManagerAddress == address(0)) revert ZeroAddress();
        riskManager = riskManagerAddress;
        emit RiskManagerSet(riskManagerAddress);
    }

    function setUnderwriterNoticePeriod(uint256 newPeriod) external onlyOwner {
        underwriterNoticePeriod = newPeriod;
        emit UnderwriterNoticePeriodSet(newPeriod);
    }

    function setBaseYieldAdapter(YieldPlatform platform, address adapterAddress) external onlyOwner {
        if (platform == YieldPlatform.NONE) revert("CP: Cannot set for NONE platform");
        if (adapterAddress == address(0)) revert ZeroAddress();
        require(adapterAddress.code.length > 0, "CP: Adapter address is not a contract");
        require(address(IYieldAdapter(adapterAddress).asset()) == address(underlyingAsset), "CP: Adapter asset mismatch");
        baseYieldAdapters[platform] = IYieldAdapter(adapterAddress);
        if (!isAdapterActive[adapterAddress]) {
            isAdapterActive[adapterAddress] = true;
            activeYieldAdapterAddresses.push(adapterAddress);
        }
        emit BaseYieldAdapterSet(platform, adapterAddress);
    }

    /* ───────────────── Underwriter Deposit & Withdrawal ────────────────── */
    function deposit(uint256 amount, YieldPlatform yieldChoice) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (yieldChoice == YieldPlatform.NONE) revert AdapterNotConfigured();
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        IYieldAdapter chosenAdapter = baseYieldAdapters[yieldChoice];
        if (address(chosenAdapter) == address(0)) revert AdapterNotConfigured();
        if (account.masterShares > 0 && account.yieldChoice != yieldChoice) {
            revert("CP: Cannot change yield platform; withdraw first.");
        }
        uint256 sharesToMint;
        if (totalSystemValue == 0) {
            sharesToMint = amount;
        } else {
            sharesToMint = (amount * totalMasterSharesSystem) / totalSystemValue;
        }
        if (sharesToMint == 0) revert NoSharesToMint();
        if (account.masterShares == 0) {
            account.yieldChoice = yieldChoice;
            account.yieldAdapter = chosenAdapter;
        }
        account.totalDepositedAssetPrincipal += amount;
        account.masterShares += sharesToMint;
        underlyingAsset.safeTransferFrom(msg.sender, address(this), amount);
        // grant allowance safely for the adapter
        underlyingAsset.forceApprove(address(chosenAdapter), amount);
        chosenAdapter.deposit(amount);
        totalMasterSharesSystem += sharesToMint;
        totalSystemValue += amount;
        (bool success,) = riskManager.call(abi.encodeWithSignature("onCapitalDeposited(address,uint256)", msg.sender, amount));
        require(success, "CP: Failed to notify RiskManager of deposit");
        emit Deposit(msg.sender, amount, sharesToMint, yieldChoice);
    }

    // REFACTORED: to handle multiple requests
    function requestWithdrawal(uint256 sharesToBurn) external nonReentrant {
        if (sharesToBurn == 0) revert InvalidAmount();
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        
        // Check that the new request + already pending requests don't exceed total shares.
        uint256 newTotalPending = account.totalPendingWithdrawalShares + sharesToBurn;
        if (newTotalPending > account.masterShares) revert InsufficientShares();

        account.totalPendingWithdrawalShares = newTotalPending;

        uint256 valueToWithdraw = sharesToValue(sharesToBurn);
        (bool success,) = riskManager.call(abi.encodeWithSignature("onWithdrawalRequested(address,uint256)", msg.sender, valueToWithdraw));
        require(success, "CP: RiskManager rejected withdrawal request");
        
        uint256 unlockTime = block.timestamp + underwriterNoticePeriod;
        withdrawalRequests[msg.sender].push(WithdrawalRequest({
            shares: sharesToBurn,
            unlockTimestamp: unlockTime
        }));
        
        uint256 requestIndex = withdrawalRequests[msg.sender].length - 1;
        emit WithdrawalRequested(msg.sender, sharesToBurn, block.timestamp, requestIndex);
    }

    // NEW: Added a function to cancel a specific pending withdrawal request.
    function cancelWithdrawalRequest(uint256 requestIndex) external nonReentrant {
        WithdrawalRequest[] storage requests = withdrawalRequests[msg.sender];
        if (requestIndex >= requests.length) revert InvalidRequestIndex();

        uint256 sharesToCancel = requests[requestIndex].shares;

        // Effects: update accounting before making any external calls
        underwriterAccounts[msg.sender].totalPendingWithdrawalShares -= sharesToCancel;

        // Interaction: notify RiskManager about the cancellation
        uint256 valueCancelled = sharesToValue(sharesToCancel);
        (bool success,) = riskManager.call(
            abi.encodeWithSignature("onWithdrawalCancelled(address,uint256)", msg.sender, valueCancelled)
        );
        require(success, "CP: RiskManager rejected withdrawal cancellation");

        // Swap and pop to remove the request from the array efficiently
        requests[requestIndex] = requests[requests.length - 1];
        requests.pop();

        emit WithdrawalRequestCancelled(msg.sender, sharesToCancel, requestIndex);
    }

    // REFACTORED: to execute a specific request by index
    function executeWithdrawal(uint256 requestIndex) external nonReentrant {
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        WithdrawalRequest[] storage requests = withdrawalRequests[msg.sender];
        if (requestIndex >= requests.length) revert InvalidRequestIndex();

        WithdrawalRequest memory requestToExecute = requests[requestIndex];
        uint256 sharesToBurn = requestToExecute.shares;

        if (block.timestamp < requestToExecute.unlockTimestamp) revert NoticePeriodActive();
        if (sharesToBurn > account.masterShares) revert InconsistentState();

        uint256 amountToReceiveBasedOnNAV = sharesToValue(sharesToBurn);
        uint256 oldMasterShares = account.masterShares;

        // Effects: update user and global state before external interaction
        uint256 principalComponentRemoved = (account.totalDepositedAssetPrincipal * sharesToBurn) / oldMasterShares;
        account.totalDepositedAssetPrincipal -= principalComponentRemoved;
        account.masterShares -= sharesToBurn;
        account.totalPendingWithdrawalShares -= sharesToBurn;
        totalMasterSharesSystem -= sharesToBurn;

        // Remove the executed request from the array using swap-and-pop
        requests[requestIndex] = requests[requests.length - 1];
        requests.pop();

        // Interaction: pull funds from the adapter after state updates
        uint256 assetsActuallyWithdrawn = 0;
        if (amountToReceiveBasedOnNAV > 0) {
            assetsActuallyWithdrawn = account.yieldAdapter.withdraw(amountToReceiveBasedOnNAV, address(this));
        }

        totalSystemValue = totalSystemValue > assetsActuallyWithdrawn ? totalSystemValue - assetsActuallyWithdrawn : 0;

        bool isFullWithdrawal = (account.masterShares == 0);
        
        (bool success,) = riskManager.call(abi.encodeWithSignature("onCapitalWithdrawn(address,uint256,bool)", msg.sender, principalComponentRemoved, isFullWithdrawal));
        require(success, "CP: Failed to notify RiskManager of withdrawal");

        if (isFullWithdrawal) {
            delete underwriterAccounts[msg.sender];
        }

        if (assetsActuallyWithdrawn > 0) {
            underlyingAsset.safeTransfer(msg.sender, assetsActuallyWithdrawn);
        }
        
        emit WithdrawalExecuted(msg.sender, assetsActuallyWithdrawn, sharesToBurn, requestIndex);
    }


        /* ───────────────────── Trusted Functions (RiskManager Only) ────────────────── */
    function executePayout(PayoutData calldata payoutData) external nonReentrant onlyRiskManager {
        uint256 totalPayoutAmount = payoutData.claimantAmount + payoutData.feeAmount;
        if (totalPayoutAmount == 0) return;
        if (totalPayoutAmount > payoutData.totalCapitalFromPoolLPs) revert PayoutExceedsPoolLPCapital();

        uint256 amountPaidDirectlyByAdapters = 0;
        if (payoutData.totalCapitalFromPoolLPs > 0) {
            IBackstopPool catPool = IRiskManagerWithBackstop(riskManager).catPool();
            for (uint i = 0; i < payoutData.adapters.length; i++) {
                uint256 adapterCapitalShare = payoutData.capitalPerAdapter[i];
                if (adapterCapitalShare == 0) continue;

                uint256 amountToWithdraw = (totalPayoutAmount * adapterCapitalShare) / payoutData.totalCapitalFromPoolLPs;
                if (amountToWithdraw == 0) continue;

                amountPaidDirectlyByAdapters += _handleWithdrawalAttempt(
                    IYieldAdapter(payoutData.adapters[i]),
                    amountToWithdraw,
                    payoutData.claimant,
                    catPool
                );
            }
        }

        // Determine the amount that should have been gathered in this contract.
        uint256 requiredContractBalance = totalPayoutAmount - amountPaidDirectlyByAdapters;
        require(underlyingAsset.balanceOf(address(this)) >= requiredContractBalance, "CP: Payout failed, insufficient funds gathered");

        totalSystemValue -= totalPayoutAmount;

        // Calculate remaining amount to pay the claimant from this contract.
        uint256 claimantAmountToPay = payoutData.claimantAmount > amountPaidDirectlyByAdapters
            ? payoutData.claimantAmount - amountPaidDirectlyByAdapters
            : 0;

        if (claimantAmountToPay > 0) {
            underlyingAsset.safeTransfer(payoutData.claimant, claimantAmountToPay);
        }
        if (payoutData.feeAmount > 0 && payoutData.feeRecipient != address(0)) {
            underlyingAsset.safeTransfer(payoutData.feeRecipient, payoutData.feeAmount);
        }
        emit PayoutExecuted(payoutData.claimant, payoutData.claimantAmount, payoutData.feeRecipient, payoutData.feeAmount, totalSystemValue);
    }


    function applyLosses(address underwriter, uint256 principalLossAmount) external nonReentrant onlyRiskManager {
        if (principalLossAmount == 0) revert InvalidAmount();
        UnderwriterAccount storage account = underwriterAccounts[underwriter];
        if (account.totalDepositedAssetPrincipal == 0) revert NoActiveDeposit();
        uint256 actualLoss = Math.min(principalLossAmount, account.totalDepositedAssetPrincipal);
        if (account.totalDepositedAssetPrincipal > 0) {
            uint256 sharesToBurn = (account.masterShares * actualLoss) / account.totalDepositedAssetPrincipal;
            if (sharesToBurn > account.masterShares) {
                sharesToBurn = account.masterShares;
            }
            account.masterShares -= sharesToBurn;
            totalMasterSharesSystem -= sharesToBurn;
            // Note: Pending withdrawals may now be invalid if shares are lost.
            // The checks in executeWithdrawal() (sharesToBurn > account.masterShares) will catch this
            // and revert, forcing the user to cancel invalid requests.
        }
        account.totalDepositedAssetPrincipal -= actualLoss;
        totalSystemValue = totalSystemValue > actualLoss ? totalSystemValue - actualLoss : 0;
        bool wipedOut = (account.totalDepositedAssetPrincipal == 0 || account.masterShares == 0);
        if (wipedOut) {
            if(account.masterShares > 0) {
               totalMasterSharesSystem -= account.masterShares;
            }
            delete underwriterAccounts[underwriter];
            delete withdrawalRequests[underwriter]; // Also clear any pending requests.
        }
        emit LossesApplied(underwriter, actualLoss, wipedOut);
    }

    /* ─────────────────── NAV Synchronization (Keeper Function) ─────────────────── */
    function syncYieldAndAdjustSystemValue() external nonReentrant {
        uint256 newCalculatedTotalSystemValue = 0;
        uint256 adaptersLength = activeYieldAdapterAddresses.length;
        for (uint i = 0; i < adaptersLength; i++) {
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
    function getUnderwriterAdapterAddress(address underwriter) external view returns(address) {
        return address(underwriterAccounts[underwriter].yieldAdapter);
    }
    
    // REFACTORED: View function updated for new UnderwriterAccount struct
    function getUnderwriterAccount(address underwriter)
        external
        view
        returns (
            uint256 totalDepositedAssetPrincipal,
            YieldPlatform yieldChoice,
            uint256 masterShares,
            uint256 totalPendingWithdrawalShares
        )
    {
        UnderwriterAccount storage account = underwriterAccounts[underwriter];
        return (
            account.totalDepositedAssetPrincipal,
            account.yieldChoice,
            account.masterShares,
            account.totalPendingWithdrawalShares
        );
    }


        /**
    * @dev Internal function to handle the withdrawal from a yield adapter for a payout.
    * It attempts a standard withdrawal first. If that fails, it tries an emergency
    * transfer to the claimant. If both fail, it draws funds from the Catastrophe Pool.
    * @return amountPaidDirectly The amount of assets transferred directly to the claimant.
    */
    function _handleWithdrawalAttempt(
        IYieldAdapter adapter,
        uint256 amountToWithdraw,
        address claimant,
        IBackstopPool catPool
    ) internal returns (uint256 amountPaidDirectly) {
        try adapter.withdraw(amountToWithdraw, address(this)) {
            // Success: funds are in CapitalPool. Nothing was paid directly.
            return 0;
        } catch {
            emit AdapterCallFailed(address(adapter), "withdraw", "withdraw failed");
            
            uint256 sent = 0;
            // Fallback 1: Try emergency transfer directly to claimant.
            try IYieldAdapterEmergency(address(adapter)).emergencyTransfer(claimant, amountToWithdraw) returns (uint256 v) {
                sent = v;
            } catch {
                // Emergency transfer is not supported or failed.
            }

            if (sent > 0) {
                // Funds went directly to the claimant. Return this amount.
                return sent;
            } else {
                // Fallback 2: Draw from the backstop pool into this contract.
                catPool.drawFund(amountToWithdraw);
                return 0;
            }
        }
    }
    function getWithdrawalRequestCount(address underwriter) external view returns (uint256) {
        return withdrawalRequests[underwriter].length;
    }

    function sharesToValue(uint256 shares) public view returns (uint256) {
        if (totalMasterSharesSystem == 0 || shares == 0) {
            return 0;
        }
        return (shares * totalSystemValue) / totalMasterSharesSystem;
    }

    function valueToShares(uint256 value) external view returns (uint256) {
        if (totalSystemValue == 0) {
            return value;
        }
        return (value * totalMasterSharesSystem) / totalSystemValue;
    }
}
