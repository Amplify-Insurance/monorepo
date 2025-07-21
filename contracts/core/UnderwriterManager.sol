// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// --- Interfaces ---
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

    uint256 public constant ABSOLUTE_MAX_ALLOCATIONS = 50;
    uint256 public maxAllocationsPerUnderwriter = 5;
    uint256 public deallocationNoticePeriod;

    mapping(address => mapping(uint256 => uint256)) public deallocationRequestTimestamp;

    /* ───────────────────────── Events & Errors ───────────────────────── */

    event AddressesSet(address capital, address registry, address cat, address loss, address rewards, address riskMgr);
    event CapitalAllocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event DeallocationRequested(address indexed underwriter, uint256 indexed poolId, uint256 timestamp);
    event CapitalDeallocated(address indexed underwriter, uint256 indexed poolId);
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

    function requestDeallocateFromPool(uint256 poolId) external nonReentrant {
        _checkDeallocationRequest(msg.sender, poolId);
        deallocationRequestTimestamp[msg.sender][poolId] = block.timestamp;
        uint256 pledgeAmount = underwriterPoolPledge[msg.sender][poolId];
        poolRegistry.updateCapitalPendingWithdrawal(poolId, pledgeAmount, true);
        emit DeallocationRequested(msg.sender, poolId, block.timestamp);
    }

    function deallocateFromPool(uint256 poolId) external nonReentrant {
        _validateDeallocationRequest(msg.sender, poolId);
        delete deallocationRequestTimestamp[msg.sender][poolId];
        _realizeLossesForAllPools(msg.sender);
        _executeDeallocation(msg.sender, poolId);
    }


    /* ───────────────── Hooks & State Updaters ───────────────── */

    function settleLossesForUser(address user) external {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();
        _realizeLossesForAllPools(user);
    }

    function onCapitalDeposited(address underwriter, uint256 amount) external nonReentrant {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();
        _realizeLossesForAllPools(underwriter);
        underwriterTotalPledge[underwriter] += amount;
        _updateAllPoolPledgesOnDeposit(underwriter);
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
        
        uint256 pledgeBefore = underwriterTotalPledge[underwriter];
        if (pledgeBefore == 0) return;

        uint256 amountToSubtract = Math.min(pledgeBefore, principalComponentRemoved);
        
        if (amountToSubtract > 0) {
            underwriterTotalPledge[underwriter] -= amountToSubtract;

            // --- FINAL FIX: Reduce per-pool pledges proportionally ---
            // This ensures the per-pool pledges remain synchronized with the total pledge.
            uint256[] memory allocations = underwriterAllocations[underwriter];
            for (uint256 i = 0; i < allocations.length; i++) {
                uint256 poolId = allocations[i];
                uint256 currentPoolPledge = underwriterPoolPledge[underwriter][poolId];
                uint256 proportionalReduction = Math.mulDiv(currentPoolPledge, amountToSubtract, pledgeBefore);
                
                if (currentPoolPledge > proportionalReduction) {
                    underwriterPoolPledge[underwriter][poolId] -= proportionalReduction;
                } else {
                    underwriterPoolPledge[underwriter][poolId] = 0;
                }
            }
        }
        
        _processWithdrawalForAllPools(underwriter, principalComponentRemoved, isFullWithdrawal);
        
        if (isFullWithdrawal) {
            delete underwriterAllocations[underwriter];
        }
    }

    function onLossRealized(address underwriter, uint256 valueLost) external {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();

        uint256 pledgeBefore = underwriterTotalPledge[underwriter];
        if (pledgeBefore == 0) return;

        uint256 amountToSubtract = Math.min(pledgeBefore, valueLost);
        underwriterTotalPledge[underwriter] -= amountToSubtract;

        uint256[] memory allocations = underwriterAllocations[underwriter];
        for (uint256 i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            uint256 currentPoolPledge = underwriterPoolPledge[underwriter][poolId];
            
            uint256 proportionalLoss = Math.mulDiv(currentPoolPledge, amountToSubtract, pledgeBefore);
            
            if (currentPoolPledge > proportionalLoss) {
                underwriterPoolPledge[underwriter][poolId] -= proportionalLoss;
            } else {
                underwriterPoolPledge[underwriter][poolId] = 0;
            }
        }
    }

    /* ───────────────── Rewards Claiming ───────────────── */

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

    function claimDistressedAssets(uint256 poolId) external nonReentrant {
        if (!isAllocatedToPool[msg.sender][poolId]) revert NotAllocated();
        (IERC20 protocolToken,,,,,,) = poolRegistry.getPoolData(poolId);
        if (address(protocolToken) != address(0)) {
            catPool.claimProtocolAssetRewardsFor(msg.sender, address(protocolToken));
        }
    }

    /* ───────────────── External Functions for Other Contracts ───────────────── */

    function realizeLossesForAllPools(address user) external {
        if (msg.sender != riskManager) revert NotRiskManager();
        _realizeLossesForAllPools(user);
    }

    function getPoolUnderwriters(uint256 poolId) external view returns (address[] memory) {
        return poolSpecificUnderwriters[poolId];
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

    function _executeDeallocation(address underwriter, uint256 poolId) internal {
        uint256 pledgeAmount = underwriterPoolPledge[underwriter][poolId];
        address userAdapterAddress = capitalPool.getUnderwriterAdapterAddress(underwriter);
        require(userAdapterAddress != address(0), "User has no yield adapter");
        
        _removeUnderwriterFromPool(underwriter, poolId);
        
        poolRegistry.updateCapitalAllocation(poolId, userAdapterAddress, pledgeAmount, false);
        poolRegistry.updateCapitalPendingWithdrawal(poolId, pledgeAmount, false);
        emit CapitalDeallocated(underwriter, poolId);
    }

    function _validateDeallocationRequest(address underwriter, uint256 poolId) internal view {
        uint256 requestTime = deallocationRequestTimestamp[underwriter][poolId];
        if (requestTime == 0) revert NoDeallocationRequest();
        if (block.timestamp < requestTime + deallocationNoticePeriod) revert NoticePeriodActive();
    }

    function _updateAllPoolPledgesOnDeposit(address underwriter) internal {
        uint256[] memory pools = underwriterAllocations[underwriter];
        if (pools.length == 0) return;
        
        uint256 newTotalPledge = underwriterTotalPledge[underwriter];

        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(pools);
        for (uint256 i = 0; i < pools.length; i++) {
            underwriterPoolPledge[underwriter][pools[i]] = newTotalPledge;
            address protocolToken = address(allPoolData[i].protocolTokenToCover);
            rewardDistributor.updateUserState(
                underwriter, pools[i], protocolToken, newTotalPledge
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

    function claimYieldRewards() external nonReentrant {
        address adapterAddress = capitalPool.getUnderwriterAdapterAddress(msg.sender);
        require(adapterAddress != address(0), "No yield adapter chosen");
        uint256 rewardPoolId = capitalPool.yieldAdapterRewardPoolId(adapterAddress);
        require(rewardPoolId != 0, "Reward pool for adapter not set");
        (,,uint256 userShares,) = capitalPool.getUnderwriterAccount(msg.sender);
        rewardDistributor.claim(msg.sender, rewardPoolId, address(capitalPool.underlyingAsset()), userShares);
    }

    function _realizeLossesForAllPools(address _user) internal {
        uint256[] memory allocations = underwriterAllocations[_user];
        if (allocations.length == 0) return;

        uint256 totalPendingLossValue = 0;
        for (uint256 i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            uint256 userPledge = underwriterPoolPledge[_user][poolId];
            if (userPledge > 0) {
                totalPendingLossValue += lossDistributor.getPendingLosses(_user, poolId, userPledge);
            }
        }

        if (totalPendingLossValue > 0) {
            lossDistributor.realizeAggregateLoss(_user, totalPendingLossValue, allocations);
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
        
        uint256 newPoolPledge = underwriterPoolPledge[underwriter][poolId];

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

    function _checkDeallocationRequest(address _underwriter, uint256 _poolId) internal view {
        if (_poolId >= poolRegistry.getPoolCount()) revert InvalidPoolId();
        if (!isAllocatedToPool[_underwriter][_poolId]) revert NotAllocated();
        if (deallocationRequestTimestamp[_underwriter][_poolId] != 0) revert DeallocationRequestPending();
        
        uint256 pledgeAmount = underwriterPoolPledge[_underwriter][_poolId];
        (,uint256 totalPledged, uint256 totalSold, uint256 pendingWithdrawal,,,) = poolRegistry.getPoolData(_poolId);
        uint256 freeCapital =
            totalPledged > totalSold + pendingWithdrawal ? totalPledged - totalSold - pendingWithdrawal : 0;
        if (pledgeAmount > freeCapital) revert InsufficientFreeCapital();
    }

    function getUnderwriterAllocations(address user) external view returns (uint256[] memory) {
        return underwriterAllocations[user];
    }
}