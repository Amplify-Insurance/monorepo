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
 * @notice Manages the allocation (pledging) of capital to risk pools using a risk-based points system.
 * @dev CORRECTED: Implemented a risk points system to control underwriter leverage based on pool risk ratings.
 */
contract UnderwriterManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ───────────────────────── State: Interfaces ───────────────────────── */
    ICapitalPool public capitalPool;
    IPoolRegistry public poolRegistry;
    IBackstopPool public catPool;
    ILossDistributor public lossDistributor;
    IRewardDistributor public rewardDistributor;
    address public riskManager;

    /* ────────────────── State: Underwriter-Specific ────────────────── */
    mapping(address => mapping(uint256 => uint256)) public underwriterPoolPledge;
    mapping(address => uint256[]) public underwriterAllocations;
    mapping(address => mapping(uint256 => bool)) public isAllocatedToPool;
    mapping(address => mapping(uint256 => uint256)) public underwriterAllocationIndex;
    mapping(address => mapping(uint256 => uint256)) public deallocationRequestTimestamp;
    mapping(address => uint256) public underwriterRiskPointsUsed; // NEW

    /* ───────────────── State: Pool & Adapter Aggregates ──────────────── */
    mapping(uint256 => uint256) public totalCapitalPledgedToPool;
    mapping(uint256 => uint256) public capitalPendingWithdrawal;
    mapping(uint256 => mapping(address => uint256)) public capitalPerAdapter;
    mapping(uint256 => address[]) public poolActiveAdapters;
    mapping(uint256 => mapping(address => uint256)) public poolAdapterIndex;
    mapping(uint256 => mapping(address => bool)) public isAdapterInPool;
    mapping(uint256 => address[]) public poolSpecificUnderwriters;
    mapping(uint256 => mapping(address => uint256)) public underwriterIndexInPoolArray;

    /* ───────────────────────── Constants & Config ──────────────────────── */
    uint256 public constant ABSOLUTE_MAX_ALLOCATIONS = 50;
    uint256 public constant TOTAL_RISK_POINTS = 12; // NEW
    uint256 public maxAllocationsPerUnderwriter = 5;
    uint256 public deallocationNoticePeriod;

    /* ───────────────────────── Events & Errors ───────────────────────── */
    event AddressesSet(address capital, address registry, address cat, address loss, address rewards, address riskMgr);
    event CapitalAllocated(address indexed underwriter, uint256 indexed poolId, uint256 amount, address adapter);
    event DeallocationRequested(address indexed underwriter, uint256 indexed poolId, uint256 amount, uint256 timestamp);
    event CapitalDeallocated(address indexed underwriter, uint256 indexed poolId, uint256 amount, address adapter);
    event LossRecorded(address indexed underwriter, uint256 indexed poolId, uint256 lossAmount);
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
    error InsufficientRiskPoints(uint256 current, uint256 required, uint256 total); // NEW

    /* ───────────────────── Modifiers ───────────────────── */
    modifier onlyCapitalPool() {
        require(msg.sender == address(capitalPool), "UM: Not CapitalPool");
        _;
    }

    modifier onlyRiskManager() {
        require(msg.sender == riskManager, "UM: Not RiskManager");
        _;
    }

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
        (uint256 totalCapitalToPledge, address adapter, uint256 pointsToUse) = _prepareAllocateCapital(poolIds);
        
        underwriterRiskPointsUsed[msg.sender] += pointsToUse;

        for (uint256 i = 0; i < poolIds.length; i++) {
            _executeAllocation(poolIds[i], totalCapitalToPledge, adapter);
        }
    }

    function requestDeallocateFromPool(uint256 poolId) external nonReentrant {
        _checkDeallocationRequest(msg.sender, poolId);
        uint256 pledgeAmount = underwriterPoolPledge[msg.sender][poolId];
        deallocationRequestTimestamp[msg.sender][poolId] = block.timestamp;
        capitalPendingWithdrawal[poolId] += pledgeAmount;
        emit DeallocationRequested(msg.sender, poolId, pledgeAmount, block.timestamp);
    }

    function deallocateFromPool(uint256 poolId) external nonReentrant {
        _validateDeallocationRequest(msg.sender, poolId);
        address underwriter = msg.sender;
        uint256 pledgeAmount = underwriterPoolPledge[underwriter][poolId];
        address adapter = capitalPool.getUnderwriterAdapterAddress(underwriter);

        delete deallocationRequestTimestamp[underwriter][poolId];
        _realizeLossesForAllPools(underwriter);

        totalCapitalPledgedToPool[poolId] -= pledgeAmount;
        capitalPendingWithdrawal[poolId] -= pledgeAmount;
        capitalPerAdapter[poolId][adapter] -= pledgeAmount;

        if (capitalPerAdapter[poolId][adapter] == 0) {
            _removeAdapterFromPool(poolId, adapter);
        }

        _removeUnderwriterFromPool(underwriter, poolId);

        emit CapitalDeallocated(underwriter, poolId, pledgeAmount, adapter);
    }

    /* ───────────────── Hooks & State Updaters ───────────────── */
    
    function recordLossAgainstPledge(address underwriter, uint256 poolId, uint256 lossAmount) external onlyRiskManager {
        if (lossAmount == 0) return;

        uint256 pledgeInPool = underwriterPoolPledge[underwriter][poolId];
        address adapter = capitalPool.getUnderwriterAdapterAddress(underwriter);
        require(adapter != address(0), "User has no yield adapter");

        uint256 poolLoss = Math.min(pledgeInPool, lossAmount);

        underwriterPoolPledge[underwriter][poolId] -= poolLoss;
        totalCapitalPledgedToPool[poolId] -= poolLoss;
        capitalPerAdapter[poolId][adapter] -= poolLoss;

        if (capitalPerAdapter[poolId][adapter] == 0) {
            _removeAdapterFromPool(poolId, adapter);
        }
        
        if (underwriterPoolPledge[underwriter][poolId] == 0) {
            _removeUnderwriterFromPool(underwriter, poolId);
        }

        emit LossRecorded(underwriter, poolId, poolLoss);
    }

    function onCapitalDeposited(address underwriter, uint256 amount) external onlyCapitalPool nonReentrant {
        _realizeLossesForAllPools(underwriter);

        (uint256 principalAfter, , , ) = capitalPool.getUnderwriterAccount(underwriter);
        uint256 principalBefore = principalAfter > amount ? principalAfter - amount : 0;
        
        if (principalBefore == 0) return;

        uint256[] memory allocations = underwriterAllocations[underwriter];
        if (allocations.length > 0) {
            address adapter = capitalPool.getUnderwriterAdapterAddress(underwriter);
            require(adapter != address(0), "UM: User has no yield adapter");

            for (uint256 i = 0; i < allocations.length; i++) {
                uint256 poolId = allocations[i];
                uint256 pledgeBefore = underwriterPoolPledge[underwriter][poolId];
                if (pledgeBefore > 0) {
                    uint256 pledgeIncrease = Math.mulDiv(pledgeBefore, amount, principalBefore);
                    
                    if (pledgeIncrease > 0) {
                        underwriterPoolPledge[underwriter][poolId] += pledgeIncrease;
                        totalCapitalPledgedToPool[poolId] += pledgeIncrease;
                        capitalPerAdapter[poolId][adapter] += pledgeIncrease;
                        emit CapitalAllocated(underwriter, poolId, pledgeIncrease, adapter);
                    }
                }
            }
        }
    }

    function onCapitalWithdrawn(address underwriter, uint256 principalComponentRemoved, bool isFullWithdrawal) external onlyCapitalPool nonReentrant {
        (uint256 principalAfter, , ,) = capitalPool.getUnderwriterAccount(underwriter);
        uint256 principalBefore = principalAfter + principalComponentRemoved;
        if (principalBefore == 0) return;

        uint256[] memory allocations = underwriterAllocations[underwriter];
        if (allocations.length > 0) {
            address adapter = capitalPool.getUnderwriterAdapterAddress(underwriter);
            require(adapter != address(0), "User has no yield adapter");

            for (uint256 i = 0; i < allocations.length; i++) {
                uint256 poolId = allocations[i];
                uint256 poolPledgeBefore = underwriterPoolPledge[underwriter][poolId];
                if (poolPledgeBefore > 0) {
                    uint256 reduction = Math.mulDiv(poolPledgeBefore, principalComponentRemoved, principalBefore);
                    underwriterPoolPledge[underwriter][poolId] -= reduction;
                    totalCapitalPledgedToPool[poolId] -= reduction;
                    capitalPerAdapter[poolId][adapter] -= reduction;
                }
            }
        }
        
        if (isFullWithdrawal) {
            _handleFullWithdrawalCleanup(underwriter);
        }
    }

    function onLossRealized(address, uint256) external onlyCapitalPool {
        // Intentionally blank.
    }

    /* ───────────────── View Functions ───────────────── */

    function getPoolPayoutData(uint256 poolId) external view returns (address[] memory, uint256[] memory, uint256) {
        address[] memory adapters = poolActiveAdapters[poolId];
        uint256[] memory capital = new uint256[](adapters.length);
        for(uint i = 0; i < adapters.length; i++){
            capital[i] = capitalPerAdapter[poolId][adapters[i]];
        }
        return (adapters, capital, totalCapitalPledgedToPool[poolId]);
    }

    function getPoolUnderwriters(uint256 poolId) external view returns (address[] memory) {
        return poolSpecificUnderwriters[poolId];
    }
    
    function getUnderwriterAllocations(address user) external view returns (uint256[] memory) {
        return underwriterAllocations[user];
    }

    /* ───────────────── Internal & Helper Functions ───────────────── */

    function _getPointsForRating(IPoolRegistry.RiskRating _rating) internal pure returns (uint256) {
        if (_rating == IPoolRegistry.RiskRating.Low) return 1;
        if (_rating == IPoolRegistry.RiskRating.Moderate) return 2;
        if (_rating == IPoolRegistry.RiskRating.Elevated) return 3;
        if (_rating == IPoolRegistry.RiskRating.Speculative) return 4;
        return 0; // Should not happen with valid ratings
    }

    function _executeAllocation(uint256 poolId, uint256 totalPledge, address adapter) internal {
        underwriterPoolPledge[msg.sender][poolId] = totalPledge;
        isAllocatedToPool[msg.sender][poolId] = true;
        underwriterAllocationIndex[msg.sender][poolId] = underwriterAllocations[msg.sender].length;
        underwriterAllocations[msg.sender].push(poolId);
        
        underwriterIndexInPoolArray[poolId][msg.sender] = poolSpecificUnderwriters[poolId].length;
        poolSpecificUnderwriters[poolId].push(msg.sender);

        totalCapitalPledgedToPool[poolId] += totalPledge;
        capitalPerAdapter[poolId][adapter] += totalPledge;
        _addAdapterToPool(poolId, adapter);

        emit CapitalAllocated(msg.sender, poolId, totalPledge, adapter);
    }

    function _addAdapterToPool(uint256 poolId, address adapterAddress) internal {
        if (!isAdapterInPool[poolId][adapterAddress]) {
            isAdapterInPool[poolId][adapterAddress] = true;
            poolAdapterIndex[poolId][adapterAddress] = poolActiveAdapters[poolId].length;
            poolActiveAdapters[poolId].push(adapterAddress);
        }
    }

    function _removeAdapterFromPool(uint256 poolId, address adapterAddress) internal {
        if (!isAdapterInPool[poolId][adapterAddress]) return;
        
        uint256 indexToRemove = poolAdapterIndex[poolId][adapterAddress];
        address[] storage adapters = poolActiveAdapters[poolId];
        address lastAdapter = adapters[adapters.length - 1];
        
        adapters[indexToRemove] = lastAdapter;
        poolAdapterIndex[poolId][lastAdapter] = indexToRemove;
        
        adapters.pop();
        delete isAdapterInPool[poolId][adapterAddress];
        delete poolAdapterIndex[poolId][adapterAddress];
    }

    function _removeUnderwriterFromPool(address underwriter, uint256 poolId) internal {
        // Refund risk points before removing the allocation
        IPoolRegistry.RiskRating rating = poolRegistry.getPoolRiskRating(poolId);
        uint256 pointsToRefund = _getPointsForRating(rating);
        if (underwriterRiskPointsUsed[underwriter] >= pointsToRefund) {
            underwriterRiskPointsUsed[underwriter] -= pointsToRefund;
        } else {
            underwriterRiskPointsUsed[underwriter] = 0;
        }

        // Remove from underwriter's allocation list
        uint256[] storage allocs = underwriterAllocations[underwriter];
        uint256 indexToRemove = underwriterAllocationIndex[underwriter][poolId];
        uint256 lastElementPoolId = allocs[allocs.length - 1];
        allocs[indexToRemove] = lastElementPoolId;
        underwriterAllocationIndex[underwriter][lastElementPoolId] = indexToRemove;
        allocs.pop();

        // Remove from pool's underwriter list
        uint256 indexInPool = underwriterIndexInPoolArray[poolId][underwriter];
        address[] storage underwriters = poolSpecificUnderwriters[poolId];
        address lastUnderwriter = underwriters[underwriters.length - 1];
        underwriters[indexInPool] = lastUnderwriter;
        underwriterIndexInPoolArray[poolId][lastUnderwriter] = indexInPool;
        underwriters.pop();

        delete underwriterIndexInPoolArray[poolId][underwriter];
        delete underwriterAllocationIndex[underwriter][poolId];
        delete underwriterPoolPledge[underwriter][poolId];
        delete isAllocatedToPool[underwriter][poolId];
    }

    function _handleFullWithdrawalCleanup(address underwriter) internal {
        address adapter = capitalPool.getUnderwriterAdapterAddress(underwriter);
        uint256[] memory allocations = underwriterAllocations[underwriter];
        for (uint i=0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            uint256 pledge = underwriterPoolPledge[underwriter][poolId];
            if (pledge > 0) {
                totalCapitalPledgedToPool[poolId] -= pledge;
                capitalPerAdapter[poolId][adapter] -= pledge;
            }
            _removeUnderwriterFromPool(underwriter, poolId);
        }
        delete underwriterAllocations[underwriter];
        delete underwriterRiskPointsUsed[underwriter]; // Clean up state
    }

    function _prepareAllocateCapital(uint256[] calldata poolIds) internal view returns (uint256, address, uint256) {
        (uint256 totalDepositedPrincipal, , , ) = capitalPool.getUnderwriterAccount(msg.sender);
        if (totalDepositedPrincipal == 0) revert NoCapitalToAllocate();
        
        uint256 len = poolIds.length;
        if (len == 0 || len + underwriterAllocations[msg.sender].length > maxAllocationsPerUnderwriter) {
            revert ExceedsMaxAllocations();
        }
        
        uint256 currentPointsUsed = underwriterRiskPointsUsed[msg.sender];
        uint256 additionalPointsRequired = 0;
        uint256 poolCount = poolRegistry.getPoolCount();

        for (uint256 i = 0; i < len; i++) {
            uint256 pid = poolIds[i];
            if (pid >= poolCount) revert InvalidPoolId();
            if (isAllocatedToPool[msg.sender][pid]) revert AlreadyAllocated();
            
            IPoolRegistry.RiskRating rating = poolRegistry.getPoolRiskRating(pid);
            additionalPointsRequired += _getPointsForRating(rating);
        }

        if (currentPointsUsed + additionalPointsRequired > TOTAL_RISK_POINTS) {
            revert InsufficientRiskPoints(currentPointsUsed, additionalPointsRequired, TOTAL_RISK_POINTS);
        }
        
        address adapter = capitalPool.getUnderwriterAdapterAddress(msg.sender);
        require(adapter != address(0), "User has no yield adapter");
        
        return (totalDepositedPrincipal, adapter, additionalPointsRequired);
    }

    function _checkDeallocationRequest(address underwriter, uint256 poolId) internal view {
        if (poolId >= poolRegistry.getPoolCount()) revert InvalidPoolId();
        if (!isAllocatedToPool[underwriter][poolId]) revert NotAllocated();
        if (deallocationRequestTimestamp[underwriter][poolId] != 0) revert DeallocationRequestPending();
        
        uint256 pledgeAmount = underwriterPoolPledge[underwriter][poolId];

        // Fetch all required static data in a single, efficient call.
        (, uint256 totalSold, , , ,) = poolRegistry.getPoolStaticData(poolId);
        
        uint256 currentPledged = totalCapitalPledgedToPool[poolId];
        uint256 pendingW = capitalPendingWithdrawal[poolId];
        
        // Free capital is the portion of the pledged capital that is not backing sold coverage
        // and is not already pending withdrawal.
        uint256 freeCapital = currentPledged > totalSold + pendingW ? currentPledged - totalSold - pendingW : 0;

        if (pledgeAmount > freeCapital) revert InsufficientFreeCapital();
    }

    function _realizeLossesForAllPools(address user) internal {
        uint256[] memory allocations = underwriterAllocations[user];
        if (allocations.length == 0) return;

        uint256 totalPendingLossValue = 0;
        for (uint256 i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            uint256 userPledge = underwriterPoolPledge[user][poolId];
            if (userPledge > 0) {
                totalPendingLossValue += lossDistributor.getPendingLosses(user, poolId, userPledge);
            }
        }

        if (totalPendingLossValue > 0) {
            lossDistributor.realizeAggregateLoss(user, totalPendingLossValue, allocations);
        }
    }

    function _validateDeallocationRequest(address underwriter, uint256 poolId) internal view {
        uint256 requestTime = deallocationRequestTimestamp[underwriter][poolId];
        if (requestTime == 0) revert NoDeallocationRequest();
        if (block.timestamp < requestTime + deallocationNoticePeriod) revert NoticePeriodActive();
    }
}