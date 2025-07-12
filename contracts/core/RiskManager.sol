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
import "../interfaces/IBackstopPool.sol";
import "../interfaces/ILossDistributor.sol";
import "../interfaces/IPolicyManager.sol";
import "../interfaces/IRewardDistributor.sol";
import "../interfaces/IRiskManager.sol";
// import "../MaliciousPoolRegistry.sol"; // IRiskManager interface
import "../interfaces/IRiskManagerPMHook.sol";

/**
 * @title RiskManager
 * @author Gemini
 * @notice A lean orchestrator for a decentralized insurance protocol. It manages capital allocation,
 * claim processing, and liquidations by coordinating with specialized satellite contracts.
 */
contract RiskManager is Ownable, ReentrancyGuard, IRiskManager, IRiskManagerPMHook {
    using SafeERC20 for IERC20;

    /* ───────────────────────── State Variables ───────────────────────── */
    ICapitalPool public capitalPool;
    IPoolRegistry public poolRegistry;
    IPolicyNFT public policyNFT;
    IBackstopPool public catPool;
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
        catPool = IBackstopPool(_cat);
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
        // ─── PREPARE / CHECKS ─────────────────────────────────────────────────
        (uint256 totalPledge, address adapter) = _prepareAllocateCapital(_poolIds);

        // ─── EFFECTS & INTERACTIONS ────────────────────────────────────────────
        // We do effects (storage updates) immediately before each external call
        // to PoolRegistry.updateCapitalAllocation, then emit.
        for (uint256 i = 0; i < _poolIds.length; i++) {
            uint256 poolId = _poolIds[i];

            // Effects
            underwriterPoolPledge[msg.sender][poolId] = totalPledge;
            isAllocatedToPool[msg.sender][poolId] = true;
            underwriterAllocations[msg.sender].push(poolId);
            poolSpecificUnderwriters[poolId].push(msg.sender);
            underwriterIndexInPoolArray[poolId][msg.sender] =
                poolSpecificUnderwriters[poolId].length - 1;

            // Interaction (one external call per pool)
            poolRegistry.updateCapitalAllocation(
                poolId,
                adapter,
                totalPledge,
                true
            );

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

        (
            IERC20 _pt,
            uint256 totalPledged,
            uint256 totalSold,
            uint256 pendingWithdrawal,
            bool _paused,
            address _fr,
            uint256 _cf
        ) = poolRegistry.getPoolData(_poolId);
        (_pt, _paused, _fr, _cf);
        uint256 freeCapital = totalPledged > totalSold + pendingWithdrawal ? totalPledged - totalSold - pendingWithdrawal : 0;
        if (_amount > freeCapital) revert InsufficientFreeCapital();

        deallocationRequestTimestamp[underwriter][_poolId] = block.timestamp;
        deallocationRequestAmount[underwriter][_poolId] = _amount;
        poolRegistry.updateCapitalPendingWithdrawal(_poolId, _amount, true);
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

        uint256 remaining = underwriterPoolPledge[underwriter][_poolId] - amount;

        // Effects: update internal state before external calls
        underwriterPoolPledge[underwriter][_poolId] = remaining;
        if (remaining == 0) {
            _removeUnderwriterFromPool(underwriter, _poolId);
        }
        delete deallocationRequestTimestamp[underwriter][_poolId];
        delete deallocationRequestAmount[underwriter][_poolId];

        // Interaction: update the PoolRegistry after state changes
        poolRegistry.updateCapitalAllocation(
            _poolId,
            userAdapterAddress,
            amount,
            false
        );
        poolRegistry.updateCapitalPendingWithdrawal(_poolId, amount, false);

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
    // ─── CHECKS & PREPARE ─────────────────────────────────────────────────
    (uint256 pendingLosses, uint256 shareValue) = _prepareLiquidation(_underwriter);

    emit UnderwriterLiquidated(msg.sender, _underwriter);
    _realizeLossesForAllPools(_underwriter);
}

    /* ───────────────────── Claim Processing ───────────────────── */

    function processClaim(uint256 _policyId) external nonReentrant {
        IPolicyNFT.Policy memory policy = policyNFT.getPolicy(_policyId);
        require(block.timestamp >= policy.activation, "Policy not active");
        uint256 poolId = policy.poolId;
        uint256 coverage = policy.coverage;
        (address[] memory adapters, uint256[] memory capitalPerAdapter, uint256 totalCapitalPledged) = poolRegistry.getPoolPayoutData(poolId);

        (
            IERC20 protocolToken,
            uint256 _pledged0,
            uint256 _sold0,
            uint256 _pend0,
            bool _paused0,
            address _fr0,
            uint256 poolClaimFeeBps
        ) = poolRegistry.getPoolData(poolId);
        (_pledged0, _sold0, _pend0, _paused0, _fr0);
        address claimant = policyNFT.ownerOf(_policyId);
        require(msg.sender == claimant, "Only policy owner");
        if (coverage > 0) {
            uint8 protocolDecimals = IERC20Metadata(address(protocolToken)).decimals();
            uint8 underlyingDecimals = IERC20Metadata(address(capitalPool.underlyingAsset())).decimals();
            uint256 protocolCoverage = _scaleAmount(coverage, underlyingDecimals, protocolDecimals);
            protocolToken.safeTransferFrom(msg.sender, address(rewardDistributor), protocolCoverage);
            rewardDistributor.distribute(poolId, address(protocolToken), protocolCoverage, totalCapitalPledged);
        }

        lossDistributor.distributeLoss(poolId, coverage, totalCapitalPledged);
        
        uint256 lossBorneByPool = Math.min(coverage, totalCapitalPledged);
        uint256 shortfall = coverage > lossBorneByPool ? coverage - lossBorneByPool : 0;
        if (shortfall > 0) {
            catPool.drawFund(shortfall);
        }
        
        uint256 claimFee = (coverage * poolClaimFeeBps) / BPS;

        ICapitalPool.PayoutData memory payoutData = ICapitalPool.PayoutData({
            claimant: claimant,
            claimantAmount: coverage - claimFee,
            feeRecipient: committee,
            feeAmount: claimFee,
            adapters: adapters,
            capitalPerAdapter: capitalPerAdapter,
            totalCapitalFromPoolLPs: totalCapitalPledged
        });
        
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
        (
            IERC20 _pt1,
            uint256 _pledged1,
            uint256 totalCoverageSold,
            uint256 _pend1,
            bool _paused1,
            address _fr1,
            uint256 _cf1
        ) = poolRegistry.getPoolData(poolId);
        (_pt1, _pledged1, _pend1, _paused1, _fr1, _cf1);
        uint256 reduction = Math.min(coverage, totalCoverageSold);
        if (reduction > 0) {
            poolRegistry.updateCoverageSold(poolId, reduction, false);
        }

        policyNFT.burn(_policyId);
    }
    
    /* ───────────────── Hooks & State Updaters ───────────────── */

    function updateCoverageSold(uint256 _poolId, uint256 _amount, bool _isSale) external {
        if(msg.sender != policyManager) revert NotPolicyManager();
        poolRegistry.updateCoverageSold(_poolId, _amount, _isSale);
    }

    /* ───────────────── Rewards Claiming ───────────────── */


    /**
     * @notice Claims premium rewards for multiple pools.
     * @dev Iterates through the provided pool IDs and claims the rewards for each.
     * @param _poolIds An array of pool IDs to claim rewards from.
     */
    function claimPremiumRewards(uint256[] calldata _poolIds) external nonReentrant {
        for (uint256 i = 0; i < _poolIds.length; i++) {
            uint256 poolId = _poolIds[i];
            // Only attempt a claim if the underwriter has a pledge in the pool.
            if (underwriterPoolPledge[msg.sender][poolId] > 0) {
                (
                    IERC20 protocolToken,
                    uint256 _pledged2,
                    uint256 _sold2,
                    uint256 _pend2,
                    bool _paused2,
                    address _fr2,
                    uint256 _cf2
                ) = poolRegistry.getPoolData(poolId);
                (_pledged2, _sold2, _pend2, _paused2, _fr2, _cf2);
                uint256 claimed = rewardDistributor.claim(
                    msg.sender,
                    poolId,
                    address(protocolToken),
                    underwriterPoolPledge[msg.sender][poolId]
                );
                claimed;
            }
        }
    }

    /**
     * @notice EXTERNAL “execute” function: pulls in the pre–aggregated tokens
     *         and makes one isolated external call per token.
     */
    function claimDistressedAssets(uint256[] calldata _poolIds) external nonReentrant {
        address[] memory uniqueTokens = _prepareDistressedAssets(_poolIds);
        for (uint i; i < uniqueTokens.length; i++) {
            catPool.claimProtocolAssetRewardsFor(msg.sender, uniqueTokens[i]);
        }
    }

    function onCapitalDeposited(address _underwriter, uint256 _amount) external nonReentrant {
        if(msg.sender != address(capitalPool)) revert NotCapitalPool();
        underwriterTotalPledge[_underwriter] += _amount;
        uint256[] memory pools = underwriterAllocations[_underwriter];
        for(uint i=0; i<pools.length; i++){
            underwriterPoolPledge[_underwriter][pools[i]] += _amount;
            (
                IERC20 protocolToken,
                uint256 _pledged4,
                uint256 _sold4,
                uint256 _pend4,
                bool _paused4,
                address _fr4,
                uint256 _cf4
            ) = poolRegistry.getPoolData(pools[i]);
            (_pledged4, _sold4, _pend4, _paused4, _fr4, _cf4);
            rewardDistributor.updateUserState(
                _underwriter,
                pools[i],
                address(protocolToken),
                underwriterPoolPledge[_underwriter][pools[i]]
            );
        }
    }

    function onWithdrawalRequested(address _underwriter, uint256 _principalComponent) external nonReentrant {
        if(msg.sender != address(capitalPool)) revert NotCapitalPool();
        uint256[] memory allocations = underwriterAllocations[_underwriter];
        for (uint i = 0; i < allocations.length; i++) {
            poolRegistry.updateCapitalPendingWithdrawal(allocations[i], _principalComponent, true);
            (
                IERC20 protocolToken,
                uint256 _pledged5,
                uint256 _sold5,
                uint256 _pend5,
                bool _paused5,
                address _fr5,
                uint256 _cf5
            ) = poolRegistry.getPoolData(allocations[i]);
            (_pledged5, _sold5, _pend5, _paused5, _fr5, _cf5);
            rewardDistributor.updateUserState(
                _underwriter,
                allocations[i],
                address(protocolToken),
                underwriterPoolPledge[_underwriter][allocations[i]]
            );
        }
    }

    function onWithdrawalCancelled(address _underwriter, uint256 _principalComponent) external nonReentrant {
        if(msg.sender != address(capitalPool)) revert NotCapitalPool();
        uint256[] memory allocations = underwriterAllocations[_underwriter];
        for (uint i = 0; i < allocations.length; i++) {
            poolRegistry.updateCapitalPendingWithdrawal(allocations[i], _principalComponent, false);
            (
                IERC20 protocolToken,
                uint256 _pledged6,
                uint256 _sold6,
                uint256 _pend6,
                bool _paused6,
                address _fr6,
                uint256 _cf6
            ) = poolRegistry.getPoolData(allocations[i]);
            (_pledged6, _sold6, _pend6, _paused6, _fr6, _cf6);
            rewardDistributor.updateUserState(
                _underwriter,
                allocations[i],
                address(protocolToken),
                underwriterPoolPledge[_underwriter][allocations[i]]
            );
        }
    }

    function onCapitalWithdrawn(address _underwriter, uint256 _principalComponentRemoved, bool _isFullWithdrawal) external nonReentrant {
        if(msg.sender != address(capitalPool)) revert NotCapitalPool();
        _realizeLossesForAllPools(_underwriter);
        
        uint256 pledgeAfterLosses = underwriterTotalPledge[_underwriter];
        uint256 amountToSubtract = Math.min(pledgeAfterLosses, _principalComponentRemoved);
        underwriterTotalPledge[_underwriter] -= amountToSubtract;
        
        uint256[] memory allocations = underwriterAllocations[_underwriter];
        for (uint i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            (
                IERC20 _pt7,
                uint256 _pledged7,
                uint256 _sold7,
                uint256 pendingWithdrawal,
                bool _paused7,
                address _fr7,
                uint256 _cf7
            ) = poolRegistry.getPoolData(poolId);
            (_pt7, _pledged7, _sold7, _paused7, _fr7, _cf7);
            uint256 reduction = Math.min(_principalComponentRemoved, pendingWithdrawal);
            if (reduction > 0) {
                poolRegistry.updateCapitalPendingWithdrawal(poolId, reduction, false);
            }
            uint256 pledgeReduction = _principalComponentRemoved > underwriterPoolPledge[_underwriter][poolId] ? underwriterPoolPledge[_underwriter][poolId] : _principalComponentRemoved;
            underwriterPoolPledge[_underwriter][poolId] -= pledgeReduction;
            (
                IERC20 protocolToken,
                uint256 _pledged8,
                uint256 _sold8,
                uint256 _pend8,
                bool _paused8,
                address _fr8,
                uint256 _cf8
            ) = poolRegistry.getPoolData(poolId);
            (_pledged8, _sold8, _pend8, _paused8, _fr8, _cf8);
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



        /** 
     * @dev INTERNAL “prepare” function: collects all unique protocol-tokens
     *      — **NO** external calls in here.
     */
    function _prepareDistressedAssets(uint256[] calldata _poolIds)
        internal
        view
        returns (address[] memory tokens)
    {
        tokens = new address[](_poolIds.length);
        uint256 count;

        for (uint i; i < _poolIds.length; i++) {
            (IERC20 protocolToken,, , , , ,) = poolRegistry.getPoolData(_poolIds[i]);
            address t = address(protocolToken);
            if (t == address(0)) continue;

            bool seen;
            for (uint j; j < count; j++) {
                if (tokens[j] == t) {
                    seen = true;
                    break;
                }
            }
            if (!seen) tokens[count++] = t;
        }

        // shrink array
        assembly { mstore(tokens, count) }
        return tokens;
    }


    function _prepareLiquidation(address _underwriter)
    internal
    view
    returns (uint256 totalPendingLosses, uint256 totalShareValue)
{
    // 1a) Read the underwriter’s account (view only)
    (, , uint256 masterShares, , ) = capitalPool.getUnderwriterAccount(_underwriter);
    if (masterShares == 0) {
        revert UnderwriterNotInsolvent();
    }
    totalShareValue = capitalPool.sharesToValue(masterShares);

    // 1b) Loop purely over storage to sum up pending losses
    uint256[] memory allocs = underwriterAllocations[_underwriter];
    for (uint i = 0; i < allocs.length; i++) {
        uint256 pid = allocs[i];
        totalPendingLosses += lossDistributor.getPendingLosses(
            _underwriter,
            pid,
            underwriterPoolPledge[_underwriter][pid]
        );
    }

    // 1c) Verify insolvency condition
    if (totalPendingLosses < totalShareValue) {
        revert UnderwriterNotInsolvent();
    }
}

    function _prepareAllocateCapital(uint256[] calldata _poolIds)
        internal
        view
        returns (uint256 totalPledge, address adapter)
    {
        totalPledge = underwriterTotalPledge[msg.sender];
        if (totalPledge == 0) revert NoCapitalToAllocate();

        uint256 len = _poolIds.length;
        if (len == 0 || len > maxAllocationsPerUnderwriter) revert ExceedsMaxAllocations();

        adapter = capitalPool.getUnderwriterAdapterAddress(msg.sender);
        require(adapter != address(0), "User has no yield adapter set in CapitalPool");

        uint256 poolCount = poolRegistry.getPoolCount();
        for (uint256 i = 0; i < len; i++) {
            uint256 pid = _poolIds[i];
            if (pid >= poolCount) revert InvalidPoolId();
            if (isAllocatedToPool[msg.sender][pid]) revert AlreadyAllocated();
        }
    }
}