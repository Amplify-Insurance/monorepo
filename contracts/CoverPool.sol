// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

// OpenZeppelin Imports
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol"; // For Math.min

// Local Imports (ensure paths are correct and contracts exist)
// Assuming these are correctly defined in your project structure
import "./PolicyNFT.sol"; 
import "./CatInsurancePool.sol"; 
// import "./interfaces/IYieldAdapter.sol"; // Defined below for completeness in this snippet


contract CoverPool is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /* ───────────────────────── Constants ───────────────────────── */
    uint256 public constant BPS = 10_000;
    uint256 public constant SECS_YEAR = 365 days;
    uint256 public constant CLAIM_FEE_BPS = 500; // 5%
    uint256 public constant UNDERWRITER_NOTICE_PERIOD = 30 days;
    uint256 public constant COVER_COOLDOWN_PERIOD = 5 days;
    uint256 public constant MAX_ALLOCATIONS_PER_UNDERWRITER = 5;

    /* ───────────────────── Base-Yield Platforms ────────────────── */
    enum YieldPlatform { NONE, AAVE, COMPOUND, OTHER_YIELD } // Example yield platforms
    mapping(YieldPlatform => IYieldAdapter) public baseYieldAdapters;

    /* ───────────────── Underwriter Account Data ────────────────── */
    struct UnderwriterAccount {
        uint256 totalDepositedAssetPrincipal; // Tracks the principal component of the underwriter's stake
        YieldPlatform yieldChoice;
        IYieldAdapter yieldAdapter; // Cached instance of the adapter for this underwriter
        uint256[] allocatedPoolIds; // Array of PoolData IDs this underwriter is backing in the current session
        mapping(uint256 => bool) isAllocatedToPool; // poolId => is currently allocated in this session
        uint256 masterShares; // Shares representing their stake in the overall system
        uint256 withdrawalRequestTimestamp;
        uint256 withdrawalRequestShares; // Shares requested to be withdrawn
    }
    mapping(address => UnderwriterAccount) public underwriterAccounts;
    uint256 public totalMasterSharesSystem; // Total shares issued across all underwriters
    uint256 public totalSystemValue; // NAV: Sum of all (principal + accrued yield - realized losses)

    // For iterating underwriters per pool and efficient removal
    mapping(uint256 => address[]) public poolSpecificUnderwriters; // poolId => list of underwriter addresses
    mapping(uint256 => mapping(address => uint256)) public underwriterIndexInPoolArray; // poolId => underwriterAddr => index in above array
    
    // For syncYieldAndAdjustSystemValue - to iterate over adapters this contract uses
    address[] public activeYieldAdapterAddresses;
    mapping(address => bool) public isAdapterActive; // To prevent duplicates in the array


    /* ───────────────────── Cat-Fund & Premiums ─────────────────── */
    uint256 public catPremiumBps = 2_000; // 20%
    CatInsurancePool public immutable catPool;

    /* ───────────────────────── Rate Model ──────────────────────── */
    struct RateModel {
        uint256 base; // Base annual rate in BPS (e.g., 200 for 2%)
        uint256 slope1; // Slope for utilization < kink (BPS change per BPS utilization change)
        uint256 slope2; // Slope for utilization >= kink
        uint256 kink; // Utilization kink point in BPS (e.g., 7000 for 70% utilization)
    }

    /* ───────────────── Distressed Asset / Premium Rewards ────────────────── */
    struct UnderwriterPoolRewards { // Per pool, per underwriter
        uint256 pendingPremiums; // Accrued from poolIncome (underlyingAsset)
        uint256 pendingDistressedAssets; // Accrued from claims (protocolTokenToCover)
    }
    mapping(uint256 => mapping(address => UnderwriterPoolRewards)) public underwriterPoolRewards;

    function _yieldPlatformToRiskIdentifier(YieldPlatform /*platform*/) internal pure returns (ProtocolRiskIdentifier) {
        return ProtocolRiskIdentifier.NONE;
    }

    /* ─────────────────── Pool Data (Protocol Risk Pool) ──────────── */
    enum ProtocolRiskIdentifier { NONE, PROTOCOL_A, PROTOCOL_B, PROTOCOL_C, LIDO_STETH, ROCKET_RETH } // Example

    struct PoolData {
        IERC20 underlyingAsset; // e.g., USDC, used for premiums and claim payouts
        IERC20 protocolTokenToCover; // e.g., stETH, the asset whose risk is being covered
        RateModel rateModel;
        uint256 totalCapitalPledgedToPool; // Sum of principals pledged by various underwriters to this pool
        uint256 totalCoverageSold; // Total active coverage sold for this specific protocol risk
        uint8 underlyingAssetDecimals;
        uint8 protocolTokenDecimals;
        uint256 scaleToProtocolToken; // For converting coverage amount to protocolToken amount if needed
        ProtocolRiskIdentifier protocolCovered; // Identifier for the protocol/risk this pool covers
        bool isPaused;
    }

    PolicyNFT public immutable policyNFT;
    PoolData[] internal protocolRiskPools; // Array of available pools to cover specific protocols

    address public committee;
    modifier onlyCommittee() {
        require(msg.sender == committee, "CP: Not committee");
        _;
    }

    /* ───────────────────────── Events ──────────────────────────── */
    event PoolAdded(uint256 indexed poolId, address indexed underlyingAsset, address indexed protocolToken, ProtocolRiskIdentifier protocolCovered);
    event UnderwriterDeposit(address indexed user, uint256 amountDeposited, uint256 masterSharesMinted, YieldPlatform yieldChoice, uint256[] poolIdsAllocated);
    event WithdrawalRequested(address indexed user, uint256 sharesToBurn, uint256 timestamp);
    event WithdrawalExecuted(address indexed user, uint256 assetsReceived, uint256 sharesBurned, uint256 principalReduced);
    event PremiumPaid(uint256 indexed policyId, uint256 poolId, uint256 amountPaid, uint256 catAmount, uint256 poolIncome);
    event ClaimProcessed(uint256 indexed policyId, uint256 indexed poolId, address indexed claimant, uint256 netPayoutToClaimant, uint256 claimFee, uint256 protocolTokenAmountReceived);
    event UnderwriterLoss(address indexed underwriter, uint256 indexed poolId, uint256 lossAmountPrincipal);
    event CapitalPledgedToPoolChanged(uint256 indexed poolId, int256 amountChangePrincipal); // For principal-based pledges
    event PolicyCreated(address indexed user, uint256 indexed policyId, uint256 indexed poolId, uint256 coverageAmount, uint256 premiumPaid);
    event IncidentReported(uint256 indexed poolId, bool paused);
    event PolicyLapsed(uint256 indexed policyId);
    event CatPremiumBpsUpdated(uint256 newBps);
    event BaseYieldAdapterSet(YieldPlatform indexed platform, address adapterAddress);
    event CommitteeUpdated(address newCommittee);
    event SystemValueSynced(uint256 newTotalSystemValue, uint256 oldTotalSystemValue, uint256 timestamp);
    event AdapterCallFailed(address indexed adapterAddress, string functionCalled, string reason);
    event PremiumRewardsClaimed(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event DistressedAssetRewardsClaimed(address indexed underwriter, uint256 indexed poolId, address indexed token, uint256 amount);


    /* ───────────────────── Constructor ─────────────────────────── */
    constructor(address _policyNFTAddress, address _catPoolAddress) Ownable(msg.sender) {
        require(_policyNFTAddress != address(0), "CP: Invalid PolicyNFT address");
        require(_catPoolAddress != address(0), "CP: Invalid CatPool address");
        policyNFT = PolicyNFT(_policyNFTAddress);
        catPool = CatInsurancePool(_catPoolAddress);
        committee = msg.sender;
    }

    /* ───────────────────── Governance Functions ────────────────── */
    // (setCommittee, setCatPremiumShareBps, setBaseYieldAdapter, addProtocolRiskPool - assumed complete from previous steps)
    function setCommittee(address _newCommittee) external onlyOwner {
        require(_newCommittee != address(0), "CP: Zero address");
        committee = _newCommittee;
        emit CommitteeUpdated(_newCommittee);
    }

    function setCatPremiumShareBps(uint256 _newBps) external onlyOwner {
        require(_newBps <= 5000, "CP: Max share is 50%");
        catPremiumBps = _newBps;
        emit CatPremiumBpsUpdated(_newBps);
    }

    function setBaseYieldAdapter(YieldPlatform _platform, address _adapterAddress) external onlyOwner {
        require(_platform != YieldPlatform.NONE, "CP: Cannot set for NONE platform");
        require(_adapterAddress != address(0), "CP: Zero address for adapter");
        
        uint256 codeSize;
        assembly { codeSize := extcodesize(_adapterAddress) }
        require(codeSize > 0, "CP: Adapter address is not a contract");

        IYieldAdapter adapterInstance = IYieldAdapter(_adapterAddress);
        baseYieldAdapters[_platform] = adapterInstance;

        if (!isAdapterActive[_adapterAddress]) {
            isAdapterActive[_adapterAddress] = true;
            activeYieldAdapterAddresses.push(_adapterAddress);
        }
        emit BaseYieldAdapterSet(_platform, _adapterAddress);
    }

    function addProtocolRiskPool(
        address _underlyingAsset,
        address _protocolTokenToCover,
        RateModel calldata _rateModel,
        ProtocolRiskIdentifier _protocolCovered
    ) external onlyOwner returns (uint256 poolId) {
        require(_underlyingAsset != address(0), "CP: Invalid underlying asset");
        require(_protocolTokenToCover != address(0), "CP: Invalid protocol token");
        require(_protocolCovered != ProtocolRiskIdentifier.NONE, "CP: Protocol identifier cannot be NONE");

        IERC20 underlying = IERC20(_underlyingAsset);
        IERC20 protocolToken = IERC20(_protocolTokenToCover);
        uint8 assetDec = IERC20Metadata(_underlyingAsset).decimals();
        uint8 protoDec = IERC20Metadata(_protocolTokenToCover).decimals();

        protocolRiskPools.push();
        poolId = protocolRiskPools.length - 1;
        PoolData storage newPool = protocolRiskPools[poolId];

        newPool.underlyingAsset = underlying;
        newPool.protocolTokenToCover = protocolToken;
        newPool.rateModel = _rateModel;
        newPool.underlyingAssetDecimals = assetDec;
        newPool.protocolTokenDecimals = protoDec;
        newPool.scaleToProtocolToken = 10**(protoDec >= assetDec ? protoDec - assetDec : 0); // Basic scaling
        newPool.protocolCovered = _protocolCovered;

        emit PoolAdded(poolId, _underlyingAsset, _protocolTokenToCover, _protocolCovered);
        return poolId;
    }

    // (getPoolInfo, getNumberOfPools, getUnderwriterAccountInfo, getPoolUnderwriters - assumed complete)
    /* ───────────────────── View Functions ───────────────────── */

    // In CoverPool.sol, within View Functions section
    function getActiveYieldAdapterAddresses() external view returns (address[] memory) {
        return activeYieldAdapterAddresses;
    }
    function getPoolInfo(uint256 _poolId) external view returns (PoolData memory) {
        require(_poolId < protocolRiskPools.length, "CP: Invalid pool ID");
        return protocolRiskPools[_poolId];
    }

    function getNumberOfPools() external view returns (uint256) { 
        return protocolRiskPools.length; 
    }

    // MODIFIED FUNCTION to return individual fields
    function getUnderwriterAccountDetails(address _underwriter) 
        external 
        view 
        returns (
            uint256 totalDepositedAssetPrincipal,
            YieldPlatform yieldChoice,
            IYieldAdapter yieldAdapter,
            uint256[] memory allocatedPoolIds,
            uint256 masterShares,
            uint256 withdrawalRequestTimestamp,
            uint256 withdrawalRequestShares
        ) 
    {
        UnderwriterAccount storage account = underwriterAccounts[_underwriter];
        return (
            account.totalDepositedAssetPrincipal,
            account.yieldChoice,
            account.yieldAdapter,
            account.allocatedPoolIds, // This returns a copy of the storage array to memory
            account.masterShares,
            account.withdrawalRequestTimestamp,
            account.withdrawalRequestShares
        );
    }

    // NEW FUNCTION to get data from the mapping within UnderwriterAccount
    function getIsUnderwriterAllocatedToPool(address _underwriter, uint256 _poolId) 
        external 
        view 
        returns (bool) 
    {
        return underwriterAccounts[_underwriter].isAllocatedToPool[_poolId];
    }

    function getPoolUnderwriters(uint256 _poolId) external view returns (address[] memory) {
        require(_poolId < protocolRiskPools.length, "CP: Invalid pool ID");
        return poolSpecificUnderwriters[_poolId];
    }


    /* ───────────────────── Internals: Rate Model & Solvency ────────────────── */
    // (_calculatePoolUtilizationBps, _getPremiumRateBpsAnnual, _isPoolSolventForNewCover - assumed complete)
    function _calculatePoolUtilizationBps(PoolData storage _pool) internal view returns (uint256) {
        if (_pool.totalCapitalPledgedToPool == 0) {
            return _pool.totalCoverageSold > 0 ? type(uint256).max : 0;
        }
        return (_pool.totalCoverageSold * BPS * 100) / _pool.totalCapitalPledgedToPool;
    }
    function _getPremiumRateBpsAnnual(PoolData storage _pool) internal view returns (uint256) {
        uint256 utilizationBps = _calculatePoolUtilizationBps(_pool);
        RateModel storage model = _pool.rateModel;
        if (utilizationBps < model.kink) {
            return model.base + (model.slope1 * utilizationBps) / BPS;
        } else {
            return model.base + (model.slope1 * model.kink) / BPS + (model.slope2 * (utilizationBps - model.kink)) / BPS;
        }
    }

    function _isPoolSolventForNewCover(PoolData storage _pool, uint256 _additionalCoverage) internal view returns (bool) {
        return (_pool.totalCoverageSold + _additionalCoverage) <= _pool.totalCapitalPledgedToPool;
    }


    /* ───────────────────── Underwriter Deposit ───────────────────── */
    /**
     * @notice Allows an underwriter to deposit assets and allocate their full deposited capital
     * to underwrite risks for multiple specified protocol risk pools.
     * @dev Simplification: User must withdraw fully before making a new deposit with new allocations or yield choice.
     * @param _amount The total amount of the underlying asset to deposit.
     * @param _yieldChoice The chosen external yield platform for the deposited assets.
     * @param _poolIdsToAllocate Array of pool IDs the underwriter wishes to allocate their capital to.
     * Each selected pool will be backed by the full `_amount`.
     */
    function depositAndAllocate(
        uint256 _amount,
        YieldPlatform _yieldChoice,
        uint256[] calldata _poolIdsToAllocate
    ) external nonReentrant {
        // --- Input Validations ---
        require(_amount > 0, "CP: Deposit amount must be positive");
        require(_poolIdsToAllocate.length > 0 && _poolIdsToAllocate.length <= MAX_ALLOCATIONS_PER_UNDERWRITER, "CP: Invalid number of allocations");
        require(_yieldChoice != YieldPlatform.NONE, "CP: Must choose a valid yield platform");

        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        IYieldAdapter chosenAdapter = baseYieldAdapters[_yieldChoice];
        require(address(chosenAdapter) != address(0), "CP: Base yield adapter not configured for chosen platform");

        require(account.totalDepositedAssetPrincipal == 0, "CP: Withdraw existing deposit before making a new one with new allocations/yield choice.");
        require(account.masterShares == 0, "CP: Inconsistent account state (principal zero but shares exist)");

        // --- Clear any stale allocation data from a previous fully withdrawn state ---
        if (account.allocatedPoolIds.length > 0) { // Should be empty if above requires pass
            for (uint k = 0; k < account.allocatedPoolIds.length; k++) {
                 account.isAllocatedToPool[account.allocatedPoolIds[k]] = false;
            }
            delete account.allocatedPoolIds;
        }

        // --- Share Calculation (NAV-based) ---
        uint256 sharesToMint;
        if (totalMasterSharesSystem == 0) {
            sharesToMint = _amount; // Initial price: 1 share = 1 unit of underlying asset
        } else {
            require(totalSystemValue > 0, "CP: System value is zero with shares outstanding (state error)");
            sharesToMint = (_amount * totalMasterSharesSystem) / totalSystemValue;
        }
        require(sharesToMint > 0, "CP: No shares to mint (amount too small or system error)");

        // --- Update Underwriter Account ---
        account.totalDepositedAssetPrincipal = _amount;
        account.yieldChoice = _yieldChoice;
        account.yieldAdapter = chosenAdapter;
        // `allocatedPoolIds` and `isAllocatedToPool` will be populated in the loop.

        // --- Process Allocations ---
        IERC20 depositToken; 
        bool firstPoolProcessed = false;

        for (uint i = 0; i < _poolIdsToAllocate.length; i++) {
            uint256 poolId = _poolIdsToAllocate[i];
            require(poolId < protocolRiskPools.length, "CP: Invalid pool ID in allocation");
            PoolData storage pool = protocolRiskPools[poolId];
            require(!pool.isPaused, "CP: Cannot allocate to a paused pool");

            if (!firstPoolProcessed) {
                depositToken = pool.underlyingAsset;
                firstPoolProcessed = true;
            } else {
                require(pool.underlyingAsset == depositToken, "CP: All allocations in a single deposit must use the same underlying asset type.");
            }

            require(
                pool.protocolCovered != _yieldPlatformToRiskIdentifier(_yieldChoice),
                "CP: Cannot underwrite own yield source risk"
            );

            // Add to account's list of allocations for this session
            account.allocatedPoolIds.push(poolId);
            account.isAllocatedToPool[poolId] = true;

            // Add to the pool's specific list of underwriters and store index
            poolSpecificUnderwriters[poolId].push(msg.sender);
            underwriterIndexInPoolArray[poolId][msg.sender] = poolSpecificUnderwriters[poolId].length - 1;
            
            // The underwriter's *entire deposited principal* backs this pool
            pool.totalCapitalPledgedToPool += _amount; 
            emit CapitalPledgedToPoolChanged(poolId, int256(_amount));
        }
        require(firstPoolProcessed, "CP: No valid pools to allocate to.");

        // --- Asset Transfers ---
        depositToken.safeTransferFrom(msg.sender, address(this), _amount);
        depositToken.approve(address(chosenAdapter), _amount); 
        chosenAdapter.deposit(_amount); 

        // --- Update System and Account Shares/Values ---
        account.masterShares = sharesToMint; // For a new deposit session, shares are reset
        totalMasterSharesSystem += sharesToMint;
        totalSystemValue += _amount; // System NAV increases by the deposited amount

        emit UnderwriterDeposit(msg.sender, _amount, sharesToMint, _yieldChoice, _poolIdsToAllocate);
    }

    /* ───────────────────── Underwriter Withdraw Flow ───────────────────────── */

    /**
     * @dev Internal helper to check if an underwriter's withdrawal would render any of their allocated pools insolvent.
     * @return principalComponentToBeRemoved The amount of principal this withdrawal corresponds to.
     */
    function _checkSolvencyImpactOfWithdrawal(
        UnderwriterAccount storage _account,
        uint256 _sharesToBurn
    ) internal view returns (uint256 principalComponentToBeRemoved) {
        require(_account.masterShares > 0, "CP: Account has no shares to determine principal component");
        if (_sharesToBurn == _account.masterShares) { // Withdrawing all shares
            principalComponentToBeRemoved = _account.totalDepositedAssetPrincipal;
        } else {
            // Pro-rata principal component based on shares being burned.
            principalComponentToBeRemoved = (_account.totalDepositedAssetPrincipal * _sharesToBurn) / _account.masterShares;
        }

        // This check ensures that the calculated reduction isn't more than the principal they have.
        // It could happen if masterShares somehow represent more value than principal due to massive yield
        // and the pro-rata calculation based on principal alone is skewed.
        // However, if sharesToBurn <= account.masterShares, this should mathematically hold if principal is >= 0.
        require(principalComponentToBeRemoved <= _account.totalDepositedAssetPrincipal, "CP: Calculated principal reduction exceeds available principal");

        for (uint i = 0; i < _account.allocatedPoolIds.length; i++) {
            uint256 poolId = _account.allocatedPoolIds[i];
            if (poolId < protocolRiskPools.length) { 
                PoolData storage pool = protocolRiskPools[poolId];
                
                uint256 newTotalCapitalPledgedToThisPool;
                if (pool.totalCapitalPledgedToPool >= principalComponentToBeRemoved) {
                    newTotalCapitalPledgedToThisPool = pool.totalCapitalPledgedToPool - principalComponentToBeRemoved;
                } else {
                    newTotalCapitalPledgedToThisPool = 0;
                }

                require(
                    pool.totalCoverageSold <= newTotalCapitalPledgedToThisPool,
                    "CP: Withdrawal would make an allocated pool insolvent"
                );
            }
        }
        return principalComponentToBeRemoved;
    }

    /**
     * @dev Internal helper to update the totalCapitalPledgedToPool for all pools an underwriter was allocated to
     * when their principal contribution changes (due to withdrawal or claim loss).
     * Also handles removing the underwriter from tracking lists on full removal/wipeout.
     */
    function _updatePledgedCapitalForAllAllocations(
        address _underwriter,
        uint256 _principalAmountReducedOrRemoved, // The actual amount by which underwriter's principal is reduced
        bool _isFullRemovalThisSession // True if underwriter is fully exiting all their positions OR wiped out
    ) internal {
        UnderwriterAccount storage account = underwriterAccounts[_underwriter];
        
        for (uint i = 0; i < account.allocatedPoolIds.length; i++) {
            uint256 poolId = account.allocatedPoolIds[i];
            if (poolId < protocolRiskPools.length && account.isAllocatedToPool[poolId]) { 
                PoolData storage pool = protocolRiskPools[poolId];
                
                // The underwriter's pledge to this pool effectively decreases by the amount their overall principal was reduced.
                if (pool.totalCapitalPledgedToPool >= _principalAmountReducedOrRemoved) {
                    pool.totalCapitalPledgedToPool -= _principalAmountReducedOrRemoved;
                } else {
                    pool.totalCapitalPledgedToPool = 0;
                }
                emit CapitalPledgedToPoolChanged(poolId, -int256(_principalAmountReducedOrRemoved));

                // If it's a full removal session (all shares withdrawn or principal wiped out),
                // and they were marked as allocated to this pool, remove them from this pool's specific tracking.
                if (_isFullRemovalThisSession) {
                    account.isAllocatedToPool[poolId] = false; 
                    
                    address[] storage underwritersInPool = poolSpecificUnderwriters[poolId];
                    uint256 storedIndex = underwriterIndexInPoolArray[poolId][_underwriter];

                    // Check if the underwriter is indeed in the array and index is valid before removal
                    if (storedIndex < underwritersInPool.length && underwritersInPool[storedIndex] == _underwriter) {
                        address lastUnderwriter = underwritersInPool[underwritersInPool.length - 1];
                        if (_underwriter != lastUnderwriter) { // Avoid self-assignment if it's the last element
                            underwritersInPool[storedIndex] = lastUnderwriter;
                            underwriterIndexInPoolArray[poolId][lastUnderwriter] = storedIndex;
                        }
                        underwritersInPool.pop();
                        delete underwriterIndexInPoolArray[poolId][_underwriter];
                    }
                }
            }
        }

        if (_isFullRemovalThisSession) {
            delete account.allocatedPoolIds; // Clears the array for the underwriter
        }
    }

    function requestWithdrawal(uint256 _sharesToBurn) external nonReentrant {
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        require(_sharesToBurn > 0, "CP: Shares to burn must be positive");
        require(_sharesToBurn <= account.masterShares, "CP: Requested shares exceed balance");
        require(account.withdrawalRequestShares == 0, "CP: Withdrawal already pending");
        // Ensure there's value to withdraw; shares might exist with 0 value if system value is 0.
        require(totalSystemValue > 0 || (totalSystemValue == 0 && _sharesToBurn == account.masterShares), "CP: No system value to withdraw from, or not withdrawing all shares from zero value system");


        account.withdrawalRequestShares = _sharesToBurn;
        account.withdrawalRequestTimestamp = block.timestamp;
        emit WithdrawalRequested(msg.sender, _sharesToBurn, block.timestamp);
    }

    function executeWithdrawal() external nonReentrant {
        UnderwriterAccount storage account = underwriterAccounts[msg.sender];
        uint256 sharesToBurn = account.withdrawalRequestShares;

        // --- Initial Validations ---
        require(sharesToBurn > 0, "CP: No withdrawal request found for user");
        require(block.timestamp >= account.withdrawalRequestTimestamp + UNDERWRITER_NOTICE_PERIOD, "CP: Notice period not yet over");
        require(totalMasterSharesSystem > 0, "CP: No shares in system to withdraw against"); 
        require(sharesToBurn <= account.masterShares, "CP: Stale request, share balance changed or invalid request");

        // --- Perform Solvency Checks based on the principal component being removed ---
        uint256 principalComponentToBeRemoved = _checkSolvencyImpactOfWithdrawal(account, sharesToBurn);
        // If _checkSolvencyImpactOfWithdrawal reverts, execution stops here.

        // --- Calculate NAV-based amount to receive for the shares ---
        uint256 amountToReceiveBasedOnNAV = 0;
        if (totalSystemValue > 0) { // Avoid division by zero if system value somehow hit 0 with shares outstanding
             amountToReceiveBasedOnNAV = (sharesToBurn * totalSystemValue) / totalMasterSharesSystem;
        }
        // If totalSystemValue is 0, amountToReceiveBasedOnNAV remains 0. Shares are worthless.

        // --- Withdraw assets from the yield adapter ---
        uint256 assetsActuallyWithdrawnFromAdapter = 0;
        if (amountToReceiveBasedOnNAV > 0 && address(account.yieldAdapter) != address(0)) {
            assetsActuallyWithdrawnFromAdapter = account.yieldAdapter.withdraw(amountToReceiveBasedOnNAV, address(this));
            // If assetsActuallyWithdrawnFromAdapter < amountToReceiveBasedOnNAV, the user gets less.
            // This discrepancy is a form of realized slippage/loss from the adapter or NAV inaccuracy.
        }
        
        // --- Determine if this is a full withdrawal of all the underwriter's shares ---
        bool isFullWithdrawal = (sharesToBurn == account.masterShares);

        // --- Update the underwriter's principal record ---
        // The principal is reduced by `principalComponentToBeRemoved`, which was calculated based on shares and original principal.
        if (account.totalDepositedAssetPrincipal >= principalComponentToBeRemoved) {
            account.totalDepositedAssetPrincipal -= principalComponentToBeRemoved;
        } else {
            // This should ideally not be reached if principalComponentToBeRemoved was correctly capped
            // in _checkSolvencyImpactOfWithdrawal. Setting to 0 for safety.
            account.totalDepositedAssetPrincipal = 0;
        }
        
        // --- Update pledged capital in all allocated pools & clean up lists if full withdrawal ---
        // This uses the `principalComponentToBeRemoved` as the basis for reducing pledges.
        _updatePledgedCapitalForAllAllocations(msg.sender, principalComponentToBeRemoved, isFullWithdrawal);

        // --- Update system-wide and user's share balances ---
        account.masterShares -= sharesToBurn;
        totalMasterSharesSystem -= sharesToBurn;
        
        // totalSystemValue is reduced by the amount that *actually* left the yield system and was given to user.
        if (totalSystemValue >= assetsActuallyWithdrawnFromAdapter) {
            totalSystemValue -= assetsActuallyWithdrawnFromAdapter;
        } else {
            totalSystemValue = 0; 
        }

        // If all shares in the system are gone, system value should also be zero.
        if (totalMasterSharesSystem == 0) {
            totalSystemValue = 0;
        }


        // --- Clear withdrawal request ---
        account.withdrawalRequestShares = 0;
        account.withdrawalRequestTimestamp = 0;

        // --- Transfer assets to user ---
        if (assetsActuallyWithdrawnFromAdapter > 0) {
            IERC20 underlyingAssetToTransfer; 
            // Attempt to get the asset type from the account's yield adapter first
            if (address(account.yieldAdapter) != address(0)) {
                try account.yieldAdapter.asset() returns (IERC20 adapterAsset) {
                    if (address(adapterAsset) != address(0)) {
                        underlyingAssetToTransfer = adapterAsset;
                    }
                } catch { /* Fallback below */ }
            }
            // Fallback if adapter.asset() failed or no adapter (should not happen for active account)
            if (address(underlyingAssetToTransfer) == address(0) && protocolRiskPools.length > 0) { 
                underlyingAssetToTransfer = protocolRiskPools[0].underlyingAsset;
            }
            // Final check
            require(address(underlyingAssetToTransfer) != address(0), "CP: Cannot determine underlying asset type for withdrawal transfer");
            
            underlyingAssetToTransfer.safeTransfer(msg.sender, assetsActuallyWithdrawnFromAdapter);
        }

        emit WithdrawalExecuted(msg.sender, assetsActuallyWithdrawnFromAdapter, sharesToBurn, principalComponentToBeRemoved);
    }



    
    /**
     * @dev Internal helper to finalize claim payout, handle distressed assets, burn NFT, and emit event.
     */
/**
     * @dev Internal helper to finalize claim payout, handle distressed assets, burn NFT, and emit event.
     * It now re-fetches pool and specificUnderwriters data using _poolId.
     */
/**
     * @dev Internal helper to finalize claim payout, handle distressed assets, burn NFT, and emit event.
     * It now re-fetches pool, specificUnderwriters, and actualPolicyOwner data using _poolId and _policyId.
    /**
     * @dev Internal helper to finalize claim payout, handle distressed assets, burn NFT, and emit event.
     * It re-fetches pool, specificUnderwriters, and actualPolicyOwner data.
     * @param _policyId The ID of the policy being claimed.
     * @param _poolId The ID of the pool for the policy.
     * @param _netPayoutToClaimant Net amount of underlying asset to pay the claimant.
     * @param _claimFee The fee deducted from the gross payout.
     * @param _totalLossBorneByLPs Total principal loss absorbed by LPs for this claim.
     * @param _lpActualLossSharesPrincipal Memory array of principal losses for each LP.
     * @param _shortfallCoveredByCatPool Amount covered by the CatPool.
     * @param _policyCoverageValue The original coverage amount of the policy.
     * @param _grossProtocolTokenAmountReceived The gross amount of protocol tokens the claimant provides.
     */
    function _finalizeClaimPayoutAndUpdates(
        uint256 _policyId,
        uint256 _poolId,
        uint256 _netPayoutToClaimant,
        uint256 _claimFee, 
        uint256 _totalLossBorneByLPs, 
        uint256[] memory _lpActualLossSharesPrincipal, 
        uint256 _shortfallCoveredByCatPool,
        // address _actualPolicyOwner, // REMOVED - re-fetched inside
        uint256 _policyCoverageValue,
        uint256 _grossProtocolTokenAmountReceived // ADDED/EXPECTED 9th argument
    ) internal {
        PoolData storage pool = protocolRiskPools[_poolId]; 
        address[] storage specificUnderwriters = poolSpecificUnderwriters[_poolId]; 
        address actualPolicyOwner = policyNFT.ownerOf(_policyId); // RE-FETCHES owner

        // --- Payout to Claimant ---
        require(
            pool.underlyingAsset.balanceOf(address(this)) >= _netPayoutToClaimant,
            "CP: Insufficient liquid funds for payout"
        );
        pool.underlyingAsset.safeTransfer(actualPolicyOwner, _netPayoutToClaimant);

        // --- Receive Distressed Protocol Token from Claimant ---
        // _grossProtocolTokenAmountReceived is now passed as an argument.
        pool.protocolTokenToCover.safeTransferFrom(actualPolicyOwner, address(this), _grossProtocolTokenAmountReceived);

        // --- Accrue Distressed Assets ---
        uint256 distressedForLPsAfterCatShare = _grossProtocolTokenAmountReceived; 
        if (_grossProtocolTokenAmountReceived > 0) {
            if (_shortfallCoveredByCatPool > 0 && _netPayoutToClaimant > 0) {
                uint256 catPoolShareOfDistressed = (_grossProtocolTokenAmountReceived * _shortfallCoveredByCatPool) / _netPayoutToClaimant;
                if (catPoolShareOfDistressed > 0) {
                    pool.protocolTokenToCover.approve(address(catPool), catPoolShareOfDistressed);
                    catPool.receiveProtocolAssetsForDistribution(pool.protocolTokenToCover, catPoolShareOfDistressed);
                }
                if (distressedForLPsAfterCatShare >= catPoolShareOfDistressed) {
                    distressedForLPsAfterCatShare -= catPoolShareOfDistressed;
                } else {
                    distressedForLPsAfterCatShare = 0;
                }
            }

            if (distressedForLPsAfterCatShare > 0 && _totalLossBorneByLPs > 0) {
                _accrueDistressedAssetsToLPs(
                    _poolId,
                    distressedForLPsAfterCatShare,
                    _totalLossBorneByLPs,
                    specificUnderwriters, 
                    _lpActualLossSharesPrincipal
                );
            }
        }

        // --- Update Policy & Pool State ---
        if (pool.totalCoverageSold >= _policyCoverageValue) {
            pool.totalCoverageSold -= _policyCoverageValue;
        } else {
            pool.totalCoverageSold = 0;
        }
        
        policyNFT.burn(_policyId); 

        emit ClaimProcessed(
            _policyId, _poolId, actualPolicyOwner, _netPayoutToClaimant, _claimFee, _grossProtocolTokenAmountReceived
        );
    }

    /**
     * @dev Internal helper to accrue poolIncome to the underwriters of a specific pool.
     * @param _poolIdToAccrue The ID of the pool for which income is being accrued.
     * @param _currentPoolIncome The amount of income (after CatPool cut) to distribute/accrue.
     * @param _poolRef A storage reference to the PoolData struct.
     */
    function _accruePoolIncomeToUnderwriters(
        uint256 _poolIdToAccrue,
        uint256 _currentPoolIncome,
        PoolData storage _poolRef // Pass the PoolData storage reference
    ) internal {
        // No need to re-check _currentPoolIncome > 0 or _poolRef.totalCapitalPledgedToPool > 0 here,
        // as the calling functions (purchaseCover, settlePremium) already do this.

        address[] storage specificUnderwriters = poolSpecificUnderwriters[_poolIdToAccrue];
        uint256 numSpecificUnderwriters = specificUnderwriters.length;
        
        if (numSpecificUnderwriters == 0) {
            // If no underwriters, poolIncome effectively remains in the contract's balance.
            // A treasury mechanism could later sweep such funds.
            return;
        }

        uint256 totalDistributedIncomeThisRound = 0;
        for (uint i = 0; i < numSpecificUnderwriters; i++) {
            address underwriterAddress = specificUnderwriters[i];
            UnderwriterAccount storage underwriterAcc = underwriterAccounts[underwriterAddress];

            if (underwriterAcc.isAllocatedToPool[_poolIdToAccrue] && underwriterAcc.totalDepositedAssetPrincipal > 0) {
                uint256 underwriterReward;
                // Pro-rata share based on their principal contribution to the pool's total pledged capital.
                // It's crucial that _poolRef.totalCapitalPledgedToPool is > 0, which is checked by callers.
                if (i == numSpecificUnderwriters - 1) { 
                    // Last underwriter gets the remainder to handle any potential dust from division.
                    underwriterReward = _currentPoolIncome - totalDistributedIncomeThisRound;
                } else {
                    underwriterReward = (_currentPoolIncome * underwriterAcc.totalDepositedAssetPrincipal) / _poolRef.totalCapitalPledgedToPool;
                }
                
                if (underwriterReward > 0) { // Avoid SLOAD/SSTORE for zero reward
                    underwriterPoolRewards[_poolIdToAccrue][underwriterAddress].pendingPremiums += underwriterReward;
                    totalDistributedIncomeThisRound += underwriterReward;
                }
            }
        }
        // Note: If totalDistributedIncomeThisRound < _currentPoolIncome due to some LPs having 0 principal,
        // the remaining dust from _currentPoolIncome stays in the contract's balance.
    }

    /* ───────────────────── Policy Purchase & Premiums ───────────────────── */
    function purchaseCover(uint256 _poolId, uint256 _coverageAmount)
        external
        nonReentrant
        returns (uint256 policyId)
    {
        require(_poolId < protocolRiskPools.length, "CP: Invalid pool ID");
        PoolData storage pool = protocolRiskPools[_poolId]; // Get storage pointer once
        require(!pool.isPaused, "CP: Pool is paused, cannot purchase cover");
        require(_coverageAmount > 0, "CP: Coverage amount must be positive");
        require(
            _isPoolSolventForNewCover(pool, _coverageAmount),
            "CP: Insufficient capacity in selected pool for this coverage amount"
        );

        uint256 annualPremiumRateBps = _getPremiumRateBpsAnnual(pool);
        uint256 weeklyPremium = (_coverageAmount * annualPremiumRateBps * 7 days) / (SECS_YEAR * BPS);
        require(weeklyPremium > 0, "CP: Calculated weekly premium is zero (check rate model or coverage amount)");

        uint256 catAmount = (weeklyPremium * catPremiumBps) / BPS;
        uint256 poolIncome = weeklyPremium - catAmount;

        pool.underlyingAsset.safeTransferFrom(msg.sender, address(this), weeklyPremium);

        if (catAmount > 0) {
            pool.underlyingAsset.approve(address(catPool), catAmount); 
            catPool.receiveUsdcPremium(catAmount);
        }

        // Call the internal helper function for accruing poolIncome
        if (poolIncome > 0 && pool.totalCapitalPledgedToPool > 0) {
            _accruePoolIncomeToUnderwriters(
                _poolId,
                poolIncome,
                pool // Pass the storage pointer
            );
        }
        // The physical `poolIncome` assets are now held by this CoverPool contract.
        // `pendingPremiums` in `underwriterPoolRewards` is the accounting for future claims by LPs.

        uint256 activationTimestamp = block.timestamp + COVER_COOLDOWN_PERIOD;
        uint256 paidUntilTimestamp = activationTimestamp + 7 days; 

        policyId = policyNFT.mint(msg.sender, _poolId, _coverageAmount, activationTimestamp, paidUntilTimestamp);
        pool.totalCoverageSold += _coverageAmount;

        emit PolicyCreated(msg.sender, policyId, _poolId, _coverageAmount, weeklyPremium);
        emit PremiumPaid(policyId, _poolId, weeklyPremium, catAmount, poolIncome); 

        return policyId;
    }
    /* ───────────────────── Policy Lifecycle Management ───────────────────── */

    /**
     * @notice Calculates the amount of premium currently owed for a given policy.
     * @param _policyId The ID of the policy.
     * @return owed The amount of premium due in the pool's underlying asset. Returns 0 if policy is paid up.
     */
    function premiumOwed(uint256 _policyId) public view returns (uint256 owed) {
        PolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId); // Assumes getPolicy is a view function in PolicyNFT
        
        // If policy doesn't exist (coverage is 0 indicated by PolicyNFT) or isn't active yet, no premium is owed.
        if (pol.coverage == 0 || block.timestamp < pol.activation) {
            return 0;
        }
        
        // Ensure poolId from policy is valid
        require(pol.poolId < protocolRiskPools.length, "CP: Invalid poolId in policy for premiumOwed");
        PoolData storage pool = protocolRiskPools[pol.poolId];

        if (block.timestamp <= pol.lastPaidUntil) {
            // Policy is paid up to date or even into the future
            return 0;
        }

        // Calculate time elapsed since the policy was last paid for
        uint256 elapsedSinceLastPaid = block.timestamp - pol.lastPaidUntil;
        uint256 annualPremiumRateBps = _getPremiumRateBpsAnnual(pool); // Get current annual rate for the pool

        // Owed premium = (coverage * annualRateBps * timeElapsed) / (SECONDS_IN_YEAR * BPS_DENOMINATOR)
        owed = (pol.coverage * annualPremiumRateBps * elapsedSinceLastPaid) / (SECS_YEAR * BPS);
        
        return owed;
    }

    /**
     * @notice Settles outstanding premiums for an active policy.
     * Premiums are paid by the policy owner. If payment fails (e.g., insufficient allowance or balance),
     * the policy lapses. Can be called by anyone to facilitate premium payment.
     * @param _policyId The ID of the policy to settle premiums for.
     */

    /* ───────────────────── Policy Lifecycle Management ───────────────────── */
    // premiumOwed and _lapse functions remain the same as last provided

    function settlePremium(uint256 _policyId) public nonReentrant {
        PolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        
        require(pol.coverage > 0, "CP: Policy invalid or already lapsed/burned");
        require(block.timestamp >= pol.activation, "CP: Policy not yet active, cannot settle premium");
        
        uint256 poolId = pol.poolId; 
        require(poolId < protocolRiskPools.length, "CP: Invalid poolId in policy for settlePremium");
        PoolData storage pool = protocolRiskPools[poolId]; // Get storage pointer once
        require(!pool.isPaused, "CP: Pool is paused, cannot settle premium");

        uint256 dueAmount = premiumOwed(_policyId);

        if (dueAmount == 0) {
            if (block.timestamp > pol.lastPaidUntil) {
                 policyNFT.updateLastPaid(_policyId, block.timestamp);
            }
            return; 
        }

        address policyOwner = policyNFT.ownerOf(_policyId); 
        IERC20 underlying = pool.underlyingAsset;
        uint256 ownerAllowance = underlying.allowance(policyOwner, address(this));

        if (ownerAllowance < dueAmount) {
            _lapse(_policyId, pol, pool);
        } else {
            underlying.safeTransferFrom(policyOwner, address(this), dueAmount);

            uint256 catAmount = (dueAmount * catPremiumBps) / BPS;
            uint256 poolIncome = dueAmount - catAmount;

            if (catAmount > 0) {
                underlying.approve(address(catPool), catAmount);
                catPool.receiveUsdcPremium(catAmount);
            }

            // Call the internal helper function for accruing poolIncome
            if (poolIncome > 0 && pool.totalCapitalPledgedToPool > 0) {
                 _accruePoolIncomeToUnderwriters(
                    poolId,
                    poolIncome,
                    pool // Pass the storage pointer
                );
            }
            
            policyNFT.updateLastPaid(_policyId, block.timestamp);
            emit PremiumPaid(_policyId, poolId, dueAmount, catAmount, poolIncome);
        }
    }

    /**
     * @dev Internal function to handle policy lapsing.
     * Burns the PolicyNFT and reduces the pool's total coverage.
     * @param _policyId The ID of the policy to lapse.
     * @param _pol The policy struct data (passed to avoid re-reading if already available).
     * @param _pool The storage pointer to the pool data.
     */
    function _lapse(uint256 _policyId, PolicyNFT.Policy memory _pol, PoolData storage _pool) internal {
        // Ensure there's coverage to reduce (double check against pol.coverage from caller)
        if (_pool.totalCoverageSold >= _pol.coverage) {
            _pool.totalCoverageSold -= _pol.coverage;
        } else {
            // This should not happen if accounting is correct, means totalCoverageSold was already
            // less than this specific policy's coverage. Set to 0 for safety.
            _pool.totalCoverageSold = 0;
        }
        
        // No change to _pool.totalCapitalPledgedToPool as no capital is returned or lost from LPs here.
        
        // This contract must have permission (e.g., be an approved operator or owner)
        // or PolicyNFT.burn must be callable by anyone if the policy meets certain conditions.
        // For now, assume this contract has the authority to burn policies it manages.
        policyNFT.burn(_policyId); 
        
        emit PolicyLapsed(_policyId);
    }

   /**
     * @dev Internal helper to apply losses to LPs for a claim and trigger cascading updates.
     * @param _poolIdWhereClaimOccurred The ID of the pool where the claim happened.
     * @param _netPayoutToDistribute The net amount that needs to be covered by LPs.
     * @param _initialPledgeForClaimPool The pool.totalCapitalPledgedToPool *before* any LP principals are reduced for this claim.
     * @param _underwritersForPool Storage reference to the array of underwriters for this pool.
     * @param _lpLossSharesOutput Memory array to store the actual principal loss for each LP (for distressed asset distribution).
     * @return totalLossAppliedToLPs The sum of principal actually deducted from LPs.
     */
    /* ───────────────────── Helper: Apply LP Losses & Cascade ───────────────────── */
    /**
     * @dev Internal helper to apply losses to LPs for a claim and trigger cascading updates.
     * This function now fetches initialPoolCapitalPledged internally.
     */
    function _applyAndCascadeLPLosses(
        uint256 _poolIdWhereClaimOccurred,
        PoolData storage _poolRef, // Pass PoolData storage reference
        uint256 _netPayoutToDistribute,
        address[] storage _underwritersForPool,
        uint256[] memory _lpLossSharesOutput 
    ) internal returns (uint256 totalLossAppliedToLPs) {
        uint256 numLPs = _underwritersForPool.length;
        totalLossAppliedToLPs = 0;
        uint256 initialPledgeForClaimPool = _poolRef.totalCapitalPledgedToPool; // Fetch here

        if (numLPs == 0 || initialPledgeForClaimPool == 0) {
            return 0;
        }

        for (uint i = 0; i < numLPs; i++) {
            address underwriterAddress = _underwritersForPool[i];
            UnderwriterAccount storage lpAccount = underwriterAccounts[underwriterAddress];

            if (lpAccount.isAllocatedToPool[_poolIdWhereClaimOccurred] && lpAccount.totalDepositedAssetPrincipal > 0) {
                uint256 lpProportionateLoss = (_netPayoutToDistribute * lpAccount.totalDepositedAssetPrincipal) / initialPledgeForClaimPool;
                uint256 actualLossForThisLPPrincipal = Math.min(lpProportionateLoss, lpAccount.totalDepositedAssetPrincipal);
                
                if (actualLossForThisLPPrincipal > 0) {
                    lpAccount.totalDepositedAssetPrincipal -= actualLossForThisLPPrincipal;
                    totalLossAppliedToLPs += actualLossForThisLPPrincipal;
                    if (i < _lpLossSharesOutput.length) { 
                       _lpLossSharesOutput[i] = actualLossForThisLPPrincipal; 
                    }

                    emit UnderwriterLoss(underwriterAddress, _poolIdWhereClaimOccurred, actualLossForThisLPPrincipal);

                    bool wipedOut = (lpAccount.totalDepositedAssetPrincipal == 0);
                    if (wipedOut && lpAccount.masterShares > 0) {
                        if (totalMasterSharesSystem >= lpAccount.masterShares) {
                            totalMasterSharesSystem -= lpAccount.masterShares;
                        } else {
                            totalMasterSharesSystem = 0; 
                        }
                        lpAccount.masterShares = 0;
                    }
                    _updatePledgedCapitalOnLoss(underwriterAddress, _poolIdWhereClaimOccurred, actualLossForThisLPPrincipal, wipedOut);
                }
            }
        }
        return totalLossAppliedToLPs;
    }


    /**
     * @dev Internal helper to handle CatPool interaction and update system NAV.
     */
    function _handleCatPoolAndUpdateSystemValue(
        PoolData storage _pool, // Not strictly needed if we pass poolId for event
        uint256 _poolIdForEvents, // For emitting CapitalPledgedToPoolChanged
        uint256 _totalLossBorneByLPs,
        uint256 _netPayoutToClaimant
        // Removed _policyCoverageValue as it's not used here to calculate protocolTokenAmountForClaimantOut anymore
    ) internal returns (uint256 shortfallCoveredByCatPoolOut) {
        
        // Update this specific loss pool's totalCapitalPledgedToPool based on direct LP losses for this claim.
        // This needs to be done once for the aggregate loss on this pool.
        if (_pool.totalCapitalPledgedToPool >= _totalLossBorneByLPs) {
            _pool.totalCapitalPledgedToPool -= _totalLossBorneByLPs;
        } else {
            _pool.totalCapitalPledgedToPool = 0;
        }
        emit CapitalPledgedToPoolChanged(_poolIdForEvents, -int256(_totalLossBorneByLPs));

        // CatInsurancePool Contribution
        shortfallCoveredByCatPoolOut = 0;
        if (_totalLossBorneByLPs < _netPayoutToClaimant) {
            uint256 shortfall = _netPayoutToClaimant - _totalLossBorneByLPs;
            catPool.drawFund(shortfall); 
            shortfallCoveredByCatPoolOut = shortfall; 
        }

        // Update totalSystemValue (NAV)
        if (totalSystemValue >= _totalLossBorneByLPs) { 
            totalSystemValue -= _totalLossBorneByLPs;
        } else {
            totalSystemValue = 0;
        }
        return shortfallCoveredByCatPoolOut;
    }

/**
     * @dev Internal helper to accrue distressed assets to LPs who bore a loss.
     * @param _poolId The ID of the pool for which distressed assets are being accrued.
     * @param _distressedAssetsAvailableForLPs The total amount of distressed asset token to distribute among LPs.
     * @param _totalPrincipalLossBorneByLPs The sum of principal lost by all LPs in this claim, used as the denominator for pro-rata.
     * @param _underwritersInPool Storage reference to the array of all underwriter addresses for this pool.
     * @param _lpPrincipalLossShares Memory array holding the actual principal loss amount for each corresponding underwriter in _underwritersInPool.
     */

    /* ───────────────────── Helper: Accrue Distressed Assets ───────────────────── */

    /**
     * @dev Internal helper to update the loss pool's capital based on LP losses for this claim,
     * interact with CatPool if needed, and update the system's total value (NAV).
     * @param _pool Storage reference to the PoolData of the claim pool.
     * @param _poolIdForEvents The ID of the pool, used for emitting events.
     * @param _totalLossBorneByLPs Total principal loss absorbed by LPs for this specific claim.
     * @param _netPayoutToClaimant Net amount that was intended to be paid to the claimant.
     * @return shortfallCoveredByCatPoolOut Amount that was (or needed to be) covered by the CatPool.
     */
    function _handlePoolUpdatesAndCatPoolInteraction(
        PoolData storage _pool, // Storage pointer to the specific pool being claimed against
        uint256 _poolIdForEvents, // For emitting CapitalPledgedToPoolChanged event
        uint256 _totalLossBorneByLPs,
        uint256 _netPayoutToClaimant
    ) internal returns (uint256 shortfallCoveredByCatPoolOut) {
        
        // Update this specific loss pool's totalCapitalPledgedToPool
        if (_pool.totalCapitalPledgedToPool >= _totalLossBorneByLPs) {
            _pool.totalCapitalPledgedToPool -= _totalLossBorneByLPs;
        } else {
            _pool.totalCapitalPledgedToPool = 0;
        }
        emit CapitalPledgedToPoolChanged(_poolIdForEvents, -int256(_totalLossBorneByLPs));

        // CatInsurancePool Contribution (If Needed)
        shortfallCoveredByCatPoolOut = 0;
        if (_totalLossBorneByLPs < _netPayoutToClaimant) {
            uint256 shortfall = _netPayoutToClaimant - _totalLossBorneByLPs;
            catPool.drawFund(shortfall); 
            shortfallCoveredByCatPoolOut = shortfall; 
        }

        // Update totalSystemValue (NAV) by the loss absorbed by LPs' principals.
        if (totalSystemValue >= _totalLossBorneByLPs) { 
            totalSystemValue -= _totalLossBorneByLPs;
        } else {
            totalSystemValue = 0;
        }
        
        return shortfallCoveredByCatPoolOut;
    }

    function _accrueDistressedAssetsToLPs(
        uint256 _poolId,
        uint256 _distressedAssetsAvailableForLPs,
        uint256 _totalPrincipalLossBorneByLPs,
        address[] storage _underwritersInPool, 
        uint256[] memory _lpPrincipalLossShares 
    ) internal {
        if (_distressedAssetsAvailableForLPs == 0 || _totalPrincipalLossBorneByLPs == 0) {
            return; 
        }

        uint256 numLPsInPoolList = _underwritersInPool.length;
        if (numLPsInPoolList == 0 || _lpPrincipalLossShares.length != numLPsInPoolList) {
            return;
        }
        
        uint256 runningTotalDistributedAssets = 0;
        uint256 eligibleLPsProcessed = 0; 

        uint256 numLPsEligibleForDistressed = 0;
        for (uint k = 0; k < numLPsInPoolList; k++) {
            if (_lpPrincipalLossShares[k] > 0) {
                numLPsEligibleForDistressed++;
            }
        }

        if (numLPsEligibleForDistressed == 0) {
            return;
        }

        for (uint i = 0; i < numLPsInPoolList; i++) {
            if (_lpPrincipalLossShares[i] > 0) { 
                address underwriterAddress = _underwritersInPool[i];
                eligibleLPsProcessed++;
                uint256 distressedAssetShare;

                if (eligibleLPsProcessed == numLPsEligibleForDistressed) {
                    distressedAssetShare = _distressedAssetsAvailableForLPs - runningTotalDistributedAssets;
                } else {
                    distressedAssetShare = (_distressedAssetsAvailableForLPs * _lpPrincipalLossShares[i]) / _totalPrincipalLossBorneByLPs;
                }
                
                if (distressedAssetShare > 0) {
                    underwriterPoolRewards[_poolId][underwriterAddress].pendingDistressedAssets += distressedAssetShare;
                    runningTotalDistributedAssets += distressedAssetShare;
                }
            }
            if (runningTotalDistributedAssets >= _distressedAssetsAvailableForLPs && _distressedAssetsAvailableForLPs > 0) break; 
        }
    }
    /* ───────────────────── Claim Processing ───────────────────── */

    /* ───────────────────── Claim Processing ───────────────────── */
    function processClaim(uint256 _policyId, bytes calldata /*_proofOfLossDataArg*/ ) external nonReentrant {

        // --- 1. Initial Validations & Basic Calculations ---
        PolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId); 
        require(pol.coverage > 0, "CP: Policy does not exist or has zero coverage");
        require(block.timestamp >= pol.activation, "CP: Policy is not yet active");
        
        require(premiumOwed(_policyId) == 0, "CP: Premiums outstanding, policy may have lapsed or needs settlement");

        address currentPolicyOwner = policyNFT.ownerOf(_policyId); 
        require(msg.sender == currentPolicyOwner, "CP: Caller is not the policy owner");

        uint256 poolId = pol.poolId; 
        require(poolId < protocolRiskPools.length, "CP: Invalid poolId in policy");
        PoolData storage pool = protocolRiskPools[poolId]; // Storage pointer to the specific pool
        require(!pool.isPaused, "CP: Pool is paused, claims cannot be processed");

        uint256 policyCoverageValue = pol.coverage; // Store for repeated use to potentially save SLOADs from memory struct
        uint256 claimFee = (policyCoverageValue * CLAIM_FEE_BPS) / BPS; 
        uint256 netPayoutToClaimant = policyCoverageValue - claimFee; 
        require(netPayoutToClaimant > 0, "CP: Net payout is zero after fee");

        // --- 2. Apply Losses to LPs & Handle Cascading Pledge Updates for OTHER Pools ---
        // This helper will:
        // - Calculate each LP's share of `netPayoutToClaimant`.
        // - Reduce each LP's `totalDepositedAssetPrincipal`.
        // - Emit `UnderwriterLoss` for each.
        // - Call `_updatePledgedCapitalOnLoss` for each LP, which:
        //    - Reduces `totalCapitalPledgedToPool` for *OTHER* pools the LP backed.
        //    - Pauses those *OTHER* pools if they become insolvent.
        //    - Handles removing the LP from lists if wiped out.
        // - Populate `lpActualLossSharesPrincipal` (memory array).
        // - Return `totalLossBorneByLPs`.
        address[] storage specificUnderwriters_ref = poolSpecificUnderwriters[poolId]; // Storage pointer
        uint256[] memory lpActualLossSharesPrincipal = new uint256[](specificUnderwriters_ref.length); 

        uint256 totalLossBorneByLPs = _applyAndCascadeLPLosses(
            poolId,       // The pool where the claim occurred
            pool,         // Storage reference to the claim pool
            netPayoutToClaimant,
            specificUnderwriters_ref, 
            lpActualLossSharesPrincipal 
        );

        // --- 3. Update THIS Claim Pool's State, Handle CatPool, Update System NAV ---
        // This helper will:
        // - Directly reduce `pool.totalCapitalPledgedToPool` for *this* claim pool by `totalLossBorneByLPs`.
        // - Call `catPool.drawFund` if `totalLossBorneByLPs < netPayoutToClaimant`.
        // - Reduce global `totalSystemValue` by `totalLossBorneByLPs`.
        uint256 shortfallCoveredByCatPool = _handlePoolUpdatesAndCatPoolInteraction(
            pool,                   // Storage reference to the claim pool
            poolId,                 // For event emission related to this pool
            totalLossBorneByLPs,
            netPayoutToClaimant
        );
        
        // --- 4. Calculate Gross Protocol Token Amount (needed for finalize helper) ---
        uint256 grossProtocolTokenAmountToReceive = policyCoverageValue * pool.scaleToProtocolToken;

        // --- 5. Finalize Payout, Distressed Assets, and Policy Updates ---
        // This helper will:
        // - Transfer `netPayoutToClaimant` of `pool.underlyingAsset` to `currentPolicyOwner`.
        // - Receive `grossProtocolTokenAmountToReceive` of `pool.protocolTokenToCover` from `currentPolicyOwner`.
        // - Accrue distressed assets to LPs (calling `_accrueDistressedAssetsToLPs`).
        // - Update `pool.totalCoverageSold`.
        // - Burn `policyNFT`.
        // - Emit `ClaimProcessed`.
        _finalizeClaimPayoutAndUpdates(
            _policyId,
            poolId,
            netPayoutToClaimant,
            claimFee, 
            totalLossBorneByLPs,
            lpActualLossSharesPrincipal, 
            shortfallCoveredByCatPool,
            // currentPolicyOwner, // REMOVED - _finalizeClaimPayoutAndUpdates re-fetches owner
            policyCoverageValue,
            grossProtocolTokenAmountToReceive // Pass the calculated gross amount
        );
    }
    /**
     * @dev Helper to update pledged capital in pools when an underwriter takes a loss or fully withdraws.
     * Specifically handles the cascading reduction for *other* pools.
     * Also manages removal from tracking arrays if _isWipedOutOrFullRemoval is true.
     */
    function _updatePledgedCapitalOnLoss( 
        address _underwriter,
        uint256 _lossPoolId, 
        uint256 _principalLossAmount, 
        bool _isWipedOutOrFullRemoval 
    ) internal {
        UnderwriterAccount storage account = underwriterAccounts[_underwriter];
        
        for (uint i = 0; i < account.allocatedPoolIds.length; i++) {
            uint256 currentPoolId = account.allocatedPoolIds[i];
            
            if (currentPoolId < protocolRiskPools.length && account.isAllocatedToPool[currentPoolId]) {
                PoolData storage affectedPool = protocolRiskPools[currentPoolId];

                if (currentPoolId != _lossPoolId) { 
                    if (affectedPool.totalCapitalPledgedToPool >= _principalLossAmount) {
                        affectedPool.totalCapitalPledgedToPool -= _principalLossAmount;
                    } else {
                        affectedPool.totalCapitalPledgedToPool = 0;
                    }
                    emit CapitalPledgedToPoolChanged(currentPoolId, -int256(_principalLossAmount));

                    if (affectedPool.totalCoverageSold > affectedPool.totalCapitalPledgedToPool && !affectedPool.isPaused) {
                        affectedPool.isPaused = true;
                        emit IncidentReported(currentPoolId, true);
                    }
                }

                if (_isWipedOutOrFullRemoval) { // This applies to ALL allocated pools if wiped out/fully removed
                    account.isAllocatedToPool[currentPoolId] = false; 
                    
                    address[] storage underwritersInThisPool = poolSpecificUnderwriters[currentPoolId];
                    uint256 storedIndex = underwriterIndexInPoolArray[currentPoolId][_underwriter];
                    if (storedIndex < underwritersInThisPool.length && underwritersInThisPool[storedIndex] == _underwriter) {
                        address lastU = underwritersInThisPool[underwritersInThisPool.length - 1];
                        if (_underwriter != lastU) {
                            underwritersInThisPool[storedIndex] = lastU;
                            underwriterIndexInPoolArray[currentPoolId][lastU] = storedIndex;
                        }
                        underwritersInThisPool.pop();
                        delete underwriterIndexInPoolArray[currentPoolId][_underwriter];
                    }
                }
            }
        }

        if (_isWipedOutOrFullRemoval) {
            delete account.allocatedPoolIds; 
        }
    }

    /* ───────────────────── Incident Management ─────────────────── */
    function reportIncident(uint256 _poolId) external onlyCommittee {
        require(_poolId < protocolRiskPools.length, "CP: Invalid pool ID");
        protocolRiskPools[_poolId].isPaused = true;
        emit IncidentReported(_poolId, true);
    }

    function resolveIncident(uint256 _poolId) external onlyCommittee {
        require(_poolId < protocolRiskPools.length, "CP: Invalid pool ID");
        protocolRiskPools[_poolId].isPaused = false;
        emit IncidentReported(_poolId, false);
    }

    /* ───────────────────── Reward Claiming for Underwriters ───────────────────── */
    function claimPremiumRewards(uint256 _poolId) external nonReentrant {
        require(_poolId < protocolRiskPools.length, "CP: Invalid pool ID");
        PoolData storage pool = protocolRiskPools[_poolId]; 
        
        UnderwriterPoolRewards storage rewards = underwriterPoolRewards[_poolId][msg.sender];
        uint256 amountToClaim = rewards.pendingPremiums;

        require(amountToClaim > 0, "CP: No premium rewards to claim for this pool");
        rewards.pendingPremiums = 0;
        pool.underlyingAsset.safeTransfer(msg.sender, amountToClaim);
        emit PremiumRewardsClaimed(msg.sender, _poolId, amountToClaim);
    }

    function claimDistressedAssetRewards(uint256 _poolId) external nonReentrant {
        require(_poolId < protocolRiskPools.length, "CP: Invalid pool ID");
        PoolData storage pool = protocolRiskPools[_poolId]; 

        UnderwriterPoolRewards storage rewards = underwriterPoolRewards[_poolId][msg.sender];
        uint256 amountToClaim = rewards.pendingDistressedAssets;

        require(amountToClaim > 0, "CP: No distressed asset rewards to claim for this pool");
        rewards.pendingDistressedAssets = 0;
        pool.protocolTokenToCover.safeTransfer(msg.sender, amountToClaim);
        emit DistressedAssetRewardsClaimed(msg.sender, _poolId, address(pool.protocolTokenToCover), amountToClaim);
    }

    function claimRewardsFromMultiplePools(
        uint256[] calldata _poolIds,
        bool _claimPremiums,
        bool _claimDistressedAssets
    ) external nonReentrant {
        require(_poolIds.length > 0, "CP: No pool IDs provided");

        for (uint i = 0; i < _poolIds.length; i++) {
            uint256 poolId = _poolIds[i];
            require(poolId < protocolRiskPools.length, "CP: Invalid pool ID in array");
            PoolData storage pool = protocolRiskPools[poolId];
            UnderwriterPoolRewards storage rewards = underwriterPoolRewards[poolId][msg.sender];

            if (_claimPremiums) {
                uint256 premiumAmountToClaim = rewards.pendingPremiums;
                if (premiumAmountToClaim > 0) {
                    rewards.pendingPremiums = 0;
                    pool.underlyingAsset.safeTransfer(msg.sender, premiumAmountToClaim);
                    emit PremiumRewardsClaimed(msg.sender, poolId, premiumAmountToClaim);
                }
            }

            if (_claimDistressedAssets) {
                uint256 distressedAmountToClaim = rewards.pendingDistressedAssets;
                if (distressedAmountToClaim > 0) {
                    rewards.pendingDistressedAssets = 0;
                    pool.protocolTokenToCover.safeTransfer(msg.sender, distressedAmountToClaim);
                    emit DistressedAssetRewardsClaimed(msg.sender, poolId, address(pool.protocolTokenToCover), distressedAmountToClaim);
                }
            }
        }
    }

    /* ───────────────────── NAV Synchronization (Keeper Function) ───────────────────── */
    function syncYieldAndAdjustSystemValue() external nonReentrant onlyOwner {
        uint256 newCalculatedTotalSystemValue = 0;
        IERC20 commonUnderlyingAsset; 
        bool commonAssetDetermined = false;

        // Try to determine the common underlying asset type for liquid balance check
        if (protocolRiskPools.length > 0 && address(protocolRiskPools[0].underlyingAsset) != address(0)) {
            commonUnderlyingAsset = protocolRiskPools[0].underlyingAsset;
            commonAssetDetermined = true;
        } else if (activeYieldAdapterAddresses.length > 0) {
            // Try to get asset type from the first *valid* active adapter
            for(uint k=0; k < activeYieldAdapterAddresses.length; ++k){
                if(address(baseYieldAdapters[YieldPlatform.OTHER_YIELD]) == activeYieldAdapterAddresses[k] || // Example check, need better mapping
                   address(baseYieldAdapters[YieldPlatform.AAVE]) == activeYieldAdapterAddresses[k] ||
                   address(baseYieldAdapters[YieldPlatform.COMPOUND]) == activeYieldAdapterAddresses[k] ){
                     try IYieldAdapter(activeYieldAdapterAddresses[k]).asset() returns (IERC20 adapterAsset) {
                        if (address(adapterAsset) != address(0)) {
                            commonUnderlyingAsset = adapterAsset;
                            commonAssetDetermined = true;
                            break;
                        }
                    } catch { /* Continue to next adapter if asset call fails */ }
                }
            }
        }

        // Sum values from all active yield adapters
        for (uint i = 0; i < activeYieldAdapterAddresses.length; i++) {
            address adapterAddress = activeYieldAdapterAddresses[i];
            IYieldAdapter adapter = IYieldAdapter(adapterAddress); // Interface is directly used
            
            // Call the explicitly defined function from the interface
            try adapter.getCurrentValueHeld() returns (uint256 valueInAdapter) {
                newCalculatedTotalSystemValue += valueInAdapter;
            } catch Error(string memory reason) {
                emit AdapterCallFailed(adapterAddress, "getCurrentValueHeld", reason);
                // Potentially revert or skip this adapter if it consistently fails.
                // For now, it's skipped, and NAV will be lower if an adapter is offline.
            } catch {
                emit AdapterCallFailed(adapterAddress, "getCurrentValueHeld", "Unknown error");
            }
        }

        // Add any liquid underlying assets held directly by this CoverPool contract
        if (commonAssetDetermined) {
            newCalculatedTotalSystemValue += commonUnderlyingAsset.balanceOf(address(this));
        }
        // If no common asset determined and no adapters, newCalculatedTotalSystemValue remains 0.

        uint256 oldTotalSystemValue = totalSystemValue;
        totalSystemValue = newCalculatedTotalSystemValue;

        if (totalMasterSharesSystem == 0 && totalSystemValue != 0) {
            // This could happen if funds are sent directly to the contract after all LPs withdrew.
            // Or if yield was earned on "protocol-owned liquidity" after last LP left.
            // For simplicity and safety, if no shares, value should be 0 from LP perspective.
            // A treasury mechanism could claim this orphaned value.
            totalSystemValue = 0; 
        }

        emit SystemValueSynced(totalSystemValue, oldTotalSystemValue, block.timestamp);
    }
}