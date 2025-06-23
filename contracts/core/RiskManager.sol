// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IPolicyNFT.sol";
import "../interfaces/IPoolRegistry.sol";
import "../interfaces/ICapitalPool.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../interfaces/ICatInsurancePool.sol";
import "../interfaces/ILossDistributor.sol";
import "../interfaces/IPolicyManager.sol";
import "../interfaces/IRewardDistributor.sol";

/**
 * @title RiskManager
 * @author Gemini
 * @notice A lean orchestrator for a decentralized insurance protocol. It manages capital allocation,
 * claim processing, and liquidations by coordinating with specialized satellite contracts.
 */
contract RiskManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ───────────────────────── State Variables ───────────────────────── */
    ICapitalPool public capitalPool;
    IPoolRegistry public poolRegistry;
    IPolicyNFT public policyNFT;
    ICatInsurancePool public catPool;
    ILossDistributor public lossDistributor;
    IRewardDistributor public rewardDistributor;
    address public policyManager;
    address public committee;

    mapping(address => uint256) public underwriterTotalPledge;
    mapping(address => mapping(uint256 => uint256)) public underwriterPoolPledge;
    mapping(uint256 => address[]) public poolSpecificUnderwriters;
    mapping(address => uint256[]) public underwriterAllocations;
    mapping(address => mapping(uint256 => bool)) public isAllocatedToPool;
    mapping(uint256 => mapping(address => uint256)) public underwriterIndexInPoolArray;

    uint256 public maxAllocationsPerUnderwriter = 5;
    uint256 public constant CLAIM_FEE_BPS = 500;
    uint256 public constant BPS = 10_000;

    uint256 public deallocationNoticePeriod;
    mapping(address => mapping(uint256 => uint256)) public deallocationRequestTimestamp;
    mapping(address => mapping(uint256 => uint256)) public deallocationRequestAmount;

    /* ───────────────────────── Errors & Events ───────────────────────── */
    error NotCapitalPool();
    error NotPolicyManager();
    error NotCommittee(); // CORRECTED: Added error for committee-only functions
    error NoCapitalToAllocate();
    error ExceedsMaxAllocations();
    error InvalidPoolId();
    error AlreadyAllocated();
    error NotAllocated();
    error UnderwriterNotInsolvent();
    error ZeroAddressNotAllowed();
    error DeallocationRequestPending();
    error NoDeallocationRequest();
    error NoticePeriodActive();
    error InsufficientFreeCapital();

    event AddressesSet(address capital, address registry, address policy, address cat, address loss, address rewards);
    event CommitteeSet(address committee);
    event UnderwriterLiquidated(address indexed liquidator, address indexed underwriter);
    event CapitalAllocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event CapitalDeallocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event DeallocationRequested(address indexed underwriter, uint256 indexed poolId, uint256 amount, uint256 timestamp);
    event DeallocationNoticePeriodSet(uint256 newPeriod);
    event MaxAllocationsPerUnderwriterSet(uint256 newMax);

    /* ───────────────────── Constructor & Setup ───────────────────── */

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    function setAddresses(address _capital, address _registry, address _policy, address _cat, address _loss, address _rewards) external onlyOwner {
        require(
            _capital != address(0) &&
            _registry != address(0) &&
            _policy != address(0) &&
            _cat != address(0) &&
            _loss != address(0) &&
            _rewards != address(0),
            "Zero address not allowed"
        );
        capitalPool = ICapitalPool(_capital);
        poolRegistry = IPoolRegistry(_registry);
        policyManager = _policy;
        policyNFT = IPolicyManager(_policy).policyNFT();
        catPool = ICatInsurancePool(_cat);
        lossDistributor = ILossDistributor(_loss);
        rewardDistributor = IRewardDistributor(_rewards);
        emit AddressesSet(_capital, _registry, _policy, _cat, _loss, _rewards);
    }

    function setCommittee(address _committee) external onlyOwner {
        require(_committee != address(0), "Zero address not allowed");
        committee = _committee;
        emit CommitteeSet(_committee);
    }

    function setMaxAllocationsPerUnderwriter(uint256 _newMax) external onlyOwner {
        require(_newMax > 0, "Invalid max");
        maxAllocationsPerUnderwriter = _newMax;
        emit MaxAllocationsPerUnderwriterSet(_newMax);
    }

    function setDeallocationNoticePeriod(uint256 _newPeriod) external onlyOwner {
        deallocationNoticePeriod = _newPeriod;
        emit DeallocationNoticePeriodSet(_newPeriod);
    }

    /**
     * @notice Wrapper for PoolRegistry.addProtocolRiskPool restricted to the owner.
     * @dev Enables governance to create new pools through the RiskManager.
     */
    function addProtocolRiskPool(
        address _protocolTokenToCover,
        IPoolRegistry.RateModel calldata _rateModel,
        uint256 _claimFeeBps
    ) external onlyOwner returns (uint256) {
        return poolRegistry.addProtocolRiskPool(_protocolTokenToCover, _rateModel, _claimFeeBps);
    }
    
    /* ──────────────── Underwriter Capital Allocation ──────────────── */
    
    function allocateCapital(uint256[] calldata _poolIds) external nonReentrant {
        uint256 totalPledge = underwriterTotalPledge[msg.sender];
        if (totalPledge == 0) revert NoCapitalToAllocate();
        require(_poolIds.length > 0 && _poolIds.length <= maxAllocationsPerUnderwriter, "Invalid number of allocations");

        address userAdapterAddress = capitalPool.getUnderwriterAdapterAddress(msg.sender);
        require(userAdapterAddress != address(0), "User has no yield adapter set in CapitalPool");
        
        uint256 poolCount = poolRegistry.getPoolCount();

        for(uint i = 0; i < _poolIds.length; i++){
            uint256 poolId = _poolIds[i];
            require(poolId < poolCount, "Invalid poolId");
            require(!isAllocatedToPool[msg.sender][poolId], "Already allocated to this pool");
            
            poolRegistry.updateCapitalAllocation(poolId, userAdapterAddress, totalPledge, true);
            underwriterPoolPledge[msg.sender][poolId] = totalPledge;

            isAllocatedToPool[msg.sender][poolId] = true;
            underwriterAllocations[msg.sender].push(poolId);
            poolSpecificUnderwriters[poolId].push(msg.sender);
            underwriterIndexInPoolArray[poolId][msg.sender] = poolSpecificUnderwriters[poolId].length - 1;
            
            emit CapitalAllocated(msg.sender, poolId, totalPledge);
        }
    }
    
    function requestDeallocateFromPool(uint256 _poolId, uint256 _amount) external nonReentrant {
        address underwriter = msg.sender;
        uint256 poolCount = poolRegistry.getPoolCount();
        require(_poolId < poolCount, "Invalid poolId");
        require(isAllocatedToPool[underwriter][_poolId], "Not allocated to this pool");
        if (deallocationRequestTimestamp[underwriter][_poolId] != 0) revert DeallocationRequestPending();

        require(_amount > 0, "Invalid amount");
        uint256 totalPledge = underwriterTotalPledge[underwriter];
        uint256 currentPledge = underwriterPoolPledge[underwriter][_poolId];
        require(_amount <= currentPledge, "Amount exceeds pledge");
        if (totalPledge == 0) revert NoCapitalToAllocate();

        (, uint256 totalPledged, uint256 totalSold, uint256 pendingWithdrawal,, ,) = poolRegistry.getPoolData(_poolId);
        uint256 freeCapital = totalPledged > totalSold + pendingWithdrawal ? totalPledged - totalSold - pendingWithdrawal : 0;
        if (_amount > freeCapital) revert InsufficientFreeCapital();

        poolRegistry.updateCapitalPendingWithdrawal(_poolId, _amount, true);
        deallocationRequestTimestamp[underwriter][_poolId] = block.timestamp;
        deallocationRequestAmount[underwriter][_poolId] = _amount;
        emit DeallocationRequested(underwriter, _poolId, _amount, block.timestamp);
    }

    function deallocateFromPool(uint256 _poolId) external nonReentrant {
        address underwriter = msg.sender;
        uint256 requestTime = deallocationRequestTimestamp[underwriter][_poolId];
        uint256 amount = deallocationRequestAmount[underwriter][_poolId];
        if (requestTime == 0) revert NoDeallocationRequest();
        if (block.timestamp < requestTime + deallocationNoticePeriod) revert NoticePeriodActive();

        _realizeLossesForAllPools(underwriter);

        uint256 totalPledge = underwriterTotalPledge[underwriter];
        if (totalPledge == 0) revert NoCapitalToAllocate();

        uint256 poolCount = poolRegistry.getPoolCount();
        require(_poolId < poolCount, "Invalid poolId");
        require(isAllocatedToPool[underwriter][_poolId], "Not allocated to this pool");

        address userAdapterAddress = capitalPool.getUnderwriterAdapterAddress(underwriter);
        require(userAdapterAddress != address(0), "User has no yield adapter set in CapitalPool");

        poolRegistry.updateCapitalAllocation(_poolId, userAdapterAddress, amount, false);
        poolRegistry.updateCapitalPendingWithdrawal(_poolId, amount, false);
        uint256 remaining = underwriterPoolPledge[underwriter][_poolId] - amount;
        underwriterPoolPledge[underwriter][_poolId] = remaining;
        if (remaining == 0) {
            _removeUnderwriterFromPool(underwriter, _poolId);
        }
        delete deallocationRequestTimestamp[underwriter][_poolId];
        delete deallocationRequestAmount[underwriter][_poolId];

        emit CapitalDeallocated(underwriter, _poolId, amount);
    }
    
    // CORRECTED: Added missing governance hook functions
    /* ───────────────────── Governance Hooks ───────────────────── */

    /**
     * @notice Called by the Committee to pause/unpause a pool following a successful vote.
     * @param _poolId The ID of the pool to update.
     * @param _pauseState The new pause state (true = paused, false = unpaused).
     */
    function reportIncident(uint256 _poolId, bool _pauseState) external {
        if (msg.sender != committee) revert NotCommittee();
        poolRegistry.setPauseState(_poolId, _pauseState);
    }

    /**
     * @notice Called by the Committee to set the fee recipient for a pool.
     * @dev Typically used to redirect fees to the Committee contract during an incident.
     * @param _poolId The ID of the pool to update.
     * @param _recipient The address of the new fee recipient.
     */
    function setPoolFeeRecipient(uint256 _poolId, address _recipient) external {
        if (msg.sender != committee) revert NotCommittee();
        poolRegistry.setFeeRecipient(_poolId, _recipient);
    }

    /* ───────────────────── Keeper & Liquidation Functions ───────────────────── */

    function liquidateInsolventUnderwriter(address _underwriter) external nonReentrant {
        (,, uint256 masterShares,,) = capitalPool.getUnderwriterAccount(_underwriter);
        if (masterShares == 0) revert UnderwriterNotInsolvent();

        uint256 totalShareValue = capitalPool.sharesToValue(masterShares);
        
        uint256[] memory allocations = underwriterAllocations[_underwriter];
        uint256 totalPendingLosses = 0;
        
        for (uint i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            totalPendingLosses += lossDistributor.getPendingLosses(
                _underwriter,
                poolId,
                underwriterPoolPledge[_underwriter][poolId]
            );
        }

        if (totalPendingLosses < totalShareValue) revert UnderwriterNotInsolvent();

        _realizeLossesForAllPools(_underwriter);

        emit UnderwriterLiquidated(msg.sender, _underwriter);
    }

    /* ───────────────────── Claim Processing ───────────────────── */

    function processClaim(uint256 _policyId) external nonReentrant {
        IPolicyNFT.Policy memory policy = policyNFT.getPolicy(_policyId);
        require(block.timestamp >= policy.activation, "Policy not active");
        uint256 poolId = policy.poolId;
        uint256 coverage = policy.coverage;
        (address[] memory adapters, uint256[] memory capitalPerAdapter, uint256 totalCapitalPledged) = poolRegistry.getPoolPayoutData(poolId);

        (IERC20 protocolToken,, , , , , uint256 poolClaimFeeBps) = poolRegistry.getPoolData(poolId);
        address claimant = policyNFT.ownerOf(_policyId);
        if (coverage > 0) {
            uint8 protocolDecimals = IERC20Metadata(address(protocolToken)).decimals();
            uint8 underlyingDecimals = IERC20Metadata(address(capitalPool.underlyingAsset())).decimals();
            uint256 protocolCoverage = _scaleAmount(coverage, underlyingDecimals, protocolDecimals);
            protocolToken.safeTransferFrom(claimant, address(rewardDistributor), protocolCoverage);
            rewardDistributor.distribute(poolId, address(protocolToken), protocolCoverage, totalCapitalPledged);
        }

        lossDistributor.distributeLoss(poolId, coverage, totalCapitalPledged);
        
        uint256 lossBorneByPool = Math.min(coverage, totalCapitalPledged);
        uint256 shortfall = coverage > lossBorneByPool ? coverage - lossBorneByPool : 0;
        if (shortfall > 0) {
            catPool.drawFund(shortfall);
        }
        
        uint256 claimFee = (coverage * poolClaimFeeBps) / BPS;
        
        ICapitalPool.PayoutData memory payoutData;
        payoutData.claimant = policyNFT.ownerOf(_policyId);
        payoutData.claimantAmount = coverage - claimFee;
        payoutData.feeRecipient = committee;
        payoutData.feeAmount = claimFee;
        payoutData.adapters = adapters;
        payoutData.capitalPerAdapter = capitalPerAdapter;
        payoutData.totalCapitalFromPoolLPs = totalCapitalPledged;
        
        capitalPool.executePayout(payoutData);

        if (lossBorneByPool > 0 && totalCapitalPledged > 0) {
            for (uint256 i = 0; i < adapters.length; i++) {
                uint256 adapterLoss = (lossBorneByPool * capitalPerAdapter[i]) / totalCapitalPledged;
                if (adapterLoss > 0) {
                    poolRegistry.updateCapitalAllocation(poolId, adapters[i], adapterLoss, false);
                }
            }
        }

        // Update coverage sold directly without going through the PolicyManager
        // hook to avoid the NotPolicyManager revert when processing claims.
        (, , uint256 totalCoverageSold,, , ,) = poolRegistry.getPoolData(poolId);
        uint256 reduction = Math.min(coverage, totalCoverageSold);
        if (reduction > 0) {
            poolRegistry.updateCoverageSold(poolId, reduction, false);
        }

        policyNFT.burn(_policyId);
    }
    
    /* ───────────────── Hooks & State Updaters ───────────────── */

    function updateCoverageSold(uint256 _poolId, uint256 _amount, bool _isSale) public {
        if(msg.sender != policyManager) revert NotPolicyManager();
        poolRegistry.updateCoverageSold(_poolId, _amount, _isSale);
    }

    /* ───────────────── Rewards Claiming ───────────────── */

    function claimPremiumRewards(uint256 _poolId) external nonReentrant {
        (IERC20 protocolToken,,,,,,) = poolRegistry.getPoolData(_poolId);
        rewardDistributor.claim(msg.sender, _poolId, address(protocolToken), underwriterPoolPledge[msg.sender][_poolId]);
    }

    function claimDistressedAssets(uint256 _poolId) external nonReentrant {
        (IERC20 protocolToken,,,,,,) = poolRegistry.getPoolData(_poolId);
        catPool.claimProtocolAssetRewardsFor(msg.sender, address(protocolToken));
    }

    function onCapitalDeposited(address _underwriter, uint256 _amount) external {
        if(msg.sender != address(capitalPool)) revert NotCapitalPool();
        underwriterTotalPledge[_underwriter] += _amount;
        uint256[] memory pools = underwriterAllocations[_underwriter];
        for(uint i=0; i<pools.length; i++){
            underwriterPoolPledge[_underwriter][pools[i]] += _amount;
            (IERC20 protocolToken,,,,,,) = poolRegistry.getPoolData(pools[i]);
            rewardDistributor.updateUserState(
                _underwriter,
                pools[i],
                address(protocolToken),
                underwriterPoolPledge[_underwriter][pools[i]]
            );
        }
    }

    function onWithdrawalRequested(address _underwriter, uint256 _principalComponent) external {
        if(msg.sender != address(capitalPool)) revert NotCapitalPool();
        uint256[] memory allocations = underwriterAllocations[_underwriter];
        for (uint i = 0; i < allocations.length; i++) {
            poolRegistry.updateCapitalPendingWithdrawal(allocations[i], _principalComponent, true);
            (IERC20 protocolToken,,,,,,) = poolRegistry.getPoolData(allocations[i]);
            rewardDistributor.updateUserState(
                _underwriter,
                allocations[i],
                address(protocolToken),
                underwriterPoolPledge[_underwriter][allocations[i]]
            );
        }
    }

    function onWithdrawalCancelled(address _underwriter, uint256 _principalComponent) external {
        if(msg.sender != address(capitalPool)) revert NotCapitalPool();
        uint256[] memory allocations = underwriterAllocations[_underwriter];
        for (uint i = 0; i < allocations.length; i++) {
            poolRegistry.updateCapitalPendingWithdrawal(allocations[i], _principalComponent, false);
            (IERC20 protocolToken,,,,,,) = poolRegistry.getPoolData(allocations[i]);
            rewardDistributor.updateUserState(
                _underwriter,
                allocations[i],
                address(protocolToken),
                underwriterPoolPledge[_underwriter][allocations[i]]
            );
        }
    }

    function onCapitalWithdrawn(address _underwriter, uint256 _principalComponentRemoved, bool _isFullWithdrawal) external {
        if(msg.sender != address(capitalPool)) revert NotCapitalPool();
        _realizeLossesForAllPools(_underwriter);
        
        uint256 pledgeAfterLosses = underwriterTotalPledge[_underwriter];
        uint256 amountToSubtract = Math.min(pledgeAfterLosses, _principalComponentRemoved);
        underwriterTotalPledge[_underwriter] -= amountToSubtract;
        
        uint256[] memory allocations = underwriterAllocations[_underwriter];
        for (uint i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            (, , , uint256 pendingWithdrawal, , ,) = poolRegistry.getPoolData(poolId);
            uint256 reduction = Math.min(_principalComponentRemoved, pendingWithdrawal);
            if (reduction > 0) {
                poolRegistry.updateCapitalPendingWithdrawal(poolId, reduction, false);
            }
            uint256 pledgeReduction = _principalComponentRemoved > underwriterPoolPledge[_underwriter][poolId] ? underwriterPoolPledge[_underwriter][poolId] : _principalComponentRemoved;
            underwriterPoolPledge[_underwriter][poolId] -= pledgeReduction;
            (IERC20 protocolToken,,,,,,) = poolRegistry.getPoolData(poolId);
            rewardDistributor.updateUserState(
                _underwriter,
                poolId,
                address(protocolToken),
                underwriterPoolPledge[_underwriter][poolId]
            );
            if (_isFullWithdrawal || underwriterPoolPledge[_underwriter][poolId] == 0) {
                _removeUnderwriterFromPool(_underwriter, poolId);
            }
        }
        if (_isFullWithdrawal) {
            delete underwriterAllocations[_underwriter];
        }
    }
    
    /* ───────────────── Internal Functions ───────────────── */

    function _scaleAmount(uint256 amount, uint8 fromDecimals, uint8 toDecimals) internal pure returns (uint256) {
        if (toDecimals > fromDecimals) {
            return amount * (10 ** (toDecimals - fromDecimals));
        } else if (toDecimals < fromDecimals) {
            return amount / (10 ** (fromDecimals - toDecimals));
        }
        return amount;
    }

    function _realizeLossesForAllPools(address _user) internal {
        uint256[] memory allocations = underwriterAllocations[_user];
        for (uint i = 0; i < allocations.length; i++) {
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

    function _removeUnderwriterFromPool(address _underwriter, uint256 _poolId) internal {
        isAllocatedToPool[_underwriter][_poolId] = false;
        uint256[] storage allocs = underwriterAllocations[_underwriter];
        for (uint j = 0; j < allocs.length; j++) {
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
}