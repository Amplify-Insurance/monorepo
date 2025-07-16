
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// --- Interfaces ---
import {IPolicyNFT} from "../interfaces/IPolicyNFT.sol";
import {IPoolRegistry} from "../interfaces/IPoolRegistry.sol";
import {ICapitalPool} from "../interfaces/ICapitalPool.sol";
import {IBackstopPool} from "../interfaces/IBackstopPool.sol";
import {ILossDistributor} from "../interfaces/ILossDistributor.sol";
import {IRewardDistributor} from "../interfaces/IRewardDistributor.sol";

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

    ICapitalPool public capitalPool;
    IPoolRegistry public poolRegistry;
    IBackstopPool public catPool;
    ILossDistributor public lossDistributor;
    IRewardDistributor public rewardDistributor;
    address public riskManager;

    mapping(address => uint256) public underwriterTotalPledge;
    mapping(address => mapping(uint256 => uint256)) public underwriterPoolPledge;
    mapping(uint256 => address[]) public poolSpecificUnderwriters;
    mapping(address => uint256[]) public underwriterAllocations;
    mapping(address => mapping(uint256 => bool)) public isAllocatedToPool;

    // Index tracking for efficient array removal
    mapping(uint256 => mapping(address => uint256)) public underwriterIndexInPoolArray;
    mapping(address => mapping(uint256 => uint256)) public underwriterAllocationIndex;

    uint256 public constant ABSOLUTE_MAX_ALLOCATIONS = 50; // New constant to prevent DoS
    uint256 public maxAllocationsPerUnderwriter = 5;
    uint256 public deallocationNoticePeriod;

    mapping(address => mapping(uint256 => uint256)) public deallocationRequestTimestamp;
    mapping(address => mapping(uint256 => uint256)) public deallocationRequestAmount;

    /* ───────────────────────── Events & Errors ───────────────────────── */

    event AddressesSet(address capital, address registry, address cat, address loss, address rewards, address riskMgr);
    event CapitalAllocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event DeallocationRequested(address indexed underwriter, uint256 indexed poolId, uint256 amount, uint256 timestamp);
    event CapitalDeallocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event DeallocationNoticePeriodSet(uint256 newPeriod);
    event MaxAllocationsPerUnderwriterSet(uint256 newMax);

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

    function setMaxAllocationsPerUnderwriter(uint256 _newMax) external onlyOwner {
        require(_newMax > 0 && _newMax <= ABSOLUTE_MAX_ALLOCATIONS, "Invalid max");
        maxAllocationsPerUnderwriter = _newMax;
        emit MaxAllocationsPerUnderwriterSet(_newMax);
    }

    function setDeallocationNoticePeriod(uint256 _newPeriod) external onlyOwner {
        deallocationNoticePeriod = _newPeriod;
        emit DeallocationNoticePeriodSet(_newPeriod);
    }

    /* ──────────────── Underwriter Capital Management ──────────────── */

    function allocateCapital(uint256[] calldata poolIds) external nonReentrant {
        (uint256 totalPledge, address adapter) = _prepareAllocateCapital(poolIds);
        for (uint256 i = 0; i < poolIds.length; i++) {
            _executeAllocation(poolIds[i], totalPledge, adapter);
        }
    }

    function requestDeallocateFromPool(uint256 poolId, uint256 amount) external nonReentrant {
        _checkDeallocationRequest(msg.sender, poolId, amount);
        deallocationRequestTimestamp[msg.sender][poolId] = block.timestamp;
        deallocationRequestAmount[msg.sender][poolId] = amount;
        poolRegistry.updateCapitalPendingWithdrawal(poolId, amount, true);
        emit DeallocationRequested(msg.sender, poolId, amount, block.timestamp);
    }

    function deallocateFromPool(uint256 poolId) external nonReentrant {
        (uint256 requestedAmount) = _validateDeallocationRequest(msg.sender, poolId);
        delete deallocationRequestTimestamp[msg.sender][poolId];
        delete deallocationRequestAmount[msg.sender][poolId];
        _realizeLossesForAllPools(msg.sender);
        _executeDeallocation(msg.sender, poolId, requestedAmount);
    }


    /* ───────────────── Hooks & State Updaters ───────────────── */

    function onCapitalDeposited(address underwriter, uint256 amount) external nonReentrant {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();
        underwriterTotalPledge[underwriter] += amount;
        _updateAllPoolPledgesOnDeposit(underwriter, amount);
    }

    function onWithdrawalRequested(address underwriter, uint256 principalComponent) external nonReentrant {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();
        _updateAllPoolsOnWithdrawalAction(underwriter, principalComponent, true);
    }

    function onWithdrawalCancelled(address underwriter, uint256 principalComponent) external nonReentrant {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();
        _updateAllPoolsOnWithdrawalAction(underwriter, principalComponent, false);
    }

    function onCapitalWithdrawn(address underwriter, uint256 principalComponentRemoved, bool isFullWithdrawal)
        external
        nonReentrant
    {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();
        _realizeLossesForAllPools(underwriter);
        uint256 pledgeAfterLosses = underwriterTotalPledge[underwriter];
        uint256 amountToSubtract = Math.min(pledgeAfterLosses, principalComponentRemoved);
        underwriterTotalPledge[underwriter] -= amountToSubtract;
        _processWithdrawalForAllPools(underwriter, principalComponentRemoved, isFullWithdrawal);
        if (isFullWithdrawal) {
            delete underwriterAllocations[underwriter];
        }
    }

    /* ───────────────── Rewards Claiming ───────────────── */

    /**
     * @notice Claim premium rewards for a single pool.
     * @dev Changed from batch processing to per-pool to prevent DoS.
     */
    function claimPremiumRewards(uint256 poolId) external nonReentrant {
        uint256 pledge = underwriterPoolPledge[msg.sender][poolId];
        if (pledge == 0) revert NotAllocated();

        (IERC20 protocolToken,,,,,,) = poolRegistry.getPoolData(poolId);

        rewardDistributor.claim(
            msg.sender,
            poolId,
            address(protocolToken),
            pledge
        );
    }

    /**
     * @notice Claim distressed asset rewards from the backstop pool for a single cover pool.
     * @dev Changed from batch processing to per-pool to prevent DoS.
     */
    function claimDistressedAssets(uint256 poolId) external nonReentrant {
        if (!isAllocatedToPool[msg.sender][poolId]) revert NotAllocated();

        (IERC20 protocolToken,,,,,,) = poolRegistry.getPoolData(poolId);
        
        if (address(protocolToken) != address(0)) {
            catPool.claimProtocolAssetRewardsFor(msg.sender, address(protocolToken));
        }
    }

    /* ───────────────── External Functions for RiskManager ───────────────── */

    function realizeLossesForAllPools(address user) external {
        if (msg.sender != riskManager) revert NotRiskManager();
        _realizeLossesForAllPools(user);
    }

    /* ───────────────── Internal & Private Functions ───────────────── */

    function _executeAllocation(uint256 poolId, uint256 totalPledge, address adapter) internal {
        underwriterPoolPledge[msg.sender][poolId] = totalPledge;
        isAllocatedToPool[msg.sender][poolId] = true;
        underwriterAllocationIndex[msg.sender][poolId] = underwriterAllocations[msg.sender].length;
        underwriterAllocations[msg.sender].push(poolId);
        underwriterIndexInPoolArray[poolId][msg.sender] = poolSpecificUnderwriters[poolId].length;
        poolSpecificUnderwriters[poolId].push(msg.sender);
        poolRegistry.updateCapitalAllocation(poolId, adapter, totalPledge, true);
        emit CapitalAllocated(msg.sender, poolId, totalPledge);
    }

    function _executeDeallocation(address underwriter, uint256 poolId, uint256 requestedAmount) internal {
        uint256 pledgeAfterLosses = underwriterPoolPledge[underwriter][poolId];
        uint256 finalAmountToDeallocate = Math.min(requestedAmount, pledgeAfterLosses);
        uint256 remainingPledge = pledgeAfterLosses - finalAmountToDeallocate;
        address userAdapterAddress = capitalPool.getUnderwriterAdapterAddress(underwriter);
        require(userAdapterAddress != address(0), "User has no yield adapter");
        underwriterPoolPledge[underwriter][poolId] = remainingPledge;
        if (remainingPledge == 0) {
            _removeUnderwriterFromPool(underwriter, poolId);
        }
        poolRegistry.updateCapitalAllocation(poolId, userAdapterAddress, finalAmountToDeallocate, false);
        poolRegistry.updateCapitalPendingWithdrawal(poolId, finalAmountToDeallocate, false);
        emit CapitalDeallocated(underwriter, poolId, finalAmountToDeallocate);
    }

    function _validateDeallocationRequest(address underwriter, uint256 poolId) internal view returns (uint256) {
        uint256 requestTime = deallocationRequestTimestamp[underwriter][poolId];
        if (requestTime == 0) revert NoDeallocationRequest();
        if (block.timestamp < requestTime + deallocationNoticePeriod) revert NoticePeriodActive();
        return deallocationRequestAmount[underwriter][poolId];
    }

    function _updateAllPoolPledgesOnDeposit(address underwriter, uint256 amount) internal {
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

    function _updateAllPoolsOnWithdrawalAction(address underwriter, uint256 principalComponent, bool isRequest) internal {
        uint256[] memory allocations = underwriterAllocations[underwriter];
        if (allocations.length == 0) return;
        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(allocations);
        for (uint256 i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            if (isRequest || (principalComponent > 0 && allPoolData[i].capitalPendingWithdrawal >= principalComponent)) {
                poolRegistry.updateCapitalPendingWithdrawal(poolId, principalComponent, isRequest);
            }
            address protocolToken = address(allPoolData[i].protocolTokenToCover);
            rewardDistributor.updateUserState(
                underwriter, poolId, protocolToken, underwriterPoolPledge[underwriter][poolId]
            );
        }
    }

    function _processWithdrawalForAllPools(address underwriter, uint256 principalComponentRemoved, bool isFullWithdrawal) internal {
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
    }

    function _realizeLossesForAllPools(address _user) internal {
        uint256[] memory allocations = underwriterAllocations[_user];
        uint256 currentTotalPledge = underwriterTotalPledge[_user];
        for (uint256 i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            uint256 poolPledge = underwriterPoolPledge[_user][poolId];
            if (poolPledge == 0) continue;
            uint256 pendingLoss = lossDistributor.realizeLosses(_user, poolId, poolPledge);
            if (pendingLoss > 0) {
                uint256 lossApplied = Math.min(poolPledge, pendingLoss);
                underwriterPoolPledge[_user][poolId] -= lossApplied;
                currentTotalPledge -= lossApplied;
                capitalPool.applyLosses(_user, pendingLoss);
            }
        }
        underwriterTotalPledge[_user] = currentTotalPledge;
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
        uint256 indexToRemove = underwriterAllocationIndex[_underwriter][_poolId];
        uint256 lastElementPoolId = allocs[allocs.length - 1];
        allocs[indexToRemove] = lastElementPoolId;
        underwriterAllocationIndex[_underwriter][lastElementPoolId] = indexToRemove;
        allocs.pop();
        uint256 index = underwriterIndexInPoolArray[_poolId][_underwriter];
        address[] storage underwriters = poolSpecificUnderwriters[_poolId];
        address last = underwriters[underwriters.length - 1];
        underwriters[index] = last;
        underwriterIndexInPoolArray[_poolId][last] = index;
        underwriters.pop();
        delete underwriterIndexInPoolArray[_poolId][_underwriter];
        delete underwriterAllocationIndex[_underwriter][_poolId];
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

    function getUnderwriterAllocations(address user) external view returns (uint256[] memory) {
        return underwriterAllocations[user];
    }
}