// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

// OpenZeppelin Imports
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

// Interface for Yield Adapters
interface IYieldAdapter {
    function deposit(uint256 _amount) external;
    function withdraw(uint256 _amount, address _to) external returns (uint256);
    function getCurrentValueHeld() external view returns (uint256);
    function asset() external view returns (IERC20);
}

/**
 * @title CapitalPool
 * @author Your Name/Team
 * @notice This contract acts as the central vault for the insurance protocol. It manages underwriter capital,
 * interacts with external yield-generating platforms, and handles the core accounting of shares and Net Asset Value (NAV).
 * Its primary responsibility is the secure custody of funds. The logic for selling insurance policies and processing
 * claims is handled by a separate `RiskManager` contract, which is the only contract authorized to apply losses.
 */
contract CapitalPool is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /* ───────────────────────── Constants ───────────────────────── */
    uint256 public constant BPS = 10_000;
    uint256 public constant UNDERWRITER_NOTICE_PERIOD = 30 days;

    /* ───────────────────────── State Variables ──────────────────────── */

    // --- Addresses ---
    address public riskManager; // The ONLY contract that can apply losses.

    // --- Base-Yield Platforms ---
    enum YieldPlatform { NONE, AAVE, COMPOUND, OTHER_YIELD }
    mapping(YieldPlatform => IYieldAdapter) public baseYieldAdapters;
    address[] public activeYieldAdapterAddresses;
    mapping(address => bool) public isAdapterActive; // To prevent duplicates in the array

    // --- Underwriter Account Data ---
    struct UnderwriterAccount {
        uint256 totalDepositedAssetPrincipal; // The principal component of the underwriter's stake.
        YieldPlatform yieldChoice;            // The yield platform this underwriter is using.
        IYieldAdapter yieldAdapter;           // Cached instance of the adapter for this underwriter.
        uint256 masterShares;                 // Shares representing their stake in the overall system.
        uint256 withdrawalRequestTimestamp;   // Timestamp of a pending withdrawal request.
        uint256 withdrawalRequestShares;      // Shares requested to be withdrawn.
    }
    mapping(address => UnderwriterAccount) public underwriterAccounts;

    // --- System-Wide Accounting ---
    uint256 public totalMasterSharesSystem; // Total shares issued across all underwriters.
    uint256 public totalSystemValue;        // NAV: Sum of all (principal + accrued yield - realized losses).
    IERC20 public underlyingAsset;           // The single underlying asset for this capital pool (e.g., USDC).

    /* ───────────────────────── Modifiers & Errors ──────────────────────── */
    modifier onlyRiskManager() {
        require(msg.sender == riskManager, "CP: Caller is not the RiskManager");
        _;
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
    }

    /* ───────────────────── Admin Functions ────────────────── */

    /**
     * @notice Sets the address of the RiskManager contract.
     * @dev Can only be called once to prevent unauthorized changes. The RiskManager has the critical
     * permission to apply losses to underwriters' capital.
     * @param _riskManager The address of the RiskManager contract.
     */
    function setRiskManager(address _riskManager) external onlyOwner {
        require(riskManager == address(0), "CP: RiskManager already set");
        if (_riskManager == address(0)) revert ZeroAddress();
        riskManager = _riskManager;
        emit RiskManagerSet(_riskManager);
    }

    /**
     * @notice Configures or updates the address for a yield adapter contract.
     * @param _platform The enum identifier for the yield platform.
     * @param _adapterAddress The address of the adapter contract.
     */
    function setBaseYieldAdapter(YieldPlatform _platform, address _adapterAddress) external onlyOwner {
        if (_platform == YieldPlatform.NONE) revert("CP: Cannot set for NONE platform");
        if (_adapterAddress == address(0)) revert ZeroAddress();

        uint256 codeSize;
        assembly { codeSize := extcodesize(_adapterAddress) }
        require(codeSize > 0, "CP: Adapter address is not a contract");

        // Ensure the adapter uses the correct underlying asset
        require(IYieldAdapter(_adapterAddress).asset() == underlyingAsset, "CP: Adapter asset mismatch");

        baseYieldAdapters[_platform] = IYieldAdapter(_adapterAddress);

        if (!isAdapterActive[_adapterAddress]) {
            isAdapterActive[_adapterAddress] = true;
            activeYieldAdapterAddresses.push(_adapterAddress);
        }
        emit BaseYieldAdapterSet(_platform, _adapterAddress);
    }


    /* ───────────────── Underwriter Deposit & Withdrawal ────────────────── */

    /**
     * @notice Allows an underwriter to deposit assets into the capital pool.
     * @dev The RiskManager contract will be notified of the deposit to update its own state regarding capital pledges.
     * @param _amount The amount of the underlying asset to deposit.
     * @param _yieldChoice The chosen external yield platform for the deposited assets.
     */
    function deposit(uint256 _amount, YieldPlatform _yieldChoice) external nonReentrant {
        if (_amount == 0) revert InvalidAmount();
        if (_yieldChoice == YieldPlatform.NONE) revert AdapterNotConfigured();

        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        IYieldAdapter chosenAdapter = baseYieldAdapters[_yieldChoice];

        if (address(chosenAdapter) == address(0)) revert AdapterNotConfigured();
        if (account.totalDepositedAssetPrincipal > 0) revert("CP: Must withdraw fully before new deposit");

        // --- Share Calculation (NAV-based) ---
        uint256 sharesToMint;
        if (totalMasterSharesSystem == 0) {
            sharesToMint = _amount; // Initial price: 1 share = 1 unit of underlying asset
        } else {
            if (totalSystemValue == 0) revert InconsistentState();
            sharesToMint = (_amount * totalMasterSharesSystem) / totalSystemValue;
        }
        if (sharesToMint == 0) revert NoSharesToMint();

        // --- Update Account ---
        account.totalDepositedAssetPrincipal = _amount;
        account.yieldChoice = _yieldChoice;
        account.yieldAdapter = chosenAdapter;
        account.masterShares = sharesToMint;

        // --- Asset Transfers & System Update ---
        underlyingAsset.safeTransferFrom(msg.sender, address(this), _amount);
        underlyingAsset.approve(address(chosenAdapter), _amount);
        chosenAdapter.deposit(_amount);

        totalMasterSharesSystem += sharesToMint;
        totalSystemValue += _amount;

        // --- Notify RiskManager of the new capital ---
        // The RiskManager contract is responsible for checking if it is configured.
        (bool success,) = riskManager.call(abi.encodeWithSignature("onCapitalDeposited(address,uint256)", msg.sender, _amount));
        require(success, "CP: Failed to notify RiskManager of deposit");

        emit Deposit(msg.sender, _amount, sharesToMint, _yieldChoice);
    }

    /**
     * @notice Initiates the withdrawal process for an underwriter.
     * @dev A notice period must pass before `executeWithdrawal` can be called. This allows the
     * RiskManager to ensure the withdrawal will not leave any insurance pools insolvent.
     * @param _sharesToBurn The number of shares the underwriter wishes to burn for assets.
     */
    function requestWithdrawal(uint256 _sharesToBurn) external nonReentrant {
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        if (_sharesToBurn == 0) revert InvalidAmount();
        if (_sharesToBurn > account.masterShares) revert InsufficientShares();
        if (account.withdrawalRequestShares > 0) revert WithdrawalRequestPending();
        
        // --- Notify RiskManager to check solvency impact ---
        // The RiskManager can revert this call if the withdrawal would cause insolvency.
        uint256 principalComponent = (account.totalDepositedAssetPrincipal * _sharesToBurn) / account.masterShares;
        (bool success,) = riskManager.call(abi.encodeWithSignature("onWithdrawalRequested(address,uint256)", msg.sender, principalComponent));
        require(success, "CP: RiskManager rejected withdrawal request");

        account.withdrawalRequestShares = _sharesToBurn;
        account.withdrawalRequestTimestamp = block.timestamp;

        emit WithdrawalRequested(msg.sender, _sharesToBurn, block.timestamp);
    }

    /**
     * @notice Completes a pending withdrawal request after the notice period.
     */
    function executeWithdrawal() external nonReentrant {
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        uint256 sharesToBurn = account.withdrawalRequestShares;

        if (sharesToBurn == 0) revert NoWithdrawalRequest();
        if (block.timestamp < account.withdrawalRequestTimestamp + UNDERWRITER_NOTICE_PERIOD) revert NoticePeriodActive();
        if (sharesToBurn > account.masterShares) revert InconsistentState(); // Share balance changed

        // --- Calculate NAV-based amount to receive ---
        uint256 amountToReceiveBasedOnNAV = 0;
        if (totalSystemValue > 0) {
            amountToReceiveBasedOnNAV = (sharesToBurn * totalSystemValue) / totalMasterSharesSystem;
        }

        // --- Withdraw assets from the yield adapter ---
        uint256 assetsActuallyWithdrawn = 0;
        if (amountToReceiveBasedOnNAV > 0) {
            assetsActuallyWithdrawn = account.yieldAdapter.withdraw(amountToReceiveBasedOnNAV, address(this));
        }

        // --- Update Principal and Shares ---
        uint256 principalComponentRemoved = (account.totalDepositedAssetPrincipal * sharesToBurn) / account.masterShares;
        account.totalDepositedAssetPrincipal -= principalComponentRemoved;
        account.masterShares -= sharesToBurn;

        totalMasterSharesSystem -= sharesToBurn;
        totalSystemValue = totalSystemValue > assetsActuallyWithdrawn ? totalSystemValue - assetsActuallyWithdrawn : 0;
        
        bool isFullWithdrawal = (account.masterShares == 0);
        if (isFullWithdrawal) {
            // Reset account for future deposits
            delete underwriterAccounts[msg.sender];
        } else {
             // Clear withdrawal request
            account.withdrawalRequestShares = 0;
            account.withdrawalRequestTimestamp = 0;
        }

        // --- Notify RiskManager that capital has been removed ---
        (bool success,) = riskManager.call(abi.encodeWithSignature("onCapitalWithdrawn(address,uint256,bool)", msg.sender, principalComponentRemoved, isFullWithdrawal));
        require(success, "CP: Failed to notify RiskManager of withdrawal");

        // --- Transfer assets to user ---
        if (assetsActuallyWithdrawn > 0) {
            underlyingAsset.safeTransfer(msg.sender, assetsActuallyWithdrawn);
        }

        emit WithdrawalExecuted(msg.sender, assetsActuallyWithdrawn, sharesToBurn);
    }


    /* ───────────────────── Trusted Functions (RiskManager Only) ────────────────── */

    /**
     * @notice Applies losses to an underwriter's principal as instructed by the RiskManager.
     * @dev This is the most critical trusted function. It reduces an underwriter's principal,
     * which also affects their share of the total system value. It can result in a "wipeout"
     * where the underwriter loses their entire stake.
     * @param _underwriter The address of the underwriter taking the loss.
     * @param _principalLossAmount The amount of principal to deduct.
     */
    function applyLosses(address _underwriter, uint256 _principalLossAmount) external nonReentrant onlyRiskManager {
        if (_principalLossAmount == 0) revert InvalidAmount();

        UnderwriterAccount storage account = underwriterAccounts[_underwriter];
        if (account.totalDepositedAssetPrincipal == 0) revert NoActiveDeposit();

        uint256 actualLoss = Math.min(_principalLossAmount, account.totalDepositedAssetPrincipal);
        
        account.totalDepositedAssetPrincipal -= actualLoss;
        // Total system value is reduced by the same amount of principal lost.
        // Yield that was notionally "backing" this principal is now socialized among remaining LPs.
        totalSystemValue = totalSystemValue > actualLoss ? totalSystemValue - actualLoss : 0;

        bool wipedOut = (account.totalDepositedAssetPrincipal == 0);
        if (wipedOut) {
            // If principal is zero, their shares are now worthless and should be burned to clean up state.
            totalMasterSharesSystem -= account.masterShares;
            delete underwriterAccounts[_underwriter];
        }

        emit LossesApplied(_underwriter, actualLoss, wipedOut);
    }


    /* ─────────────────── NAV Synchronization (Keeper Function) ─────────────────── */

    /**
     * @notice Recalculates the total system value (NAV) by querying all active yield adapters.
     * @dev Should be called periodically by a keeper to account for earned yield.
     * This updates the "price" of each share in the system.
     */
    function syncYieldAndAdjustSystemValue() external nonReentrant {
        uint256 newCalculatedTotalSystemValue = 0;

        // Sum values from all active yield adapters
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

        // Add any liquid underlying assets held directly by this contract
        newCalculatedTotalSystemValue += underlyingAsset.balanceOf(address(this));

        uint256 oldTotalSystemValue = totalSystemValue;
        totalSystemValue = newCalculatedTotalSystemValue;

        // Safety check: if all shares are gone, value should be zero.
        if (totalMasterSharesSystem == 0) {
            totalSystemValue = 0;
        }

        emit SystemValueSynced(totalSystemValue, oldTotalSystemValue);
    }

    /* ───────────────────────── View Functions ──────────────────────── */

    /**
     * @notice Returns the key details of an underwriter's account.
     */
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

    /**
     * @notice Calculates the current value of a certain number of shares.
     * @param _shares The number of shares.
     * @return The value of the shares in the underlying asset.
     */
    function sharesToValue(uint256 _shares) external view returns (uint256) {
        if (totalMasterSharesSystem == 0 || _shares == 0) {
            return 0;
        }
        return (_shares * totalSystemValue) / totalMasterSharesSystem;
    }

    /**
     * @notice Calculates the number of shares that would be minted for a given value.
     * @param _value The value in the underlying asset.
     * @return The number of shares that would be minted.
     */
    function valueToShares(uint256 _value) external view returns (uint256) {
        if (totalSystemValue == 0 || _value == 0) {
            // If there's no value in the system, 1 value = 1 share
            return _value;
        }
        return (_value * totalMasterSharesSystem) / totalSystemValue;
    }
}