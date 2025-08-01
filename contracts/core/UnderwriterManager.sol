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
 * @notice Manages the allocation (pledging) of capital to risk pools and safe withdrawals.
 * @dev V16: Optimized mutex group check for gas efficiency.
 */
contract UnderwriterManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- State: Interfaces ---
    ICapitalPool public capitalPool;
    IPoolRegistry public poolRegistry;
    IBackstopPool public catPool;
    ILossDistributor public lossDistributor;
    IRewardDistributor public rewardDistributor;
    address public riskManager;

    // --- State: Underwriter-Specific ---
    mapping(address => mapping(uint256 => uint256)) public underwriterPoolPledge;
    mapping(address => uint256[]) public underwriterAllocations;
    mapping(address => mapping(uint256 => bool)) public isAllocatedToPool;
    mapping(address => mapping(uint256 => uint256)) public underwriterAllocationIndex;
    mapping(address => mapping(uint256 => uint256)) public deallocationRequestTimestamp;
    mapping(address => uint256) public underwriterRiskPointsUsed;

    // --- State: Pool & Adapter Aggregates ---
    mapping(uint256 => uint256) public totalCapitalPledgedToPool;
    mapping(uint256 => uint256) public capitalPendingWithdrawal;
    mapping(uint256 => mapping(address => uint256)) public capitalPerAdapter;
    mapping(uint256 => address[]) public poolActiveAdapters;
    mapping(uint256 => mapping(address => uint256)) public poolAdapterIndex;
    mapping(uint256 => mapping(address => bool)) public isAdapterInPool;
    mapping(uint256 => address[]) public poolSpecificUnderwriters;
    mapping(uint256 => mapping(address => uint256)) public underwriterIndexInPoolArray;

    // --- State: Cross-Pool Risk ---
    mapping(uint256 => mapping(uint256 => uint256)) public overlapExposure;
    mapping(uint256 => uint256) public poolMutexGroupId;

    // --- Constants & Config ---
    uint256 public constant ABSOLUTE_MAX_ALLOCATIONS = 50;
    uint256 public constant TOTAL_RISK_POINTS = 12;
    uint256 public maxAllocationsPerUnderwriter = 5;
    uint256 public deallocationNoticePeriod;

    // --- Events & Errors ---
    event AddressesSet(address capital, address registry, address cat, address loss, address rewards, address riskMgr);
    event CapitalAllocated(address indexed underwriter, uint256 indexed poolId, uint256 amount, address adapter);
    event DeallocationRequested(address indexed underwriter, uint256 indexed poolId, uint256 amount, uint256 timestamp);
    event CapitalDeallocated(address indexed underwriter, uint256 indexed poolId, uint256 amount, address adapter);
    event DeallocationNoticePeriodSet(uint256 newPeriod);
    event MaxAllocationsPerUnderwriterSet(uint256 newMax);
    event PoolMutexGroupSet(uint256 indexed groupId, uint256[] poolIds);

    error MutexAllocationNotAllowed(uint256 poolId, uint256 groupId);
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
    error InsufficientRiskPoints(uint256 current, uint256 required, uint256 total);
    error InsufficientWithdrawableCapital(uint256 requested, uint256 available);

    // --- Modifiers ---
    modifier onlyCapitalPool() {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();
        _;
    }

    modifier onlyRiskManager() {
        if (msg.sender != riskManager) revert NotRiskManager();
        _;
    }

    // --- Constructor & Setup ---
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
    
    function setPoolMutexGroup(uint256[] calldata poolIds, uint256 groupId) external onlyOwner {
        require(groupId != 0, "Group ID cannot be zero");
        for (uint256 i = 0; i < poolIds.length; i++) {
            poolMutexGroupId[poolIds[i]] = groupId;
        }
        emit PoolMutexGroupSet(groupId, poolIds);
    }

    // --- Underwriter Capital Management ---
    function allocateCapital(uint256[] calldata poolIds) external nonReentrant {
        address underwriter = msg.sender;
        uint256[] memory existingAllocs = underwriterAllocations[underwriter];

        for (uint256 i = 0; i < existingAllocs.length; i++) {
            lossDistributor.recordPledgeUpdate(underwriter, existingAllocs[i]);
        }
        
        (uint256 totalCapitalToPledge, address adapter, uint256 pointsToUse) = _prepareAllocateCapital(poolIds);
        
        underwriterRiskPointsUsed[underwriter] += pointsToUse;

        for (uint256 i = 0; i < poolIds.length; i++) {
            lossDistributor.recordPledgeUpdate(underwriter, poolIds[i]);
            _executeAllocation(poolIds[i], totalCapitalToPledge, adapter);
        }
        
        _addMatrixOverlapForNewPools(underwriter, existingAllocs, poolIds);
    }
    
    function requestWithdrawal(uint256 amount) external nonReentrant {
        (uint256 totalWithdrawable, uint256 unpledgedCapital) = getTotalWithdrawableCapital(msg.sender);

        if (amount > totalWithdrawable) {
            revert InsufficientWithdrawableCapital(amount, totalWithdrawable);
        }

        if (amount <= unpledgedCapital) {
            uint256 sharesToBurn = capitalPool.valueToShares(amount);
            capitalPool.requestWithdrawal(msg.sender, sharesToBurn);
        } else {
            uint256[] memory allocations = underwriterAllocations[msg.sender];
            bool deallocationStarted = false;
            for (uint i = 0; i < allocations.length; i++) {
                uint256 poolId = allocations[i];
                if (_isDeallocationPossible(msg.sender, poolId, amount)) {
                    requestDeallocateFromPool(poolId);
                    deallocationStarted = true;
                    break; 
                }
            }
            require(deallocationStarted, "Could not find a pool to deallocate from");
        }
    }

    function requestDeallocateFromPool(uint256 poolId) public  {
        _checkDeallocationRequest(msg.sender, poolId);
        lossDistributor.recordPledgeUpdate(msg.sender, poolId);
        
        uint256 pledgeAmount = underwriterPoolPledge[msg.sender][poolId];
        deallocationRequestTimestamp[msg.sender][poolId] = block.timestamp;
        capitalPendingWithdrawal[poolId] += pledgeAmount;
        emit DeallocationRequested(msg.sender, poolId, pledgeAmount, block.timestamp);
    }

    function deallocateFromPool(uint256 poolId) external nonReentrant {
        _validateDeallocationRequest(msg.sender, poolId);
        address underwriter = msg.sender;
        
        _removeMatrixOverlapForPool(underwriter, poolId);

        uint256 pledgeAmount = underwriterPoolPledge[underwriter][poolId];
        address adapter = capitalPool.getUnderwriterAdapterAddress(underwriter);

        delete deallocationRequestTimestamp[underwriter][poolId];

        totalCapitalPledgedToPool[poolId] -= pledgeAmount;
        capitalPendingWithdrawal[poolId] -= pledgeAmount;
        capitalPerAdapter[poolId][adapter] -= pledgeAmount;
        
        if (capitalPerAdapter[poolId][adapter] == 0) {
            _removeAdapterFromPool(poolId, adapter);
        }

        _removeUnderwriterFromPool(underwriter, poolId);
        
        emit CapitalDeallocated(underwriter, poolId, pledgeAmount, adapter);
    }
    
    function cancelWithdrawal(uint256 requestIndex) external nonReentrant {
        capitalPool.cancelWithdrawalRequest(msg.sender, requestIndex);
    }

    function executeWithdrawal(uint256 requestIndex) external nonReentrant {
        realizeLossesForAllPools(msg.sender);
        capitalPool.executeWithdrawal(msg.sender, requestIndex);
    }
    
    // --- Hooks & State Updaters ---
    function onCapitalDeposited(address underwriter, uint256 amount) external onlyCapitalPool {
        realizeLossesForAllPools(underwriter);

        (uint256 principalAfter, , , ) = capitalPool.getUnderwriterAccount(underwriter);
        uint256 principalBefore = principalAfter > amount ? principalAfter - amount : 0;
        
        if (principalBefore == 0) return;

        _rebuildOverlapMatrixForPledgeChange(underwriter, -1);

        uint256[] memory allocations = underwriterAllocations[underwriter];
        if (allocations.length > 0) {
            address adapter = capitalPool.getUnderwriterAdapterAddress(underwriter);
            if(adapter == address(0)) revert("UM: User has no yield adapter");

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
        
        _rebuildOverlapMatrixForPledgeChange(underwriter, 1);
    }

    function onCapitalWithdrawn(address underwriter, uint256 principalComponentRemoved, bool isFullWithdrawal) external onlyCapitalPool {
        _rebuildOverlapMatrixForPledgeChange(underwriter, -1);

        (uint256 principalAfter, , ,) = capitalPool.getUnderwriterAccount(underwriter);
        uint256 principalBefore = principalAfter + principalComponentRemoved;
        if (principalBefore == 0) return;

        uint256[] memory allocations = underwriterAllocations[underwriter];
        if (allocations.length > 0) {
            address adapter = capitalPool.getUnderwriterAdapterAddress(underwriter);
            if(adapter == address(0)) revert("User has no yield adapter");

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

        if (!isFullWithdrawal) {
            _rebuildOverlapMatrixForPledgeChange(underwriter, 1);
        }
    }

    function onLossRealized(address underwriter, uint256 valueLost) external onlyCapitalPool {
        _rebuildOverlapMatrixForPledgeChange(underwriter, -1);

        (uint256 principalAfter, , ,) = capitalPool.getUnderwriterAccount(underwriter);
        uint256 principalBefore = principalAfter + valueLost;
        if (principalBefore == 0) return;

        uint256[] memory allocations = underwriterAllocations[underwriter];
        if (allocations.length > 0) {
            address adapter = capitalPool.getUnderwriterAdapterAddress(underwriter);
            if (adapter == address(0)) return; 

            for (uint256 i = 0; i < allocations.length; i++) {
                uint256 poolId = allocations[i];
                uint256 poolPledgeBefore = underwriterPoolPledge[underwriter][poolId];
                if (poolPledgeBefore > 0) {
                    uint256 reduction = Math.mulDiv(poolPledgeBefore, valueLost, principalBefore);
                    underwriterPoolPledge[underwriter][poolId] -= reduction;
                    totalCapitalPledgedToPool[poolId] -= reduction;
                    capitalPerAdapter[poolId][adapter] -= reduction;
                }
            }
        }
        
        _rebuildOverlapMatrixForPledgeChange(underwriter, 1);
    }

    /**
 * @notice A convenience function to deposit capital and allocate it in a single transaction.
 * @dev The user must first approve this contract to spend their underlying tokens.
 * @param amount The amount of the underlying asset to deposit.
 * @param yieldChoice The yield strategy to use for the deposited capital.
 * @param poolIds The IDs of the risk pools to allocate the new capital to.
 */
function depositAndAllocate(
    uint256 amount,
    ICapitalPool.YieldPlatform yieldChoice,
    uint256[] calldata poolIds
) external nonReentrant {
    address underwriter = msg.sender;

    // --- Step 1: Deposit Logic ---
    if (amount > 0) {
        // Get the underlying asset from the Capital Pool
        IERC20 underlying = IERC20(capitalPool.underlyingAsset());
        
        // Pull approved tokens from the user to this contract
        underlying.safeTransferFrom(underwriter, address(this), amount);
        
        // Approve the Capital Pool to pull the tokens from this contract
        underlying.approve(address(capitalPool), amount);

        // Call the new `depositFor` function on the Capital Pool
        capitalPool.depositFor(underwriter, amount, yieldChoice);
    }

    // --- Step 2: Allocation Logic ---
    // This logic is identical to the allocateCapital function
    uint256[] memory existingAllocs = underwriterAllocations[underwriter];

    for (uint256 i = 0; i < existingAllocs.length; i++) {
        lossDistributor.recordPledgeUpdate(underwriter, existingAllocs[i]);
    }
    
    (uint256 totalCapitalToPledge, address adapter, uint256 pointsToUse) = _prepareAllocateCapital(poolIds);
    
    underwriterRiskPointsUsed[underwriter] += pointsToUse;

    for (uint256 i = 0; i < poolIds.length; i++) {
        lossDistributor.recordPledgeUpdate(underwriter, poolIds[i]);
        _executeAllocation(poolIds[i], totalCapitalToPledge, adapter);
    }
    
    _addMatrixOverlapForNewPools(underwriter, existingAllocs, poolIds);
}
    
    function realizeLossesForAllPools(address user) public nonReentrant {
        uint256[] memory allocations = underwriterAllocations[user];
        if (allocations.length == 0) return;

        uint256 totalPendingSharesToBurn = 0;
        for (uint256 i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            uint256 userPledge = underwriterPoolPledge[user][poolId];
            if (userPledge > 0) {
                totalPendingSharesToBurn += lossDistributor.getPendingLosses(user, poolId, userPledge);
            }
        }

        if (totalPendingSharesToBurn > 0) {
            lossDistributor.realizeAggregateLoss(user, totalPendingSharesToBurn, allocations);
        }
    }

    // --- View Functions ---
    function getPoolPayoutData(uint256 poolId) external view returns (address[] memory, uint256[] memory, uint256) {
        address[] memory adapters = poolActiveAdapters[poolId];
        uint256[] memory capital = new uint256[](adapters.length);
        for(uint i = 0; i < adapters.length; i++){
            capital[i] = capitalPerAdapter[poolId][adapters[i]];
        }
        return (adapters, capital, totalCapitalPledgedToPool[poolId]);
    }

    function getPoolUnderwriterPledges(uint256 poolId)
        external
        view
        returns (address[] memory underwriters, uint256[] memory pledges)
    {
        address[] memory underwriterList = poolSpecificUnderwriters[poolId];
        pledges = new uint256[](underwriterList.length);
        for (uint i = 0; i < underwriterList.length; i++) {
            pledges[i] = underwriterPoolPledge[underwriterList[i]][poolId];
        }
        return (underwriterList, pledges);
    }

    function getPoolUnderwriters(uint256 poolId) external view returns (address[] memory) {
        return poolSpecificUnderwriters[poolId];
    }
    
    function getUnderwriterAllocations(address user) external view returns (uint256[] memory) {
        return underwriterAllocations[user];
    }

    function getPoolUnderwritersPaginated(
        uint256 poolId,
        uint256 cursor,
        uint256 limit
    ) external view returns (address[] memory underwriters_, uint256 nextCursor) {
        address[] storage underwritersArray = poolSpecificUnderwriters[poolId];
        uint256 length = underwritersArray.length;

        if (cursor >= length) {
            return (new address[](0), 0);
        }

        uint256 end = cursor + limit;
        if (end > length) {
            end = length;
        }

        uint256 pageSize = end - cursor;
        underwriters_ = new address[](pageSize);
        for (uint256 i = 0; i < pageSize; i++) {
            underwriters_[i] = underwritersArray[cursor + i];
        }

        nextCursor = (end == length) ? 0 : end;
    }

    function getUnpledgedCapital(address user) public view returns (uint256 unpledgedCapital, uint256 totalPledged) {
        (uint256 totalDepositedPrincipal, , , ) = capitalPool.getUnderwriterAccount(user);
        
        uint256[] memory allocations = underwriterAllocations[user];
        for (uint i = 0; i < allocations.length; i++) {
            totalPledged += underwriterPoolPledge[user][allocations[i]];
        }
        
        if (totalDepositedPrincipal >= totalPledged) {
            unpledgedCapital = totalDepositedPrincipal - totalPledged;
        } else {
            unpledgedCapital = 0;
        }
    }
    
    function getTotalWithdrawableCapital(address user) public view returns (uint256 totalWithdrawable, uint256 unpledgedCapital) {
        (unpledgedCapital, ) = getUnpledgedCapital(user);
        totalWithdrawable = unpledgedCapital;

        uint256[] memory allocations = underwriterAllocations[user];
        for (uint i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            uint256 pledgeAmount = underwriterPoolPledge[user][poolId];
            if (pledgeAmount > 0 && _isDeallocationPossible(user, poolId, pledgeAmount)) {
                totalWithdrawable += pledgeAmount;
            }
        }
    }

    function getRiskAdjustedPledge(address user, uint256 poolId) public view returns (uint256) {
        uint256 pledge = underwriterPoolPledge[user][poolId];
        if (pledge == 0) {
            return 0;
        }
        
        uint256 pendingLossValue = capitalPool.sharesToValue(
            lossDistributor.getPendingLosses(user, poolId, pledge)
        );

        if (pledge >= pendingLossValue) {
            return pledge - pendingLossValue;
        } else {
            return 0;
        }
    }
    
    // --- Internal & Helper Functions ---

    function _addMatrixOverlapForNewPools(
        address underwriter,
        uint256[] memory existingPools,
        uint256[] memory newPools
    ) internal {
        uint256 newPoolsLen = newPools.length;
        if (newPoolsLen == 0) return;
        uint256 existingPoolsLen = existingPools.length;

        if (existingPoolsLen > 0) {
            for (uint256 i = 0; i < newPoolsLen; i++) {
                uint256 newPoolId = newPools[i];
                uint256 pledgeToNew = underwriterPoolPledge[underwriter][newPoolId];
                if (pledgeToNew == 0) continue;

                for (uint256 j = 0; j < existingPoolsLen; j++) {
                    uint256 existingPoolId = existingPools[j];
                    uint256 pledgeToExisting = underwriterPoolPledge[underwriter][existingPoolId];
                    if (pledgeToExisting == 0) continue;

                    overlapExposure[existingPoolId][newPoolId] += pledgeToNew;
                    overlapExposure[newPoolId][existingPoolId] += pledgeToExisting;
                }
            }
        }

        for (uint256 i = 0; i < newPoolsLen; i++) {
            uint256 poolA = newPools[i];
            uint256 pledgeToA = underwriterPoolPledge[underwriter][poolA];
            if (pledgeToA == 0) continue;

            for (uint256 j = 0; j < newPoolsLen; j++) {
                uint256 poolB = newPools[j];
                uint256 pledgeToB = underwriterPoolPledge[underwriter][poolB];
                if (pledgeToB == 0) continue;

                overlapExposure[poolA][poolB] += pledgeToB;
            }
        }
    }

    function _removeMatrixOverlapForPool(address underwriter, uint256 removedPoolId) internal {
        uint256[] memory currentAllocs = underwriterAllocations[underwriter];
        uint256 pledgeToRemoved = underwriterPoolPledge[underwriter][removedPoolId];
        if (pledgeToRemoved == 0) return;

        for (uint256 i = 0; i < currentAllocs.length; i++) {
            uint256 poolId = currentAllocs[i];
            if (poolId == removedPoolId) continue;
            uint256 pledge = underwriterPoolPledge[underwriter][poolId];
            if (pledge == 0) continue;
            
            overlapExposure[poolId][removedPoolId] -= pledgeToRemoved;
            overlapExposure[removedPoolId][poolId] -= pledge;
        }
        overlapExposure[removedPoolId][removedPoolId] -= pledgeToRemoved;
    }

    function _rebuildOverlapMatrixForPledgeChange(address underwriter, int256 sign) internal {
        uint256[] memory allocations = underwriterAllocations[underwriter];
        uint256 numAllocations = allocations.length;

        if (numAllocations == 0) return;

        for (uint256 i = 0; i < numAllocations; i++) {
            uint256 poolA = allocations[i];
            uint256 pledgeToA = underwriterPoolPledge[underwriter][poolA];
            if (pledgeToA == 0) continue;

            for (uint256 j = 0; j < numAllocations; j++) {
                uint256 poolB = allocations[j];
                uint256 pledgeToB = underwriterPoolPledge[underwriter][poolB];
                if (pledgeToB == 0) continue;
                
                if (sign > 0) {
                    overlapExposure[poolA][poolB] += pledgeToB;
                } else {
                    overlapExposure[poolA][poolB] -= pledgeToB;
                }
            }
        }
    }
    
    function _getPointsForRating(IPoolRegistry.RiskRating _rating) internal pure returns (uint256) {
        if (_rating == IPoolRegistry.RiskRating.Low) return 1;
        if (_rating == IPoolRegistry.RiskRating.Moderate) return 2;
        if (_rating == IPoolRegistry.RiskRating.Elevated) return 3;
        if (_rating == IPoolRegistry.RiskRating.Speculative) return 4;
        return 0; 
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
        IPoolRegistry.RiskRating rating = poolRegistry.getPoolRiskRating(poolId);
        uint256 pointsToRefund = _getPointsForRating(rating);
        if (underwriterRiskPointsUsed[underwriter] >= pointsToRefund) {
            underwriterRiskPointsUsed[underwriter] -= pointsToRefund;
        } else {
            underwriterRiskPointsUsed[underwriter] = 0;
        }

        uint256[] storage allocs = underwriterAllocations[underwriter];
        uint256 indexToRemove = underwriterAllocationIndex[underwriter][poolId];
        uint256 lastElementPoolId = allocs[allocs.length - 1];
        allocs[indexToRemove] = lastElementPoolId;
        underwriterAllocationIndex[underwriter][lastElementPoolId] = indexToRemove;
        allocs.pop();

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

    function _checkMutexGroups(
        uint256[] memory existingAllocs,
        uint256[] calldata newPools
    ) internal view {
        uint256 newPoolsLen = newPools.length;
        if (newPoolsLen == 0) return;
        uint256 existingAllocsLen = existingAllocs.length;

        for (uint256 i = 0; i < newPoolsLen; i++) {
            uint256 newPoolId = newPools[i];
            uint256 newGroupId = poolMutexGroupId[newPoolId];
            if (newGroupId != 0) {
                // Check against pools the user is already in.
                for (uint256 j = 0; j < existingAllocsLen; j++) {
                    if (newGroupId == poolMutexGroupId[existingAllocs[j]]) {
                        revert MutexAllocationNotAllowed(newPoolId, newGroupId);
                    }
                }
                // Check against other new pools in this same transaction.
                for (uint256 j = 0; j < i; j++) {
                    if (newGroupId == poolMutexGroupId[newPools[j]]) {
                        revert MutexAllocationNotAllowed(newPoolId, newGroupId);
                    }
                }
            }
        }
    }

    function _handleFullWithdrawalCleanup(address underwriter) internal {
        _rebuildOverlapMatrixForPledgeChange(underwriter, -1);
        address adapter = capitalPool.getUnderwriterAdapterAddress(underwriter);
        uint256[] memory allocations = underwriterAllocations[underwriter];
        for (uint i=0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            uint256 pledge = underwriterPoolPledge[underwriter][poolId];
            if (pledge > 0) {
                totalCapitalPledgedToPool[poolId] -= pledge;
                capitalPerAdapter[poolId][adapter] -= pledge;
            }
        }
        delete underwriterAllocations[underwriter];
        delete underwriterRiskPointsUsed[underwriter];
    }

 function _prepareAllocateCapital(uint256[] calldata poolIds) internal view returns (uint256, address, uint256) {
        (uint256 totalDepositedPrincipal, , , ) = capitalPool.getUnderwriterAccount(msg.sender);
        if (totalDepositedPrincipal == 0) revert NoCapitalToAllocate();
        
        uint256 len = poolIds.length;
        if (len == 0 || len + underwriterAllocations[msg.sender].length > maxAllocationsPerUnderwriter) {
            revert ExceedsMaxAllocations();
        }
        
        uint256[] memory existingAllocs = underwriterAllocations[msg.sender];
        
        // --- REFACTORED: Call the new helper function ---
        _checkMutexGroups(existingAllocs, poolIds);

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
        if (adapter == address(0)) revert("User has no yield adapter");
        
        return (totalDepositedPrincipal, adapter, additionalPointsRequired);
    }
    
    
    function _isDeallocationPossible(address underwriter, uint256 poolId, uint256 amount) internal view returns (bool) {
        if (poolId >= poolRegistry.getPoolCount() || !isAllocatedToPool[underwriter][poolId] || deallocationRequestTimestamp[underwriter][poolId] != 0) {
            return false;
        }
        
        (, uint256 totalSold, , , ,) = poolRegistry.getPoolStaticData(poolId);
        uint256 currentPledged = totalCapitalPledgedToPool[poolId];
        uint256 pendingW = capitalPendingWithdrawal[poolId];
        uint256 freeCapital = currentPledged > totalSold + pendingW ? currentPledged - totalSold - pendingW : 0;

        return amount <= freeCapital;
    }

    function _checkDeallocationRequest(address underwriter, uint256 poolId) internal view {
        uint256 pledgeAmount = underwriterPoolPledge[underwriter][poolId];
        if (!_isDeallocationPossible(underwriter, poolId, pledgeAmount)) {
            revert InsufficientFreeCapital();
        }
    }

    function _validateDeallocationRequest(address underwriter, uint256 poolId) internal view {
        uint256 requestTime = deallocationRequestTimestamp[underwriter][poolId];
        if (requestTime == 0) revert NoDeallocationRequest();
        if (block.timestamp < requestTime + deallocationNoticePeriod) revert NoticePeriodActive();
    }
}