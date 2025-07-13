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

// Events are defined at the file level so they can be imported directly in tests.
event DeallocationRequested(address indexed underwriter, uint256 indexed poolId, uint256 amount, uint256 timestamp);

event UnderwriterLiquidated(address indexed liquidator, address indexed underwriter);

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

    function getUnderwriterAllocations(address user) external view returns (uint256[] memory) {
        return underwriterAllocations[user];
    }

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
    event CapitalAllocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event CapitalDeallocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event DeallocationNoticePeriodSet(uint256 newPeriod);
    event MaxAllocationsPerUnderwriterSet(uint256 newMax);

    /* ───────────────────── Constructor & Setup ───────────────────── */

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    function setAddresses(address capital, address registry, address policy, address cat, address loss, address rewards)
        external
        onlyOwner
    {
        require(
            capital != address(0) && registry != address(0) && policy != address(0) && cat != address(0)
                && loss != address(0) && rewards != address(0),
            "Zero address not allowed"
        );
        capitalPool = ICapitalPool(capital);
        poolRegistry = IPoolRegistry(registry);
        policyManager = policy;
        policyNFT = IPolicyManager(policy).policyNFT();
        catPool = IBackstopPool(cat);
        lossDistributor = ILossDistributor(loss);
        rewardDistributor = IRewardDistributor(rewards);
        emit AddressesSet(capital, registry, policy, cat, loss, rewards);
    }

    function setCommittee(address newCommittee) external onlyOwner {
        require(newCommittee != address(0), "Zero address not allowed");
        committee = newCommittee;
        emit CommitteeSet(newCommittee);
    }

    function setMaxAllocationsPerUnderwriter(uint256 newMax) external onlyOwner {
        require(newMax > 0, "Invalid max");
        maxAllocationsPerUnderwriter = newMax;
        emit MaxAllocationsPerUnderwriterSet(newMax);
    }

    function setDeallocationNoticePeriod(uint256 newPeriod) external onlyOwner {
        deallocationNoticePeriod = newPeriod;
        emit DeallocationNoticePeriodSet(newPeriod);
    }

    /**
     * @notice Wrapper for PoolRegistry.addProtocolRiskPool restricted to the owner.
     * @dev Enables governance to create new pools through the RiskManager.
     */
    function addProtocolRiskPool(
        address protocolTokenToCover,
        IPoolRegistry.RateModel calldata rateModel,
        uint256 claimFeeBps
    ) external onlyOwner returns (uint256) {
        return poolRegistry.addProtocolRiskPool(protocolTokenToCover, rateModel, claimFeeBps);
    }

    /* ──────────────── Underwriter Capital Allocation ──────────────── */

    function allocateCapital(uint256[] calldata poolIds) external nonReentrant {
        // ─── PREPARE / CHECKS ─────────────────────────────────────────────────
        (uint256 totalPledge, address adapter) = _prepareAllocateCapital(poolIds);

        // ─── EFFECTS & INTERACTIONS ────────────────────────────────────────────
        // We do effects (storage updates) immediately before each external call
        // to PoolRegistry.updateCapitalAllocation, then emit.
        for (uint256 i = 0; i < poolIds.length; i++) {
            uint256 poolId = poolIds[i];

            // Effects
            underwriterPoolPledge[msg.sender][poolId] = totalPledge;
            isAllocatedToPool[msg.sender][poolId] = true;
            underwriterAllocations[msg.sender].push(poolId);
            poolSpecificUnderwriters[poolId].push(msg.sender);
            underwriterIndexInPoolArray[poolId][msg.sender] = poolSpecificUnderwriters[poolId].length - 1;

            // Interaction (one external call per pool)
            poolRegistry.updateCapitalAllocation(poolId, adapter, totalPledge, true);

            emit CapitalAllocated(msg.sender, poolId, totalPledge);
        }
    }

    function requestDeallocateFromPool(uint256 poolId, uint256 amount) external nonReentrant {
        address underwriter = msg.sender;
        uint256 poolCount = poolRegistry.getPoolCount();
        require(poolId < poolCount, "Invalid poolId");
        require(isAllocatedToPool[underwriter][poolId], "Not allocated to this pool");
        if (deallocationRequestTimestamp[underwriter][poolId] != 0) revert DeallocationRequestPending();

        require(amount > 0, "Invalid amount");
        uint256 totalPledge = underwriterTotalPledge[underwriter];
        uint256 currentPledge = underwriterPoolPledge[underwriter][poolId];
        require(amount <= currentPledge, "Amount exceeds pledge");
        if (totalPledge == 0) revert NoCapitalToAllocate();

        (
            IERC20 _pt,
            uint256 totalPledged,
            uint256 totalSold,
            uint256 pendingWithdrawal,
            bool _paused,
            address _fr,
            uint256 _cf
        ) = poolRegistry.getPoolData(poolId);
        (_pt, _paused, _fr, _cf);
        uint256 freeCapital =
            totalPledged > totalSold + pendingWithdrawal ? totalPledged - totalSold - pendingWithdrawal : 0;
        if (amount > freeCapital) revert InsufficientFreeCapital();

        deallocationRequestTimestamp[underwriter][poolId] = block.timestamp;
        deallocationRequestAmount[underwriter][poolId] = amount;
        poolRegistry.updateCapitalPendingWithdrawal(poolId, amount, true);
        emit DeallocationRequested(underwriter, poolId, amount, block.timestamp);
    }

function deallocateFromPool(uint256 poolId) external nonReentrant {
    address underwriter = msg.sender;
    uint256 requestTime = deallocationRequestTimestamp[underwriter][poolId];
    uint256 requestedAmount = deallocationRequestAmount[underwriter][poolId]; // The original request amount

    // 1. Initial Validation
    if (requestTime == 0) revert NoDeallocationRequest();
    if (block.timestamp < requestTime + deallocationNoticePeriod) revert NoticePeriodActive();

    // 2. Realize any new losses that occurred since the request was made.
    _realizeLossesForAllPools(underwriter);

    // 3. The Safety Check (THE FIX)
    uint256 pledgeAfterLosses = underwriterPoolPledge[underwriter][poolId];
    
    // Determine the actual amount to deallocate. It's the lesser of what was
    // requested and what the underwriter has left after losses.
    uint256 finalAmountToDeallocate = Math.min(requestedAmount, pledgeAfterLosses);

    uint256 remainingPledge = pledgeAfterLosses - finalAmountToDeallocate;

    // 4. State Updates
    address userAdapterAddress = capitalPool.getUnderwriterAdapterAddress(underwriter);
    require(userAdapterAddress != address(0), "User has no yield adapter set in CapitalPool");

    underwriterPoolPledge[underwriter][poolId] = remainingPledge;
    
    // If the user's pledge in this pool is now zero, remove them.
    if (remainingPledge == 0) {
        _removeUnderwriterFromPool(underwriter, poolId);
    }

    // Clear the completed withdrawal request.
    delete deallocationRequestTimestamp[underwriter][poolId];
    delete deallocationRequestAmount[underwriter][poolId];

    // 5. Final Interactions
    // Update the PoolRegistry using the safe, final deallocation amount.
    poolRegistry.updateCapitalAllocation(poolId, userAdapterAddress, finalAmountToDeallocate, false);
    poolRegistry.updateCapitalPendingWithdrawal(poolId, finalAmountToDeallocate, false);

    emit CapitalDeallocated(underwriter, poolId, finalAmountToDeallocate);
}

    // CORRECTED: Added missing governance hook functions
    /* ───────────────────── Governance Hooks ───────────────────── */

    /**
     * @notice Called by the Committee to pause/unpause a pool following a successful vote.
     * @param poolId The ID of the pool to update.
     * @param pauseState The new pause state (true = paused, false = unpaused).
     */
    function reportIncident(uint256 poolId, bool pauseState) external {
        if (msg.sender != committee) revert NotCommittee();
        poolRegistry.setPauseState(poolId, pauseState);
    }

    /**
     * @notice Called by the Committee to set the fee recipient for a pool.
     * @dev Typically used to redirect fees to the Committee contract during an incident.
     * @param poolId The ID of the pool to update.
     * @param recipient The address of the new fee recipient.
     */
    function setPoolFeeRecipient(uint256 poolId, address recipient) external {
        if (msg.sender != committee) revert NotCommittee();
        poolRegistry.setFeeRecipient(poolId, recipient);
    }

    /* ───────────────────── Keeper & Liquidation Functions ───────────────────── */

    function liquidateInsolventUnderwriter(address underwriter) external nonReentrant {
        // ─── CHECKS & PREPARE ─────────────────────────────────────────────────
        (uint256 pendingLosses, uint256 shareValue) = _prepareLiquidation(underwriter);

        emit UnderwriterLiquidated(msg.sender, underwriter);
        _realizeLossesForAllPools(underwriter);
    }

    /* ───────────────────── Claim Processing ───────────────────── */

    function processClaim(uint256 policyId) external nonReentrant {
        IPolicyNFT.Policy memory policy = policyNFT.getPolicy(policyId);
        require(block.timestamp >= policy.activation, "Policy not active");
        uint256 poolId = policy.poolId;
        uint256 coverage = policy.coverage;
        (address[] memory adapters, uint256[] memory capitalPerAdapter, uint256 totalCapitalPledged) =
            poolRegistry.getPoolPayoutData(poolId);

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
        address claimant = policyNFT.ownerOf(policyId);
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

        policyNFT.burn(policyId);
    }

    /* ───────────────── Hooks & State Updaters ───────────────── */

    function updateCoverageSold(uint256 poolId, uint256 amount, bool isSale) external {
        if (msg.sender != policyManager) revert NotPolicyManager();
        poolRegistry.updateCoverageSold(poolId, amount, isSale);
    }

    /* ───────────────── Rewards Claiming ───────────────── */

    /**
     * @notice Claims premium rewards for multiple pools.
     * @dev Iterates through the provided pool IDs and claims the rewards for each.
     * @param poolIds An array of pool IDs to claim rewards from.
     */
    function claimPremiumRewards(uint256[] calldata poolIds) external nonReentrant {
        // 1. Fetch all pool data in a single, efficient call
        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(poolIds);

        for (uint256 i = 0; i < poolIds.length; i++) {
            uint256 poolId = poolIds[i];

            // 2. Only attempt a claim if the underwriter has a pledge in the pool.
            if (underwriterPoolPledge[msg.sender][poolId] > 0) {
                // 3. Get the specific pool's data from our pre-fetched array
                IPoolRegistry.PoolInfo memory poolData = allPoolData[i];

                // 4. Make the external call. The nonReentrant modifier protects this.
                uint256 claimed = rewardDistributor.claim(
                    msg.sender,
                    poolId,
                    address(poolData.protocolTokenToCover),
                    underwriterPoolPledge[msg.sender][poolId]
                );
                // You can use the 'claimed' variable if needed
                claimed;
            }
        }
    }

    /**
     * @notice EXTERNAL “execute” function: pulls in the pre–aggregated tokens
     *         and makes one isolated external call per token.
     */
    function claimDistressedAssets(uint256[] calldata poolIds) external nonReentrant {
        address[] memory uniqueTokens = _prepareDistressedAssets(poolIds);
        for (uint256 i; i < uniqueTokens.length; i++) {
            catPool.claimProtocolAssetRewardsFor(msg.sender, uniqueTokens[i]);
        }
    }

    function onCapitalDeposited(address underwriter, uint256 amount) external nonReentrant {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();

        underwriterTotalPledge[underwriter] += amount;
        uint256[] memory pools = underwriterAllocations[underwriter];

        // 1. Fetch all required pool data in a single external call before the loop.
        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(pools);

        for (uint256 i = 0; i < pools.length; i++) {
            underwriterPoolPledge[underwriter][pools[i]] += amount;

            // 2. Get the protocol token from the data we already fetched.
            address protocolToken = address(allPoolData[i].protocolTokenToCover);

            // 3. Call the reward distributor with the pre-fetched data.
            rewardDistributor.updateUserState(
                underwriter, pools[i], protocolToken, underwriterPoolPledge[underwriter][pools[i]]
            );
        }
    }

    function onWithdrawalRequested(address underwriter, uint256 principalComponent) external nonReentrant {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();

        uint256[] memory allocations = underwriterAllocations[underwriter];

        // 1 Fetch all pool data at once to save gas.
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

    function onWithdrawalCancelled(address underwriter, uint256 principalComponent) external nonReentrant {
        if (msg.sender != address(capitalPool)) revert NotCapitalPool();

        uint256[] memory allocations = underwriterAllocations[underwriter];

        // 1. Fetch all necessary pool data in a single, efficient call.
        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(allocations);

        for (uint256 i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];

            poolRegistry.updateCapitalPendingWithdrawal(poolId, principalComponent, false);

            address protocolToken = address(allPoolData[i].protocolTokenToCover);

            rewardDistributor.updateUserState(
                underwriter, poolId, protocolToken, underwriterPoolPledge[underwriter][poolId]
            );
        }
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

        uint256[] memory allocations = underwriterAllocations[underwriter];

        // 1. Fetch all pool data at once, replacing two separate calls inside the loop.
        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(allocations);

        for (uint256 i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];

            // 2. Get data from our pre-fetched array instead of making external calls.
            IPoolRegistry.PoolInfo memory poolData = allPoolData[i];
            uint256 pendingWithdrawal = poolData.capitalPendingWithdrawal;
            address protocolToken = address(poolData.protocolTokenToCover);

            uint256 reduction = Math.min(principalComponentRemoved, pendingWithdrawal);
            if (reduction > 0) {
                poolRegistry.updateCapitalPendingWithdrawal(poolId, reduction, false);
            }

            uint256 pledgeReduction = principalComponentRemoved > underwriterPoolPledge[underwriter][poolId]
                ? underwriterPoolPledge[underwriter][poolId]
                : principalComponentRemoved;
            underwriterPoolPledge[underwriter][poolId] -= pledgeReduction;

            rewardDistributor.updateUserState(
                underwriter, poolId, protocolToken, underwriterPoolPledge[underwriter][poolId]
            );

            if (isFullWithdrawal || underwriterPoolPledge[underwriter][poolId] == 0) {
                _removeUnderwriterFromPool(underwriter, poolId);
            }
        }
        if (isFullWithdrawal) {
            delete underwriterAllocations[underwriter];
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

    /**
     * @dev INTERNAL “prepare” function: collects all unique protocol-tokens
     *      — **NO** external calls in here.
     */
    function _prepareDistressedAssets(uint256[] calldata _poolIds) internal view returns (address[] memory tokens) {
        // 1. Fetch all pool data at once instead of in a loop.
        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(_poolIds);

        address[] memory uniqueTokens = new address[](_poolIds.length);
        uint256 count;

        for (uint256 i = 0; i < allPoolData.length; i++) {
            // 2. Get the token directly from the pre-fetched data.
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

        // Create a new array with the exact size and copy the unique tokens.
        tokens = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            tokens[i] = uniqueTokens[i];
        }

        return tokens;
    }

    function _prepareLiquidation(address _underwriter)
        internal
        view
        returns (uint256 totalPendingLosses, uint256 totalShareValue)
    {
        // 1a) Read the underwriter’s account (view only)
        (,, uint256 masterShares,,) = capitalPool.getUnderwriterAccount(_underwriter);
        if (masterShares == 0) {
            revert UnderwriterNotInsolvent();
        }
        totalShareValue = capitalPool.sharesToValue(masterShares);

        // 1b) Loop purely over storage to sum up pending losses
        uint256[] memory allocs = underwriterAllocations[_underwriter];
        for (uint256 i = 0; i < allocs.length; i++) {
            uint256 pid = allocs[i];
            totalPendingLosses +=
                lossDistributor.getPendingLosses(_underwriter, pid, underwriterPoolPledge[_underwriter][pid]);
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
