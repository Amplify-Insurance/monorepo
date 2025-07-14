// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// --- Interfaces ---
// It's best practice to keep interfaces in separate files.
// For this example, they are included for completeness.

interface IPolicyNFT {
    struct Policy {
        uint256 poolId;
        uint256 coverage;
        uint256 premium;
        uint256 activation;
        uint256 expiration;
    }
    function getPolicy(uint256 policyId) external view returns (Policy memory);
    function ownerOf(uint256 policyId) external view returns (address);
    function burn(uint256 policyId) external;
}

interface IPoolRegistry {
     struct PoolInfo {
        IERC20 protocolTokenToCover;
        uint256 totalCapitalPledged;
        uint256 totalCoverageSold;
        uint256 capitalPendingWithdrawal;
        bool isPaused;
        address feeRecipient;
        uint256 claimFeeBps;
    }
    struct RateModel {
        uint128 U_1;
        uint128 U_2;
        uint128 R_0;
        uint128 R_1;
        uint128 R_2;
    }
    function getPoolCount() external view returns (uint256);
    function getPoolData(uint256 poolId) external view returns (IERC20, uint256, uint256, uint256, bool, address, uint256);
    function getMultiplePoolData(uint256[] calldata poolIds) external view returns (PoolInfo[] memory);
    function updateCapitalAllocation(uint256 poolId, address adapter, uint256 amount, bool isAllocation) external;
    function updateCapitalPendingWithdrawal(uint256 poolId, uint256 amount, bool isIncrease) external;
}

interface ICapitalPool {
    function getUnderwriterAdapterAddress(address underwriter) external view returns (address);
    function applyLosses(address underwriter, uint256 amount) external;
    function underlyingAsset() external view returns (address);
    function getUnderwriterAccount(address underwriter) external view returns (uint256, uint256, uint256, uint256, uint256);
    function sharesToValue(uint256 shares) external view returns (uint256);
}

interface IBackstopPool {
    function claimProtocolAssetRewardsFor(address user, address protocolToken) external;
}

interface ILossDistributor {
    function realizeLosses(address user, uint256 poolId, uint256 pledge) external returns (uint256);
}

interface IRewardDistributor {
    function distribute(uint256 poolId, address token, uint256 amount, uint256 totalPledge) external;
    function claim(address user, uint256 poolId, address token, uint256 pledge) external returns (uint256);
    function updateUserState(address user, uint256 poolId, address token, uint256 newPledge) external;
}

/**
 * @title UnderwriterManager
 * @author Gemini
 * @notice Manages the lifecycle of underwriter capital. This contract handles capital
 * allocation, deallocation, reward claims, and state tracking related to underwriters.
 * It serves as the primary interaction point for liquidity providers.
 */
contract UnderwriterManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ───────────────────────── State Variables ───────────────────────── */

    // --- External Contract Dependencies ---
    ICapitalPool public capitalPool;
    IPoolRegistry public poolRegistry;
    IBackstopPool public catPool;
    ILossDistributor public lossDistributor;
    IRewardDistributor public rewardDistributor;
    address public riskManager; // The new, lean RiskManager contract

    // --- Underwriter State ---
    mapping(address => uint256) public underwriterTotalPledge;
    mapping(address => mapping(uint256 => uint256)) public underwriterPoolPledge;
    mapping(uint256 => address[]) public poolSpecificUnderwriters;
    mapping(address => uint256[]) public underwriterAllocations;
    mapping(address => mapping(uint256 => bool)) public isAllocatedToPool;
    mapping(uint256 => mapping(address => uint256)) public underwriterIndexInPoolArray;

    // --- Configuration ---
    uint256 public maxAllocationsPerUnderwriter = 5;
    uint256 public deallocationNoticePeriod;

    // --- Deallocation State ---
    mapping(address => mapping(uint256 => uint256)) public deallocationRequestTimestamp;
    mapping(address => mapping(uint256 => uint256)) public deallocationRequestAmount;

    /* ───────────────────────── Events ───────────────────────── */

    event AddressesSet(address capital, address registry, address cat, address loss, address rewards, address riskMgr);
    event CapitalAllocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event DeallocationRequested(address indexed underwriter, uint256 indexed poolId, uint256 amount, uint256 timestamp);
    event CapitalDeallocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event DeallocationNoticePeriodSet(uint256 newPeriod);
    event MaxAllocationsPerUnderwriterSet(uint256 newMax);

    /* ───────────────────────── Errors ───────────────────────── */

    error NotCapitalPool();
    error NotRiskManager();
    error NoCapitalToAllocate();
    error ExceedsMaxAllocations();
    error InvalidPoolId();
    error AlreadyAllocated();
    error NotAllocated();
    error ZeroAddressNotAllowed();
    error DeallocationRequestPending();
    error NoDeallocationRequest();
    error NoticePeriodActive();
    error InsufficientFreeCapital();

    /* ───────────────────── Constructor & Setup ───────────────────── */

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    /**
     * @notice Sets the addresses of crucial external contracts.
     * @dev Can only be called by the owner. Essential for protocol operation.
     */
    function setAddresses(
        address _capitalPool,
        address _poolRegistry,
        address _catPool,
        address _lossDistributor,
        address _rewardDistributor,
        address _riskManager
    ) external onlyOwner {
        if (_capitalPool == address(0) || _poolRegistry == address(0) || _catPool == address(0) ||
            _lossDistributor == address(0) || _rewardDistributor == address(0) || _riskManager == address(0)) {
            revert ZeroAddressNotAllowed();
        }
        capitalPool = ICapitalPool(_capitalPool);
        poolRegistry = IPoolRegistry(_poolRegistry);
        catPool = IBackstopPool(_catPool);
        lossDistributor = ILossDistributor(_lossDistributor);
        rewardDistributor = IRewardDistributor(_rewardDistributor);
        riskManager = _riskManager;
        emit AddressesSet(_capitalPool, _poolRegistry, _catPool, _lossDistributor, _rewardDistributor, _riskManager);
    }

    /**
     * @notice Sets the maximum number of pools an underwriter can allocate to.
     */
    function setMaxAllocationsPerUnderwriter(uint256 _newMax) external onlyOwner {
        require(_newMax > 0, "Invalid max");
        maxAllocationsPerUnderwriter = _newMax;
        emit MaxAllocationsPerUnderwriterSet(_newMax);
    }

    /**
     * @notice Sets the notice period required for deallocating capital.
     */
    function setDeallocationNoticePeriod(uint256 _newPeriod) external onlyOwner {
        deallocationNoticePeriod = _newPeriod;
        emit DeallocationNoticePeriodSet(_newPeriod);
    }

    /* ──────────────── Underwriter Capital Management ──────────────── */

    /**
     * @notice Allocates the underwriter's entire capital pledge to one or more pools.
     * @param poolIds An array of pool IDs to allocate capital to.
     */
    function allocateCapital(uint256[] calldata poolIds) external nonReentrant {
        (uint256 totalPledge, address adapter) = _prepareAllocateCapital(poolIds);

        for (uint256 i = 0; i < poolIds.length; i++) {
            uint256 poolId = poolIds[i];

            // --- Effects ---
            underwriterPoolPledge[msg.sender][poolId] = totalPledge;
            isAllocatedToPool[msg.sender][poolId] = true;
            underwriterAllocations[msg.sender].push(poolId);
            poolSpecificUnderwriters[poolId].push(msg.sender);
            underwriterIndexInPoolArray[poolId][msg.sender] = poolSpecificUnderwriters[poolId].length - 1;

            // --- Interaction ---
            poolRegistry.updateCapitalAllocation(poolId, adapter, totalPledge, true);

            emit CapitalAllocated(msg.sender, poolId, totalPledge);
        }
    }

    /**
     * @notice Submits a request to deallocate capital from a specific pool.
     * @dev Initiates a notice period before capital can be fully deallocated.
     * @param poolId The ID of the pool to deallocate from.
     * @param amount The amount of capital to request for deallocation.
     */
    function requestDeallocateFromPool(uint256 poolId, uint256 amount) external nonReentrant {
        _checkDeallocationRequest(msg.sender, poolId, amount);

        deallocationRequestTimestamp[msg.sender][poolId] = block.timestamp;
        deallocationRequestAmount[msg.sender][poolId] = amount;
        poolRegistry.updateCapitalPendingWithdrawal(poolId, amount, true);
        emit DeallocationRequested(msg.sender, poolId, amount, block.timestamp);
    }

    /**
     * @notice Finalizes the deallocation of capital from a pool after the notice period.
     * @dev Realizes any losses incurred since the request before completing deallocation.
     * @param poolId The ID of the pool to deallocate from.
     */
    function deallocateFromPool(uint256 poolId) external nonReentrant {
        address underwriter = msg.sender;
        uint256 requestTime = deallocationRequestTimestamp[underwriter][poolId];
        uint256 requestedAmount = deallocationRequestAmount[underwriter][poolId];

        if (requestTime == 0) revert NoDeallocationRequest();
        if (block.timestamp < requestTime + deallocationNoticePeriod) revert NoticePeriodActive();

        // Realize losses before proceeding. This must be called from the RiskManager.
        // For simplicity in this standalone contract, we assume an external call.
        // In a real system, this would be `IRiskManager(riskManager).realizeLossesFor(...)`
        _realizeLossesForAllPools(underwriter);

        uint256 pledgeAfterLosses = underwriterPoolPledge[underwriter][poolId];
        uint256 finalAmountToDeallocate = Math.min(requestedAmount, pledgeAfterLosses);
        uint256 remainingPledge = pledgeAfterLosses - finalAmountToDeallocate;

        address userAdapterAddress = capitalPool.getUnderwriterAdapterAddress(underwriter);
        require(userAdapterAddress != address(0), "User has no yield adapter");

        underwriterPoolPledge[underwriter][poolId] = remainingPledge;

        if (remainingPledge == 0) {
            _removeUnderwriterFromPool(underwriter, poolId);
        }

        delete deallocationRequestTimestamp[underwriter][poolId];
        delete deallocationRequestAmount[underwriter][poolId];

        poolRegistry.updateCapitalAllocation(poolId, userAdapterAddress, finalAmountToDeallocate, false);
        poolRegistry.updateCapitalPendingWithdrawal(poolId, finalAmountToDeallocate, false);

        emit CapitalDeallocated(underwriter, poolId, finalAmountToDeallocate);
    }


    /* ───────────────── Hooks & State Updaters ───────────────── */

    /**
     * @notice Hook called by CapitalPool when an underwriter deposits capital.
     * @dev Updates the underwriter's total pledge and their pledge in each allocated pool.
     */
    function onCapitalDeposited(address underwriter, uint256 amount) external nonReentrant {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();

        underwriterTotalPledge[underwriter] += amount;
        uint256[] memory pools = underwriterAllocations[underwriter];
        if (pools.length == 0) return;

        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(pools);

        for (uint256 i = 0; i < pools.length; i++) {
            underwriterPoolPledge[underwriter][pools[i]] += amount;
            address protocolToken = address(allPoolData[i].protocolTokenToCover);
            rewardDistributor.updateUserState(
                underwriter, pools[i], protocolToken, underwriterPoolPledge[underwriter][pools[i]]
            );
        }
    }

    /**
     * @notice Hook called by CapitalPool when a withdrawal is requested.
     */
    function onWithdrawalRequested(address underwriter, uint256 principalComponent) external nonReentrant {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();
        uint256[] memory allocations = underwriterAllocations[underwriter];
        if (allocations.length == 0) return;

        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(allocations);
        for (uint256 i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            poolRegistry.updateCapitalPendingWithdrawal(poolId, principalComponent, true);
            address protocolToken = address(allPoolData[i].protocolTokenToCover);
            rewardDistributor.updateUserState(
                underwriter, poolId, protocolToken, underwriterPoolPledge[underwriter][poolId]
            );
        }
    }

    /**
     * @notice Hook called by CapitalPool when a withdrawal is cancelled.
     */
    function onWithdrawalCancelled(address underwriter, uint256 principalComponent) external nonReentrant {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();
        uint256[] memory allocations = underwriterAllocations[underwriter];
        if (allocations.length == 0) return;

        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(allocations);
        for (uint256 i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            if (principalComponent > 0 && allPoolData[i].capitalPendingWithdrawal >= principalComponent) {
                poolRegistry.updateCapitalPendingWithdrawal(poolId, principalComponent, false);
            }
            address protocolToken = address(allPoolData[i].protocolTokenToCover);
            rewardDistributor.updateUserState(
                underwriter, poolId, protocolToken, underwriterPoolPledge[underwriter][poolId]
            );
        }
    }

    /**
     * @notice Hook called by CapitalPool when capital is withdrawn.
     * @dev Realizes losses before processing the withdrawal for each pool.
     */
    function onCapitalWithdrawn(address underwriter, uint256 principalComponentRemoved, bool isFullWithdrawal)
        external
        nonReentrant
    {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();
        _realizeLossesForAllPools(underwriter);

        uint256 pledgeAfterLosses = underwriterTotalPledge[underwriter];
        uint256 amountToSubtract = Math.min(pledgeAfterLosses, principalComponentRemoved);
        underwriterTotalPledge[underwriter] -= amountToSubtract;

        uint256[] memory allocations = underwriterAllocations[underwriter];
        if (allocations.length == 0) return;

        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(allocations);

        for (uint256 i = 0; i < allocations.length; i++) {
            _processWithdrawalForPool(
                underwriter,
                allocations[i],
                principalComponentRemoved,
                isFullWithdrawal,
                allPoolData[i].capitalPendingWithdrawal,
                address(allPoolData[i].protocolTokenToCover)
            );
        }

        if (isFullWithdrawal) {
            delete underwriterAllocations[underwriter];
        }
    }

    /* ───────────────── Rewards Claiming ───────────────── */

    /**
     * @notice Claims premium rewards for multiple pools.
     * @param poolIds An array of pool IDs to claim rewards from.
     */
    function claimPremiumRewards(uint256[] calldata poolIds) external nonReentrant {
        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(poolIds);

        for (uint256 i = 0; i < poolIds.length; i++) {
            uint256 poolId = poolIds[i];
            if (underwriterPoolPledge[msg.sender][poolId] > 0) {
                IPoolRegistry.PoolInfo memory poolData = allPoolData[i];
                rewardDistributor.claim(
                    msg.sender,
                    poolId,
                    address(poolData.protocolTokenToCover),
                    underwriterPoolPledge[msg.sender][poolId]
                );
            }
        }
    }

    /**
     * @notice Claims distressed assets (protocol tokens from failed protocols) from the backstop pool.
     */
    function claimDistressedAssets(uint256[] calldata poolIds) external nonReentrant {
        address[] memory uniqueTokens = _prepareDistressedAssets(poolIds);
        for (uint256 i = 0; i < uniqueTokens.length; i++) {
            catPool.claimProtocolAssetRewardsFor(msg.sender, uniqueTokens[i]);
        }
    }

    /* ───────────────── External Functions for RiskManager ───────────────── */

    /**
     * @notice Realizes pending losses for a user across all their allocated pools.
     * @dev Can only be called by the RiskManager contract, typically before a liquidation or withdrawal.
     * @param user The address of the underwriter to realize losses for.
     */
    function realizeLossesForAllPools(address user) external {
        if (msg.sender != riskManager) revert NotRiskManager();
        _realizeLossesForAllPools(user);
    }

    /* ───────────────── Internal & Private Functions ───────────────── */

    function _realizeLossesForAllPools(address _user) internal {
        uint256[] memory allocations = underwriterAllocations[_user];
        for (uint256 i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            uint256 poolPledge = underwriterPoolPledge[_user][poolId];
            if (poolPledge == 0) continue;

            uint256 pendingLoss = lossDistributor.realizeLosses(_user, poolId, poolPledge);
            if (pendingLoss > 0) {
                uint256 lossApplied = Math.min(poolPledge, pendingLoss);
                underwriterPoolPledge[_user][poolId] -= lossApplied;
                underwriterTotalPledge[_user] -= lossApplied;
                capitalPool.applyLosses(_user, pendingLoss);
            }
        }
    }

    function _processWithdrawalForPool(
        address underwriter,
        uint256 poolId,
        uint256 principalComponentRemoved,
        bool isFullWithdrawal,
        uint256 pendingWithdrawal,
        address protocolToken
    ) internal {
        uint256 reduction = Math.min(principalComponentRemoved, pendingWithdrawal);
        if (reduction > 0) {
            poolRegistry.updateCapitalPendingWithdrawal(poolId, reduction, false);
        }

        uint256 currentPoolPledge = underwriterPoolPledge[underwriter][poolId];
        uint256 newPoolPledge = (principalComponentRemoved >= currentPoolPledge)
            ? 0
            : currentPoolPledge - principalComponentRemoved;

        underwriterPoolPledge[underwriter][poolId] = newPoolPledge;

        rewardDistributor.updateUserState(underwriter, poolId, protocolToken, newPoolPledge);

        if (isFullWithdrawal || newPoolPledge == 0) {
            _removeUnderwriterFromPool(underwriter, poolId);
        }
    }

    function _removeUnderwriterFromPool(address _underwriter, uint256 _poolId) internal {
        isAllocatedToPool[_underwriter][_poolId] = false;
        uint256[] storage allocs = underwriterAllocations[_underwriter];
        for (uint256 j = 0; j < allocs.length; j++) {
            if (allocs[j] == _poolId) {
                allocs[j] = allocs[allocs.length - 1];
                allocs.pop();
                break;
            }
        }
        uint256 index = underwriterIndexInPoolArray[_poolId][_underwriter];
        address[] storage underwriters = poolSpecificUnderwriters[_poolId];
        address last = underwriters[underwriters.length - 1];
        underwriters[index] = last;
        underwriterIndexInPoolArray[_poolId][last] = index;
        underwriters.pop();
        delete underwriterIndexInPoolArray[_poolId][_underwriter];
        delete underwriterPoolPledge[_underwriter][_poolId];
    }

    function _prepareAllocateCapital(uint256[] calldata _poolIds)
        internal
        view
        returns (uint256 totalPledge, address adapter)
    {
        totalPledge = underwriterTotalPledge[msg.sender];
        if (totalPledge == 0) revert NoCapitalToAllocate();

        uint256 len = _poolIds.length;
        if (len == 0 || len + underwriterAllocations[msg.sender].length > maxAllocationsPerUnderwriter) {
            revert ExceedsMaxAllocations();
        }

        adapter = capitalPool.getUnderwriterAdapterAddress(msg.sender);
        require(adapter != address(0), "User has no yield adapter");

        uint256 poolCount = poolRegistry.getPoolCount();
        for (uint256 i = 0; i < len; i++) {
            uint256 pid = _poolIds[i];
            if (pid >= poolCount) revert InvalidPoolId();
            if (isAllocatedToPool[msg.sender][pid]) revert AlreadyAllocated();
        }
    }

    function _checkDeallocationRequest(address _underwriter, uint256 _poolId, uint256 _amount) internal view {
        if (_poolId >= poolRegistry.getPoolCount()) revert InvalidPoolId();
        if (!isAllocatedToPool[_underwriter][_poolId]) revert NotAllocated();
        if (deallocationRequestTimestamp[_underwriter][_poolId] != 0) revert DeallocationRequestPending();

        require(_amount > 0, "Invalid amount");
        uint256 currentPledge = underwriterPoolPledge[_underwriter][_poolId];
        require(_amount <= currentPledge, "Amount exceeds pledge");

        (,uint256 totalPledged, uint256 totalSold, uint256 pendingWithdrawal,,,) = poolRegistry.getPoolData(_poolId);

        uint256 freeCapital =
            totalPledged > totalSold + pendingWithdrawal ? totalPledged - totalSold - pendingWithdrawal : 0;
        if (_amount > freeCapital) revert InsufficientFreeCapital();
    }

    function _prepareDistressedAssets(uint256[] calldata _poolIds) internal view returns (address[] memory tokens) {
        if (_poolIds.length == 0) {
            return new address[](0);
        }
        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(_poolIds);

        address[] memory uniqueTokens = new address[](_poolIds.length);
        uint256 count = 0;

        for (uint256 i = 0; i < allPoolData.length; i++) {
            address t = address(allPoolData[i].protocolTokenToCover);
            if (t == address(0)) {
                continue;
            }

            bool seen = false;
            for (uint256 j = 0; j < count; j++) {
                if (uniqueTokens[j] == t) {
                    seen = true;
                    break;
                }
            }

            if (!seen) {
                uniqueTokens[count] = t;
                count++;
            }
        }

        tokens = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            tokens[i] = uniqueTokens[i];
        }
        return tokens;
    }

    function getUnderwriterAllocations(address user) external view returns (uint256[] memory) {
        return underwriterAllocations[user];
    }
}