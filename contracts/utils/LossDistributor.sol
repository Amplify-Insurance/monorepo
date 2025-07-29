// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/ILossDistributor.sol";
import "../interfaces/IUnderwriterManager.sol";
import "../interfaces/ICapitalPool.sol";
import "../interfaces/IPoolRegistry.sol";

/**
 * @title LossDistributor
 * @author Gemini
 * @notice Manages accounting for direct and contagion losses.
 * @dev V3: Implements a hybrid model where contagion losses only affect underwriters 
 * who are allocated to both the source and target pools.
 */
contract LossDistributor is ILossDistributor, Ownable {
    // --- Dependencies ---
    address public riskManager;
    IUnderwriterManager public underwriterManager;
    ICapitalPool public capitalPool;
    IPoolRegistry public poolRegistry;

    // --- Events ---
    event RiskManagerSet(address indexed newRiskManager);
    event UnderwriterManagerSet(address indexed newUnderwriterManager);
    event CapitalPoolSet(address indexed newCapitalPool);
    event PoolRegistrySet(address indexed newPoolRegistry);

    // --- Accounting Structs ---
    struct LossTracker {
        /// @notice Total accumulated shares-to-burn per unit of pledge for a pool.
        uint256 accumulatedSharesToBurnPerPledge;
    }

    struct UserDirectLossState {
        /// @notice Crystallized share debt from previous pledge updates.
        uint256 historicalShareDebt;
        /// @notice Snapshot of the pool's direct loss ratio at last pledge update.
        uint256 directRatioSnapshot;
    }

    // --- State Variables ---
    /// @notice Tracks direct losses for a given pool.
    mapping(uint256 => LossTracker) public poolLossTrackers;
    /// @notice Tracks contagion losses pushed from a source pool to a target pool.
    mapping(uint256 => mapping(uint256 => LossTracker)) public contagionLossTrackers; // [targetPoolId][sourcePoolId]

    /// @notice Tracks an underwriter's historical debt and snapshots for direct losses.
    mapping(address => mapping(uint256 => UserDirectLossState)) public userLossStates;
    /// @notice Tracks an underwriter's ratio snapshot for contagion losses.
    mapping(address => mapping(uint256 => mapping(uint256 => uint256))) public userContagionRatioSnapshots; // [user][targetPoolId][sourcePoolId]

    uint256 public constant PRECISION_FACTOR = 1e18;

    // --- Modifiers & Errors ---
    modifier onlyRiskManager() {
        require(msg.sender == riskManager, "LD: Not RiskManager");
        _;
    }

    modifier onlyUnderwriterManager() {
        require(msg.sender == address(underwriterManager), "LD: Not UnderwriterManager");
        _;
    }

    error ZeroAddress();

    // --- Constructor & Configuration ---
    constructor(
        address _riskManager,
        address _underwriterManager,
        address _capitalPool,
        address _poolRegistry
    ) Ownable(msg.sender) {
        if (
            _riskManager == address(0) ||
            _underwriterManager == address(0) ||
            _capitalPool == address(0) ||
            _poolRegistry == address(0)
        ) revert ZeroAddress();

        riskManager = _riskManager;
        underwriterManager = IUnderwriterManager(_underwriterManager);
        capitalPool = ICapitalPool(_capitalPool);
        poolRegistry = IPoolRegistry(_poolRegistry);
    }

    function setRiskManager(address newRiskManager) external onlyOwner {
        if (newRiskManager == address(0)) revert ZeroAddress();
        riskManager = newRiskManager;
        emit RiskManagerSet(newRiskManager);
    }

    function setUnderwriterManager(address newUnderwriterManager) external onlyOwner {
        if (newUnderwriterManager == address(0)) revert ZeroAddress();
        underwriterManager = IUnderwriterManager(newUnderwriterManager);
        emit UnderwriterManagerSet(newUnderwriterManager);
    }

    function setCapitalPool(address newCapitalPool) external onlyOwner {
        if (newCapitalPool == address(0)) revert ZeroAddress();
        capitalPool = ICapitalPool(newCapitalPool);
        emit CapitalPoolSet(newCapitalPool);
    }

    function setPoolRegistry(address newPoolRegistry) external onlyOwner {
        if (newPoolRegistry == address(0)) revert ZeroAddress();
        poolRegistry = IPoolRegistry(newPoolRegistry);
        emit PoolRegistrySet(newPoolRegistry);
    }

    // --- Core Logic ---

    function distributeLoss(
        uint256 claimPoolId,
        uint256 lossAmount
    ) external override onlyRiskManager {
        if (lossAmount == 0) return;

        uint256 totalCapitalInClaimPool = underwriterManager.overlapExposure(claimPoolId, claimPoolId);
        if (totalCapitalInClaimPool == 0) return;

        // 1. Handle the Direct Loss on the Claiming Pool
        uint256 sharesToBurnForDirectLoss = capitalPool.valueToShares(lossAmount);
        if (sharesToBurnForDirectLoss > 0) {
            poolLossTrackers[claimPoolId].accumulatedSharesToBurnPerPledge +=
                (sharesToBurnForDirectLoss * PRECISION_FACTOR) / totalCapitalInClaimPool;
        }

        // 2. Distribute Contagion Loss to other correlated pools
        uint256 poolCount = poolRegistry.getPoolCount();
        for (uint256 p = 0; p < poolCount; p++) {
            if (p == claimPoolId) continue;

            uint256 overlap = underwriterManager.overlapExposure(claimPoolId, p);
            if (overlap == 0) continue;

            uint256 lossForPoolP = Math.mulDiv(lossAmount, overlap, totalCapitalInClaimPool);
            if (lossForPoolP == 0) continue;
            
            uint256 totalCapitalInPoolP = underwriterManager.overlapExposure(p, p);
            if (totalCapitalInPoolP == 0) continue;

            uint256 sharesToBurnForContagion = capitalPool.valueToShares(lossForPoolP);
            if (sharesToBurnForContagion > 0) {
                // Store this loss in the dedicated contagion tracker
                contagionLossTrackers[p][claimPoolId].accumulatedSharesToBurnPerPledge +=
                    (sharesToBurnForContagion * PRECISION_FACTOR) / totalCapitalInPoolP;
            }
        }
    }
    
    function recordPledgeUpdate(address user, uint256 poolId)
        external
        override
        onlyUnderwriterManager
    {
        uint256 pendingDebt = getPendingLosses(user, poolId, underwriterManager.underwriterPoolPledge(user, poolId));
        
        if (pendingDebt > 0) {
            userLossStates[user][poolId].historicalShareDebt += pendingDebt;
        }

        // Update snapshots to the current values
        userLossStates[user][poolId].directRatioSnapshot = poolLossTrackers[poolId].accumulatedSharesToBurnPerPledge;
        
        uint256 poolCount = poolRegistry.getPoolCount();
        for (uint256 i = 0; i < poolCount; i++) {
            userContagionRatioSnapshots[user][poolId][i] = contagionLossTrackers[poolId][i].accumulatedSharesToBurnPerPledge;
        }
    }

    function realizeAggregateLoss(
        address user,
        uint256 totalSharesToBurn,
        uint256[] calldata poolIds
    ) external override onlyUnderwriterManager {
        if (totalSharesToBurn == 0) return;

        (, , uint256 userMasterShares, ) = capitalPool.getUnderwriterAccount(user);

        uint256 burnable = Math.min(totalSharesToBurn, userMasterShares);
        if (burnable > 0) {
            capitalPool.burnSharesForLoss(user, burnable);
        }

        // Reset user loss states for all their allocated pools
        for (uint256 i = 0; i < poolIds.length; i++) {
            uint256 pid = poolIds[i];
            userLossStates[user][pid].historicalShareDebt = 0;
            userLossStates[user][pid].directRatioSnapshot = poolLossTrackers[pid].accumulatedSharesToBurnPerPledge;
            
            uint256 poolCount = poolRegistry.getPoolCount();
            for (uint256 j = 0; j < poolCount; j++) {
                userContagionRatioSnapshots[user][pid][j] = contagionLossTrackers[pid][j].accumulatedSharesToBurnPerPledge;
            }
        }
    }

    // --- View Functions ---

    function getPendingLosses(
        address user,
        uint256 poolId,
        uint256 userPledge
    ) public view override returns (uint256 pendingSharesToBurn) {
        if (userPledge == 0) return 0;
        
        UserDirectLossState storage uds = userLossStates[user][poolId];
        pendingSharesToBurn = uds.historicalShareDebt;

        // 1. Calculate debt from DIRECT losses on this pool.
        LossTracker storage directTracker = poolLossTrackers[poolId];
        uint256 directDelta = directTracker.accumulatedSharesToBurnPerPledge - uds.directRatioSnapshot;
        if (directDelta > 0) {
            pendingSharesToBurn += (userPledge * directDelta) / PRECISION_FACTOR;
        }

        // 2. Calculate debt from CONTAGION losses pushed from other pools.
        uint256 poolCount = poolRegistry.getPoolCount();
        for (uint256 sourcePoolId = 0; sourcePoolId < poolCount; sourcePoolId++) {
            if (sourcePoolId == poolId) continue;
            
            // Only add contagion debt if the user was also underwriting the source pool.
            if (underwriterManager.isAllocatedToPool(user, sourcePoolId)) {
                LossTracker storage contagionTracker = contagionLossTrackers[poolId][sourcePoolId];
                uint256 snapshot = userContagionRatioSnapshots[user][poolId][sourcePoolId];
                uint256 contagionDelta = contagionTracker.accumulatedSharesToBurnPerPledge - snapshot;
                
                if (contagionDelta > 0) {
                    pendingSharesToBurn += (userPledge * contagionDelta) / PRECISION_FACTOR;
                }
            }
        }
    }
}