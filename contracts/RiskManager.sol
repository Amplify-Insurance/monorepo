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
    function mint(address _owner, uint256 _poolId, uint256 _coverage, uint256 _activation, uint256 _lastPaidUntil) external returns (uint256);
    function burn(uint256 _policyId) external;
    function ownerOf(uint256 _policyId) external view returns (address);
    function getPolicy(uint256 _policyId) external view returns (Policy memory);
    function updateLastPaid(uint256 _policyId, uint256 _newLastPaid) external;

    struct Policy {
        uint256 poolId;
        uint256 coverage;
        uint256 activation;
        uint256 lastPaidUntil;
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
    uint256 public constant COVER_COOLDOWN_PERIOD = 600 seconds;
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
            isPaused: false
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
    
    // Note: A `deallocateCapital` function would be the inverse of `allocateCapital`.
    // It would need similar solvency checks to `onWithdrawalRequested`.

    /* ──────────────── Policy Purchase & Lifecycle ──────────────── */

    function purchaseCover(uint256 _poolId, uint256 _coverageAmount) external nonReentrant returns (uint256 policyId) {
        if (_poolId >= protocolRiskPools.length) revert InvalidPoolId();
        PoolData storage pool = protocolRiskPools[_poolId];
        if (pool.isPaused) revert PoolPaused();
        if (_coverageAmount == 0) revert InvalidAmount();
        if (!_isPoolSolventForNewCover(pool, _coverageAmount)) revert InsufficientCapacity();

        uint256 annualPremiumRateBps = _getPremiumRateBpsAnnual(pool);
        uint256 weeklyPremium = (_coverageAmount * annualPremiumRateBps * 7 days) / (SECS_YEAR * BPS);
        if (weeklyPremium == 0) revert InvalidAmount();

        uint256 catAmount = (weeklyPremium * catPremiumBps) / BPS;
        uint256 poolIncome = weeklyPremium - catAmount;

        IERC20 underlying = capitalPool.underlyingAsset();
        underlying.safeTransferFrom(msg.sender, address(this), weeklyPremium);

        if (catAmount > 0) {
            underlying.approve(address(catPool), catAmount);
            catPool.receiveUsdcPremium(catAmount);
        }

        if (poolIncome > 0 && pool.totalCapitalPledgedToPool > 0) {
            _accruePoolIncomeToUnderwriters(_poolId, poolIncome, pool);
        }

        uint256 activationTimestamp = block.timestamp + COVER_COOLDOWN_PERIOD;
        uint256 paidUntilTimestamp = activationTimestamp + 7 days;

        policyId = policyNFT.mint(msg.sender, _poolId, _coverageAmount, activationTimestamp, paidUntilTimestamp);
        pool.totalCoverageSold += _coverageAmount;

        emit PolicyCreated(msg.sender, policyId, _poolId, _coverageAmount, weeklyPremium);
        emit PremiumPaid(policyId, _poolId, weeklyPremium, catAmount, poolIncome);
    }

    function settlePremium(uint256 _policyId) public nonReentrant {
        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (pol.coverage == 0) revert("RM: Policy invalid");
        if (block.timestamp < pol.activation) revert("RM: Policy not active");

        uint256 poolId = pol.poolId;
        PoolData storage pool = protocolRiskPools[poolId];
        if (pool.isPaused) revert PoolPaused();

        uint256 dueAmount = premiumOwed(_policyId);
        if (dueAmount == 0) return;

        address policyOwner = policyNFT.ownerOf(_policyId);
        IERC20 underlying = capitalPool.underlyingAsset();
        
        // This pattern allows anyone to pay, but takes from the owner's balance.
        // We use the standard `transferFrom` which returns a boolean, instead of `safeTransferFrom` which reverts.
        // This allows us to handle the failure case (lapsing the policy) gracefully.
        bool paid = underlying.transferFrom(policyOwner, address(this), dueAmount);

        if (paid) {
            // If payment succeeds, distribute the premium
            uint256 catAmount = (dueAmount * catPremiumBps) / BPS;
            uint256 poolIncome = dueAmount - catAmount;

            if (catAmount > 0) {
                underlying.approve(address(catPool), catAmount);
                catPool.receiveUsdcPremium(catAmount);
            }

            if (poolIncome > 0 && pool.totalCapitalPledgedToPool > 0) {
                _accruePoolIncomeToUnderwriters(poolId, poolIncome, pool);
            }
            
            policyNFT.updateLastPaid(_policyId, block.timestamp);
            emit PremiumPaid(_policyId, poolId, dueAmount, catAmount, poolIncome);
        } else {
            // If payment fails (insufficient balance/allowance), lapse the policy.
            _lapse(_policyId, pol, pool);
        }
    }


    /* ───────────────────── Claim Processing ───────────────────── */

    function processClaim(uint256 _policyId, bytes calldata /*_proofOfLossData*/) external nonReentrant {
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


    /* ───────────────── Internal & Helper Functions ──────────────── */

    function _validateClaimDetails(uint256 _policyId)
        internal
        view
        returns (IPolicyNFT.Policy memory pol, PoolData storage pool, address policyOwner)
    {
        pol = policyNFT.getPolicy(_policyId);
        require(pol.coverage > 0, "RM: Policy invalid");
        require(block.timestamp >= pol.activation, "RM: Policy not active");
        require(premiumOwed(_policyId) == 0, "RM: Premiums outstanding");
        policyOwner = policyNFT.ownerOf(_policyId);
        pool = protocolRiskPools[pol.poolId];
        require(!pool.isPaused, "RM: Pool is paused");
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
                uint256 storedIndex = underwriterIndexInPoolArray[poolId][_underwriter];
                address[] storage underwritersInPool = poolSpecificUnderwriters[poolId];
                address lastUnderwriter = underwritersInPool[underwritersInPool.length - 1];
                underwritersInPool[storedIndex] = lastUnderwriter;
                underwriterIndexInPoolArray[poolId][lastUnderwriter] = storedIndex;
                underwritersInPool.pop();
                delete underwriterIndexInPoolArray[poolId][_underwriter];
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

    /// @notice Returns the number of protocol risk pools that have been created
    function protocolRiskPoolsLength() external view returns (uint256) {
        return protocolRiskPools.length;
    }

    function premiumOwed(uint256 _policyId) public view returns (uint256) {
        IPolicyNFT.Policy memory pol = policyNFT.getPolicy(_policyId);
        if (pol.coverage == 0 || block.timestamp < pol.activation || block.timestamp <= pol.lastPaidUntil) {
            return 0;
        }
        PoolData storage pool = protocolRiskPools[pol.poolId];
        uint256 elapsed = block.timestamp - pol.lastPaidUntil;
        uint256 annualRate = _getPremiumRateBpsAnnual(pool);
        return (pol.coverage * annualRate * elapsed) / (SECS_YEAR * BPS);
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

    // ------------------------------------------------------------------
    // Test helper functions
    // ------------------------------------------------------------------

    /// @notice Directly sets total coverage sold for a pool. Test only.
    function mock_setTotalCoverageSold(uint256 _poolId, uint256 _value) external {
        protocolRiskPools[_poolId].totalCoverageSold = _value;
    }

    /// @notice Directly sets total capital pledged for a pool. Test only.
    function mock_setTotalCapitalPledged(uint256 _poolId, uint256 _value) external {
        protocolRiskPools[_poolId].totalCapitalPledgedToPool = _value;
    }

    /// @notice Sets pending premium rewards for an underwriter. Test only.
    function mock_setPendingPremiums(uint256 _poolId, address _underwriter, uint256 _amount) external {
        underwriterPoolRewards[_poolId][_underwriter].pendingPremiums = _amount;
    }

    /// @notice Sets pending distressed asset rewards for an underwriter. Test only.
    function mock_setPendingDistressedAssets(uint256 _poolId, address _underwriter, uint256 _amount) external {
        underwriterPoolRewards[_poolId][_underwriter].pendingDistressedAssets = _amount;
    }
}