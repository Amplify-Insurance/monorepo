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
 * @dev V6: Updated to amplify losses across all of an underwriter's covered pools.
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
        uint256 accumulatedSharesToBurnPerPledge;
    }

    struct UserDirectLossState {
        uint256 historicalShareDebt;
        uint256 directRatioSnapshot;
    }

    // --- State Variables ---
    mapping(uint256 => LossTracker) public poolLossTrackers; // Direct losses
    mapping(uint256 => mapping(uint256 => LossTracker)) public contagionLossTrackers; // [targetPoolId][sourcePoolId]
    mapping(address => mapping(uint256 => UserDirectLossState)) public userLossStates;
    mapping(address => mapping(uint256 => mapping(uint256 => uint256))) public userContagionRatioSnapshots; // [user][targetPoolId][sourcePoolId]

    uint256 public constant PRECISION_FACTOR = 1e18;

    // --- Modifiers & Errors ---
    modifier onlyCapitalPool() {
        require(msg.sender == address(capitalPool), "LD: Not CapitalPool");
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

    /**
     * @notice Applies a loss to the originating pool and all linked contagion pools.
     * @dev This model amplifies risk by applying the same loss ratio everywhere,
     * rather than distributing a fixed loss amount.
     */
    function distributeLoss(
        uint256 claimPoolId,
        uint256 lossAmount
    ) external override onlyCapitalPool {
        if (lossAmount == 0) return;

        uint256 totalSharesToBurn = capitalPool.valueToShares(lossAmount);
        if (totalSharesToBurn == 0) return;

        // Get total capital in the pool where the claim happened. This is the denominator for the ratio.
        // The overlap of a pool with itself is the total capital pledged to it.
        uint256 totalCapitalInClaimPool = underwriterManager.overlapExposure(claimPoolId, claimPoolId);
        if (totalCapitalInClaimPool == 0) return;

        // Calculate the loss ratio. This is the "damage per unit of pledge" in the claim pool.
        uint256 lossRatio = (totalSharesToBurn * PRECISION_FACTOR) / totalCapitalInClaimPool;

        // Now, apply this SAME loss ratio to every other pool that has overlapping capital.
        uint256 poolCount = poolRegistry.getPoolCount();
        for (uint256 i = 0; i < poolCount; i++) {
            uint256 targetPoolId = i;
            
            // Check if there is any overlapping capital. If not, this target pool is unaffected.
            uint256 overlapWithTarget = underwriterManager.overlapExposure(claimPoolId, targetPoolId);
            if (overlapWithTarget == 0) continue;

            // Apply the same loss ratio to all linked pools.
            if (targetPoolId == claimPoolId) {
                // This is the direct loss
                poolLossTrackers[targetPoolId].accumulatedSharesToBurnPerPledge += lossRatio;
            } else {
                // This is the contagion loss, now amplified
                contagionLossTrackers[targetPoolId][claimPoolId].accumulatedSharesToBurnPerPledge += lossRatio;
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

        LossTracker storage directTracker = poolLossTrackers[poolId];
        uint256 directDelta = directTracker.accumulatedSharesToBurnPerPledge - uds.directRatioSnapshot;
        if (directDelta > 0) {
            pendingSharesToBurn += (userPledge * directDelta) / PRECISION_FACTOR;
        }

        uint256 poolCount = poolRegistry.getPoolCount();
        for (uint256 sourcePoolId = 0; sourcePoolId < poolCount; sourcePoolId++) {
            if (sourcePoolId == poolId) continue;
            
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