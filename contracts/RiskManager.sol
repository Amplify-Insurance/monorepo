// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

// OpenZeppelin Imports
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

// Interfaces for external contracts
interface ICapitalPool {
    function applyLosses(address _underwriter, uint256 _principalLossAmount) external;
    function underlyingAsset() external view returns (IERC20);
}


interface IPolicyNFT {
    function mint(address _owner, uint256 _poolId, uint256 _coverage, uint256 _activation, uint128 _premiumDeposit, uint128 _lastDrainTime) external returns (uint256);
    
    function burn(uint256 _policyId) external;
    function ownerOf(uint256 _policyId) external view returns (address);
    function getPolicy(uint256 _policyId) external view returns (Policy memory);
    
    // DEPRECATED in new model, but kept for compatibility during transition if needed
    function updateLastPaid(uint256 _policyId, uint256 _newLastPaid) external;

    // ADDED: The missing function declaration
    function updatePremiumAccount(uint256 _policyId, uint128 _newDeposit, uint128 _newDrainTime) external;

    // This struct definition is correct as-is
    struct Policy {
        uint256 poolId;
        uint256 coverage;
        uint256 activation;
        uint128 premiumDeposit;
        uint128 lastDrainTime;
    }
}

interface ICatInsurancePool {
    function receiveUsdcPremium(uint256 _amount) external;
    function drawFund(uint256 _amount) external;
    function receiveProtocolAssetsForDistribution(IERC20 _protocolToken, uint256 _amount) external;
}


/**
 * @title RiskManager
 * @author Your Name/Team
 * @notice This contract manages the application logic of the insurance protocol, including risk pools,
 * policy sales, and claim processing. It operates on top of a separate CapitalPool contract, which holds
 * all underwriter funds. This contract is responsible for calculating losses and instructing the CapitalPool
 * to apply them.
 */
contract RiskManager is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /* ───────────────────────── Constants ───────────────────────── */
    uint256 public constant BPS = 10_000;
    uint256 public constant SECS_YEAR = 365 days;
    uint256 public constant CLAIM_FEE_BPS = 500; // 5%
    uint256 public constant COVER_COOLDOWN_PERIOD = 5 days;
    uint256 public constant MAX_ALLOCATIONS_PER_UNDERWRITER = 5;

    /* ───────────────────────── State Variables ──────────────────────── */

    // --- Core Contracts ---
    ICapitalPool public immutable capitalPool;
    IPolicyNFT public immutable policyNFT;
    ICatInsurancePool public immutable catPool;
    address public committee;

    // --- Pool Data & Underwriting ---
    enum ProtocolRiskIdentifier { NONE, PROTOCOL_A, PROTOCOL_B, LIDO_STETH, ROCKET_RETH }

    struct PoolData {
        IERC20 protocolTokenToCover;
        RateModel rateModel;
        uint256 totalCapitalPledgedToPool; // Sum of principals pledged by underwriters to this pool.
        uint256 totalCoverageSold;         // Total active coverage sold for this pool.
        ProtocolRiskIdentifier protocolCovered;
        uint8 protocolTokenDecimals;
        uint256 scaleToProtocolToken;      // For converting coverage amount to protocolToken amount.
        bool isPaused;
        uint256 pauseTimestamp; // Timestamp of when the pool was paused.
    }

    PoolData[] public protocolRiskPools;

    // --- Underwriter Tracking ---
    mapping(address => uint256) public underwriterTotalPledge; // Cache of principal deposited in CapitalPool.
    mapping(uint256 => address[]) public poolSpecificUnderwriters; // poolId => list of underwriter addresses.
    mapping(uint256 => mapping(address => uint256)) public underwriterIndexInPoolArray; // poolId => underwriterAddr => index.
    mapping(address => mapping(uint256 => bool)) public isAllocatedToPool; // underwriter => poolId => bool.
    mapping(address => uint256[]) public underwriterAllocations; // underwriter => array of poolIds.

    // --- Premiums & Rewards ---
    uint256 public catPremiumBps = 2_000; // 20%

    struct UnderwriterPoolRewards {
        uint256 pendingPremiums;
        uint256 pendingDistressedAssets;
    }
    mapping(uint256 => mapping(address => UnderwriterPoolRewards)) public underwriterPoolRewards;

    struct RateModel {
        uint256 base;
        uint256 slope1;
        uint256 slope2;
        uint256 kink;
    }

    /* ───────────────────────── Modifiers & Errors ──────────────────────── */
    modifier onlyCommittee() {
        require(msg.sender == committee, "RM: Not committee");
        _;
    }

    modifier onlyCapitalPool() {
        require(msg.sender == address(capitalPool), "RM: Not CapitalPool");
        _;
    }

    error ZeroAddress();
    error InvalidAmount();
    error PoolPaused();
    error InsufficientCapacity();
    error InvalidPoolId();
    error NotAllocated();
    error AlreadyAllocated();
    error ExceedsMaxAllocations();
    error NoCapitalToAllocate();
    error WithdrawalInsolvent();
    error NoRewardsToClaim();
    error ClaimBlockedDuringPause();


    /* ───────────────────────── Events ──────────────────────────── */
    event PoolAdded(uint256 indexed poolId, address indexed protocolToken, ProtocolRiskIdentifier protocolCovered);
    event IncidentReported(uint256 indexed poolId, bool paused);
    event CapitalAllocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event CapitalDeallocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event PolicyCreated(address indexed user, uint256 indexed policyId, uint256 indexed poolId, uint256 coverageAmount, uint256 premiumPaid);
    event PremiumPaid(uint256 indexed policyId, uint256 poolId, uint256 amountPaid, uint256 catAmount, uint256 poolIncome);
    event PolicyLapsed(uint256 indexed policyId);
    event ClaimProcessed(uint256 indexed policyId, uint256 indexed poolId, address indexed claimant, uint256 netPayoutToClaimant);
    event PremiumRewardsClaimed(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event DistressedAssetRewardsClaimed(address indexed underwriter, uint256 indexed poolId, address indexed token, uint256 amount);
    event PolicyCancelled(uint256 indexed policyId, address indexed user, uint256 refundAmount);
    event RateModelUpdated(uint256 indexed poolId);


    /* ───────────────────── Constructor ─────────────────────────── */
    constructor(
        address _capitalPoolAddress,
        address _policyNFTAddress,
        address _catPoolAddress
    ) Ownable(msg.sender) {
        if (_capitalPoolAddress == address(0) || _policyNFTAddress == address(0) || _catPoolAddress == address(0)) {
            revert ZeroAddress();
        }
        capitalPool = ICapitalPool(_capitalPoolAddress);
        policyNFT = IPolicyNFT(_policyNFTAddress);
        catPool = ICatInsurancePool(_catPoolAddress);
        committee = msg.sender;
    }

    /* ───────────────────── Admin Functions ───────────────────── */

    function setCommittee(address _newCommittee) external onlyOwner {
        if (_newCommittee == address(0)) revert ZeroAddress();
        committee = _newCommittee;
    }

    function setCatPremiumShareBps(uint256 _newBps) external onlyOwner {
        require(_newBps <= 5000, "RM: Max share is 50%");
        catPremiumBps = _newBps;
    }
    
    /**
     * @notice The committee can report an incident to pause new cover sales for a pool.
     * @param _poolId The ID of the pool to pause or unpause.
     * @param _pauseState The desired state (true for paused, false for unpaused).
     */
    function reportIncident(uint256 _poolId, bool _pauseState) external onlyCommittee {
        if (_poolId >= protocolRiskPools.length) revert InvalidPoolId();
        PoolData storage pool = protocolRiskPools[_poolId];
        pool.isPaused = _pauseState;
        if (_pauseState) {
            pool.pauseTimestamp = block.timestamp;
        } else {
            pool.pauseTimestamp = 0; // Reset timestamp when unpausing
        }
        emit IncidentReported(_poolId, _pauseState);
    }
    
    /**
     * @notice Allows owner to update the rate model for a given pool.
     */
    function updateRateModel(uint256 _poolId, RateModel calldata _newRateModel) external onlyOwner {
        if (_poolId >= protocolRiskPools.length) revert InvalidPoolId();
        protocolRiskPools[_poolId].rateModel = _newRateModel;
        emit RateModelUpdated(_poolId);
    }


/**
 * @notice Calculates the accrued premium cost since the last drain, distributes it,
 * and updates the policy's remaining deposit.
 * @param _policyId The ID of the policy to settle.
 */
function _settleAndDrainPremium(uint256 _policyId) internal {
    IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
    if (block.timestamp <= pol.lastDrainTime) {
        return; // Nothing to drain yet
    }

    // --- 1. Calculate Accrued Cost ---
    PoolData storage pool = protocolRiskPools[pol.poolId];
    uint256 annualRateBps = _getPremiumRateBpsAnnual(pool);
    uint256 timeElapsed = block.timestamp - pol.lastDrainTime;
    uint256 accruedCost = (pol.coverage * annualRateBps * timeElapsed) / (SECS_YEAR * BPS);

    // --- 2. Determine Actual Amount to Drain ---
    // Cannot drain more than the available deposit.
    uint256 amountToDrain = Math.min(accruedCost, pol.premiumDeposit);
    if (amountToDrain == 0) {
        return; // No funds to drain
    }

    // --- 3. Distribute the Drained Premium ---
    uint256 catAmount = (amountToDrain * catPremiumBps) / BPS;
    uint256 poolIncome = amountToDrain - catAmount;

    if (catAmount > 0) {
        // The contract already holds the funds, so we just need to send them.
        capitalPool.underlyingAsset().approve(address(catPool), catAmount);
        catPool.receiveUsdcPremium(catAmount);
    }
    if (poolIncome > 0 && pool.totalCapitalPledgedToPool > 0) {
        _accruePoolIncomeToUnderwriters(pol.poolId, poolIncome, pool);
    }

    // --- 4. Update Policy State (EFFECTS) ---
    uint256 newDeposit = pol.premiumDeposit - amountToDrain;
    // This calls a new function on your NFT contract to update the two new fields
    policyNFT.updatePremiumAccount(_policyId, uint128(newDeposit), uint128(block.timestamp));

    emit PremiumPaid(_policyId, pol.poolId, amountToDrain, catAmount, poolIncome);
}

    /**
 * @notice Adds more funds to a policy's premium deposit.
 */
function addPremium(uint256 _policyId, uint256 _premiumAmount) external nonReentrant {
    _settleAndDrainPremium(_policyId); // Settle before adding more funds

    IERC20 underlying = capitalPool.underlyingAsset();
    underlying.safeTransferFrom(msg.sender, address(this), _premiumAmount);

    IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
    uint128 newDeposit = pol.premiumDeposit + uint128(_premiumAmount);
    
    // updatePremiumAccount only needs to update the deposit here, as the drain time is current.
    policyNFT.updatePremiumAccount(_policyId, newDeposit, pol.lastDrainTime);
}

    function addProtocolRiskPool(
        address _protocolTokenToCover,
        RateModel calldata _rateModel,
        ProtocolRiskIdentifier _protocolCovered
    ) external onlyOwner returns (uint256 poolId) {
        if (_protocolTokenToCover == address(0)) revert ZeroAddress();

        uint8 protoDec = IERC20Metadata(_protocolTokenToCover).decimals();
        uint8 underlyingDec = IERC20Metadata(address(capitalPool.underlyingAsset())).decimals();

        poolId = protocolRiskPools.length;
        protocolRiskPools.push(PoolData({
            protocolTokenToCover: IERC20(_protocolTokenToCover),
            rateModel: _rateModel,
            totalCapitalPledgedToPool: 0,
            totalCoverageSold: 0,
            protocolCovered: _protocolCovered,
            protocolTokenDecimals: protoDec,
            scaleToProtocolToken: 10**(protoDec >= underlyingDec ? protoDec - underlyingDec : 0),
            isPaused: false,
            pauseTimestamp: 0
        }));

        emit PoolAdded(poolId, _protocolTokenToCover, _protocolCovered);
    }

    /* ──────────────── Capital Hooks (Called by CapitalPool) ─────────────── */

    /**
     * @notice Hook called by CapitalPool after a successful deposit. Caches the underwriter's principal.
     * @dev The underwriter must then call `allocateCapital` on this contract to pledge their funds.
     */
    function onCapitalDeposited(address _underwriter, uint256 _amount) external onlyCapitalPool {
        underwriterTotalPledge[_underwriter] += _amount;
    }

    /**
     * @notice Hook called by CapitalPool during `requestWithdrawal` to check for solvency.
     * @dev This function is a critical gate. It reverts if the proposed withdrawal would make any
     * pool the underwriter has allocated to insolvent.
     */
    function onWithdrawalRequested(address _underwriter, uint256 _principalComponent) external view onlyCapitalPool {
        uint256[] memory allocations = underwriterAllocations[_underwriter];
        for (uint i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            PoolData storage pool = protocolRiskPools[poolId];
            if (pool.totalCapitalPledgedToPool < _principalComponent) revert WithdrawalInsolvent();
            uint256 newPledgedCapital = pool.totalCapitalPledgedToPool - _principalComponent;
            if (pool.totalCoverageSold > newPledgedCapital) {
                revert WithdrawalInsolvent();
            }
        }
    }

    /**
     * @notice Hook called by CapitalPool after a successful withdrawal. Updates local capital tracking.
     */
    function onCapitalWithdrawn(address _underwriter, uint256 _principalComponentRemoved, bool _isFullWithdrawal) external onlyCapitalPool {
        underwriterTotalPledge[_underwriter] -= _principalComponentRemoved;
        _updatePledgedCapitalForAllAllocations(_underwriter, _principalComponentRemoved, _isFullWithdrawal);
    }

    /* ──────────────── Underwriter Capital Allocation ──────────────── */

    /**
     * @notice Allows an underwriter to pledge their deposited capital to one or more risk pools.
     * @param _poolIds An array of pool IDs to allocate the underwriter's full capital to.
     */
    function allocateCapital(uint256[] calldata _poolIds) external nonReentrant {
        uint256 totalPledge = underwriterTotalPledge[msg.sender];
        if (totalPledge == 0) revert NoCapitalToAllocate();
        if (_poolIds.length == 0 || _poolIds.length > MAX_ALLOCATIONS_PER_UNDERWRITER) revert ExceedsMaxAllocations();
        
        for (uint i = 0; i < _poolIds.length; i++) {
            uint256 poolId = _poolIds[i];
            if (poolId >= protocolRiskPools.length) revert InvalidPoolId();
            if (isAllocatedToPool[msg.sender][poolId]) revert AlreadyAllocated();

            // Update pool state
            protocolRiskPools[poolId].totalCapitalPledgedToPool += totalPledge;

            // Add underwriter to tracking lists
            isAllocatedToPool[msg.sender][poolId] = true;
            underwriterAllocations[msg.sender].push(poolId);
            poolSpecificUnderwriters[poolId].push(msg.sender);
            underwriterIndexInPoolArray[poolId][msg.sender] = poolSpecificUnderwriters[poolId].length - 1;

            emit CapitalAllocated(msg.sender, poolId, totalPledge);
        }
    }
    
    /**
     * @notice Allows an underwriter to remove their capital pledge from one or more risk pools.
     * @param _poolIds An array of pool IDs to deallocate capital from.
     */
    function deallocateCapital(uint256[] calldata _poolIds) external nonReentrant {
        address underwriter = msg.sender;
        uint256 totalPledge = underwriterTotalPledge[underwriter];
        if (totalPledge == 0) revert NoCapitalToAllocate(); // Should not happen if allocated, but good practice.

        for (uint i = 0; i < _poolIds.length; i++) {
            uint256 poolId = _poolIds[i];
            if (poolId >= protocolRiskPools.length) revert InvalidPoolId();
            if (!isAllocatedToPool[underwriter][poolId]) revert NotAllocated();

            // Solvency check: Ensure deallocation doesn't leave the pool undercollateralized.
            PoolData storage pool = protocolRiskPools[poolId];
            uint256 newPledgedCapital = pool.totalCapitalPledgedToPool - totalPledge;
            if (pool.totalCoverageSold > newPledgedCapital) {
                revert WithdrawalInsolvent();
            }

            // Update pool state
            pool.totalCapitalPledgedToPool = newPledgedCapital;

            // Remove underwriter from tracking lists
            _removeUnderwriterFromPool(underwriter, poolId);

            emit CapitalDeallocated(underwriter, poolId, totalPledge);
        }
    }


    /* ──────────────── Policy Purchase & Lifecycle ──────────────── */

    /**
     * @notice Purchases insurance coverage bymaking an initial premium deposit.
     * @dev The policy remains active as long as funds remain in the deposit to pay for the streaming premium.
     * @param _poolId The ID of the risk pool.
     * @param _coverageAmount The amount of coverage desired.
     * @param _initialPremiumDeposit The initial amount of premium to deposit.
     */
    function purchaseCover(
        uint256 _poolId,
        uint256 _coverageAmount,
        uint256 _initialPremiumDeposit
    ) external nonReentrant returns (uint256 policyId) {
        if (_poolId >= protocolRiskPools.length) revert InvalidPoolId();
        PoolData storage pool = protocolRiskPools[_poolId];

        if (pool.isPaused) revert PoolPaused();
        if (_coverageAmount == 0 || _initialPremiumDeposit == 0) revert InvalidAmount();
        if (_initialPremiumDeposit > type(uint128).max) revert InvalidAmount();
        if (!_isPoolSolventForNewCover(pool, _coverageAmount)) revert InsufficientCapacity();

        uint256 annualPremiumRateBps = _getPremiumRateBpsAnnual(pool);
        uint256 minPremium = (_coverageAmount * annualPremiumRateBps * 7 days) / (SECS_YEAR * BPS);
        require(_initialPremiumDeposit >= minPremium, "RM: Deposit is less than the required minimum for 1 week");

        // --- Payment & Distribution ---
        IERC20 underlying = capitalPool.underlyingAsset();
        underlying.safeTransferFrom(msg.sender, address(this), _initialPremiumDeposit);

        // --- Policy Minting ---
        uint256 activationTimestamp = block.timestamp + COVER_COOLDOWN_PERIOD;
        policyId = policyNFT.mint(
            msg.sender,
            _poolId,
            _coverageAmount,
            activationTimestamp,
            uint128(_initialPremiumDeposit),
            uint128(activationTimestamp)
        );
        pool.totalCoverageSold += _coverageAmount;

        emit PolicyCreated(msg.sender, policyId, _poolId, _coverageAmount, _initialPremiumDeposit);
    }

    /**
     * @notice Allows a policyholder to cancel their active cover and get a refund for unspent premiums.
     * @dev This function will first settle any accrued premium up to the current block.timestamp.
     * It will then refund the remaining deposit, burn the NFT, and update pool statistics.
     * @param _policyId The ID of the policy to cancel.
     */
    function cancelCover(uint256 _policyId) external nonReentrant {
        // --- 1. Validation ---
        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        require(policyNFT.ownerOf(_policyId) == msg.sender, "RM: Not policy owner");
        require(pol.coverage > 0, "RM: Policy already claimed or cancelled");
        require(block.timestamp >= pol.activation, "RM: Cannot cancel during cooldown period");

        // --- 2. Settle Premiums ---
        // This is a critical step. It ensures underwriters are paid for the coverage
        // provided up to this exact moment and updates the policy's premiumDeposit on-chain.
        _settleAndDrainPremium(_policyId);

        // --- 3. Get Refund Amount ---
        // After settling, the remaining deposit is what we can refund.
        // We must re-fetch the policy state as _settleAndDrainPremium updated it.
        IPolicyNFT.Policy memory updatedPol = policyNFT.getPolicy(_policyId);
        uint256 refundAmount = updatedPol.premiumDeposit;

        // --- 4. State Updates (Effects) ---
        PoolData storage pool = protocolRiskPools[updatedPol.poolId];
        pool.totalCoverageSold -= pol.coverage; // Use the original coverage amount from `pol`

        // --- 5. Final Actions (Interactions) ---
        // Burn the user's Policy NFT
        policyNFT.burn(_policyId);

        // Refund the unspent premium to the user
        if (refundAmount > 0) {
            capitalPool.underlyingAsset().safeTransfer(msg.sender, refundAmount);
        }

        emit PolicyCancelled(_policyId, msg.sender, refundAmount);
    }
 
    /* ───────────────────── Claim Processing ───────────────────── */

    function processClaim(uint256 _policyId, bytes calldata /*_proofOfLossData*/) external nonReentrant {
        // --- Settle final premium before processing claim ---
        _settleAndDrainPremium(_policyId);
        
        // --- 1. Validation Helper ---
        (IPolicyNFT.Policy memory pol, PoolData storage pool, address policyOwner) = _validateClaimDetails(_policyId);
        require(msg.sender == policyOwner, "RM: Not policy owner");

        // --- 2. Calculations ---
        uint256 netPayoutToClaimant = (pol.coverage * (BPS - CLAIM_FEE_BPS)) / BPS;
        uint256 initialPoolCapital = pool.totalCapitalPledgedToPool; // Important: Cache capital before applying losses.

        // --- 3. Loss Application Helper ---
        uint256 totalLossBorneByLPs = _applyLPLosses(netPayoutToClaimant, pol.poolId);

        // --- 4. Pool Capital & CatPool Interaction ---
        pool.totalCapitalPledgedToPool -= totalLossBorneByLPs;
        uint256 shortfall = netPayoutToClaimant > totalLossBorneByLPs ? netPayoutToClaimant - totalLossBorneByLPs : 0;
        if (shortfall > 0) {
            catPool.drawFund(shortfall);
        }

        // --- 5. Finalize Payout & State Cleanup ---
        _finalizeClaimAndPayout(policyOwner, netPayoutToClaimant, _policyId, pol, pool, initialPoolCapital);
        
        emit ClaimProcessed(_policyId, pol.poolId, policyOwner, netPayoutToClaimant);
    }
    
    /* ───────────────────── Rewards Claiming ───────────────────── */

    /**
     * @notice Allows an underwriter to claim their accrued premium rewards from a specific pool.
     * @param _poolId The ID of the pool to claim rewards from.
     */
    function claimPremiumRewards(uint256 _poolId) external nonReentrant {
        UnderwriterPoolRewards storage rewards = underwriterPoolRewards[_poolId][msg.sender];
        uint256 amountToClaim = rewards.pendingPremiums;

        if (amountToClaim == 0) revert NoRewardsToClaim();

        // Effects-Interactions Pattern: Update state before external call.
        rewards.pendingPremiums = 0;

        IERC20 underlying = capitalPool.underlyingAsset();
        underlying.safeTransfer(msg.sender, amountToClaim);

        emit PremiumRewardsClaimed(msg.sender, _poolId, amountToClaim);
    }

    /**
     * @notice Allows an underwriter to claim their accrued distressed asset rewards from a specific pool.
     * @param _poolId The ID of the pool to claim rewards from.
     */
    function claimDistressedAssets(uint256 _poolId) external nonReentrant {
        if (_poolId >= protocolRiskPools.length) revert InvalidPoolId();
        
        UnderwriterPoolRewards storage rewards = underwriterPoolRewards[_poolId][msg.sender];
        uint256 amountToClaim = rewards.pendingDistressedAssets;

        if (amountToClaim == 0) revert NoRewardsToClaim();

        // Effects-Interactions Pattern
        rewards.pendingDistressedAssets = 0;

        IERC20 distressedToken = protocolRiskPools[_poolId].protocolTokenToCover;
        distressedToken.safeTransfer(msg.sender, amountToClaim);

        emit DistressedAssetRewardsClaimed(msg.sender, _poolId, address(distressedToken), amountToClaim);
    }


    /**
     * @notice Allows anyone to lapse a policy that is no longer active.
     * @dev This cleans up state by burning the NFT and reducing total coverage sold,
     * which keeps the premium rate calculations accurate for active policies.
     * @param _policyId The ID of the policy to potentially lapse.
     */
    function lapsePolicy(uint256 _policyId) external nonReentrant {
        // --- Settle final premium before lapsing ---
        _settleAndDrainPremium(_policyId);

        // First, check if the policy is already considered inactive.
        require(!isPolicyActive(_policyId), "RM: Policy is still active");

        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        require(pol.coverage > 0, "RM: Policy does not exist or already lapsed");

        PoolData storage pool = protocolRiskPools[pol.poolId];
        
        // Effects
        pool.totalCoverageSold -= pol.coverage;
        
        // Interactions
        policyNFT.burn(_policyId);

        emit PolicyLapsed(_policyId);
    }


    /* ───────────────── Internal & Helper Functions ──────────────── */
    
    function _removeUnderwriterFromPool(address _underwriter, uint256 _poolId) internal {
        // Remove from isAllocated mapping
        isAllocatedToPool[_underwriter][_poolId] = false;

        // Remove from underwriterAllocations array
        uint256[] storage allocations = underwriterAllocations[_underwriter];
        for (uint j = 0; j < allocations.length; j++) {
            if (allocations[j] == _poolId) {
                allocations[j] = allocations[allocations.length - 1];
                allocations.pop();
                break;
            }
        }
        
        // Remove from poolSpecificUnderwriters array (swap and pop)
        uint256 storedIndex = underwriterIndexInPoolArray[_poolId][_underwriter];
        address[] storage underwritersInPool = poolSpecificUnderwriters[_poolId];
        address lastUnderwriter = underwritersInPool[underwritersInPool.length - 1];
        underwritersInPool[storedIndex] = lastUnderwriter;
        underwriterIndexInPoolArray[_poolId][lastUnderwriter] = storedIndex;
        underwritersInPool.pop();
        delete underwriterIndexInPoolArray[_poolId][_underwriter];
    }

    function _validateClaimDetails(uint256 _policyId)
        internal
        view
        returns (IPolicyNFT.Policy memory pol, PoolData storage pool, address policyOwner)
    {
        pol = policyNFT.getPolicy(_policyId);
        require(pol.coverage > 0, "RM: Policy invalid");
        require(block.timestamp >= pol.activation, "RM: Policy not active yet");
        require(isPolicyActive(_policyId), "RM: Policy is lapsed (insufficient premium deposit)");

        policyOwner = policyNFT.ownerOf(_policyId);
        pool = protocolRiskPools[pol.poolId];

        // If the pool is paused, only allow claims from policies that were already
        // fully active *before* the pause was initiated. Policies whose cooldown
        // period was still pending at the time of the pause are blocked.
        if (pool.isPaused) {
            require(pol.activation < pool.pauseTimestamp, "RM: Claim blocked; policy was in cooldown during pause");
        }
    }


    function _applyLPLosses(uint256 _netPayoutToClaimant, uint256 _poolId) internal returns (uint256 totalLossBorneByLPs) {
        address[] storage specificUnderwriters = poolSpecificUnderwriters[_poolId];
        PoolData storage pool = protocolRiskPools[_poolId];
        uint256 initialPledgeForClaimPool = pool.totalCapitalPledgedToPool;
        
        for (uint i = 0; i < specificUnderwriters.length; i++) {
            address underwriter = specificUnderwriters[i];
            uint256 pledge = underwriterTotalPledge[underwriter];
            if (pledge == 0 || initialPledgeForClaimPool == 0) continue;
            
            uint256 lossShare = (_netPayoutToClaimant * pledge) / initialPledgeForClaimPool;
            uint256 actualLoss = Math.min(lossShare, pledge);

            if (actualLoss > 0) {
                capitalPool.applyLosses(underwriter, actualLoss);
                totalLossBorneByLPs += actualLoss;
            }
        }
    }

    function _finalizeClaimAndPayout(
        address _policyOwner,
        uint256 _netPayoutToClaimant,
        uint256 _policyId,
        IPolicyNFT.Policy memory _pol,
        PoolData storage _pool,
        uint256 _initialPoolCapital
    ) internal {
        // --- Payout & Distressed Assets ---
        IERC20 underlying = capitalPool.underlyingAsset();
        underlying.safeTransfer(_policyOwner, _netPayoutToClaimant);
        
        uint256 grossProtocolTokenAmount = _pol.coverage * _pool.scaleToProtocolToken;
        if (grossProtocolTokenAmount > 0) {
            _pool.protocolTokenToCover.safeTransferFrom(_policyOwner, address(this), grossProtocolTokenAmount);
            // Distressed asset distribution logic now implemented
            _accrueDistressedAssetsToUnderwriters(_pol.poolId, grossProtocolTokenAmount, _initialPoolCapital);
        }

        // --- Clean Up State ---
        _pool.totalCoverageSold -= _pol.coverage;
        policyNFT.burn(_policyId);
    }

    function _updatePledgedCapitalForAllAllocations(address _underwriter, uint256 _principalAmountReduced, bool _isFullRemoval) internal {
        uint256[] storage allocations = underwriterAllocations[_underwriter];
        for (uint i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            protocolRiskPools[poolId].totalCapitalPledgedToPool -= _principalAmountReduced;

            if (_isFullRemoval) {
                // Efficiently remove from poolSpecificUnderwriters array
                _removeUnderwriterFromPool(_underwriter, poolId);
            }
        }
        if (_isFullRemoval) {
            delete underwriterAllocations[_underwriter];
        }
    }

    function _accruePoolIncomeToUnderwriters(uint256 _poolId, uint256 _poolIncome, PoolData storage _pool) internal {
        address[] storage specificUnderwriters = poolSpecificUnderwriters[_poolId];
        uint256 numUnderwriters = specificUnderwriters.length;
        if (numUnderwriters == 0) return;

        // Use the current total capital for distribution of ongoing premiums
        uint256 totalCapital = _pool.totalCapitalPledgedToPool;
        if (totalCapital == 0) return;

        for (uint i = 0; i < numUnderwriters; i++) {
            address underwriter = specificUnderwriters[i];
            uint256 pledge = underwriterTotalPledge[underwriter];
            if (pledge > 0) {
                uint256 reward = (_poolIncome * pledge) / totalCapital;
                underwriterPoolRewards[_poolId][underwriter].pendingPremiums += reward;
            }
        }
    }

    function _accrueDistressedAssetsToUnderwriters(uint256 _poolId, uint256 _distressedAssetAmount, uint256 _initialPoolCapital) internal {
        address[] storage specificUnderwriters = poolSpecificUnderwriters[_poolId];
        uint256 numUnderwriters = specificUnderwriters.length;
        if (numUnderwriters == 0 || _initialPoolCapital == 0) return;
        
        for (uint i = 0; i < numUnderwriters; i++) {
            address underwriter = specificUnderwriters[i];
            uint256 pledge = underwriterTotalPledge[underwriter];
            if (pledge > 0) {
                // Distressed assets from a claim are distributed based on the capital state *before* losses were applied
                uint256 reward = (_distressedAssetAmount * pledge) / _initialPoolCapital;
                underwriterPoolRewards[_poolId][underwriter].pendingDistressedAssets += reward;
            }
        }
    }

    function _lapse(uint256 _policyId, IPolicyNFT.Policy memory _pol, PoolData storage _pool) internal {
        _pool.totalCoverageSold -= _pol.coverage;
        policyNFT.burn(_policyId);
        emit PolicyLapsed(_policyId);
    }

    /* ───────────────────── View Functions ───────────────────── */

    function getPoolInfo(uint256 _poolId) external view returns (PoolData memory) {
        return protocolRiskPools[_poolId];
    }


    function protocolRiskPoolsLength() external view returns (uint256) {
        return protocolRiskPools.length;
    }

    function _getPremiumRateBpsAnnual(PoolData storage _pool) internal view returns (uint256) {
        if (_pool.totalCapitalPledgedToPool == 0) return type(uint256).max; // Avoid division by zero
        uint256 utilizationBps = (_pool.totalCoverageSold * BPS) / _pool.totalCapitalPledgedToPool;
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


    /**
    * @notice View function to check if a policy is currently active.
    * @return True if the remaining deposit can cover the accrued cost.
    */
    function isPolicyActive(uint256 _policyId) public view returns (bool) {
        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (pol.coverage == 0) return false; // Policy already terminated
        if (block.timestamp <= pol.lastDrainTime) return pol.premiumDeposit > 0;
        
        PoolData storage pool = protocolRiskPools[pol.poolId];
        uint256 annualRateBps = _getPremiumRateBpsAnnual(pool);
        uint256 timeElapsed = block.timestamp - pol.lastDrainTime;
        uint256 accruedCost = (pol.coverage * annualRateBps * timeElapsed) / (SECS_YEAR * BPS);
        
        return pol.premiumDeposit > accruedCost;
    }

}