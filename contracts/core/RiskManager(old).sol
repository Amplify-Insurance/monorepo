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

    /**
     * @dev A struct to hold all necessary data for claim processing,
     * used to avoid "Stack too deep" errors.
     */
    struct ClaimData {
        IPolicyNFT.Policy policy;
        address claimant;
        uint256 totalCapitalPledged;
        IERC20 protocolToken;
        uint256 poolClaimFeeBps;
        address[] adapters;
        uint256[] capitalPerAdapter;
        uint256 totalCoverageSold;
    }

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

    /**
     * @notice Submits a request to deallocate capital from a specific pool.
     * @dev This function is the first step in the deallocation process. It initiates a notice period.
     * @param poolId The ID of the pool to deallocate from.
     * @param amount The amount of capital to request for deallocation.
     */
    function requestDeallocateFromPool(uint256 poolId, uint256 amount) external nonReentrant {
        // --- CHECKS ---
        // All validation is moved to a separate internal function to avoid
        // a "stack too deep" error by isolating the stack-intensive call.
        _checkDeallocationRequest(msg.sender, poolId, amount);

        // --- EFFECTS & INTERACTIONS ---
        // If the checks pass, proceed with the state changes.
        deallocationRequestTimestamp[msg.sender][poolId] = block.timestamp;
        deallocationRequestAmount[msg.sender][poolId] = amount;
        poolRegistry.updateCapitalPendingWithdrawal(poolId, amount, true);
        emit DeallocationRequested(msg.sender, poolId, amount, block.timestamp);
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
        (pendingLosses, shareValue); // silence unused variable warning

        emit UnderwriterLiquidated(msg.sender, underwriter);
        _realizeLossesForAllPools(underwriter);
    }

    /* ───────────────────── Claim Processing ───────────────────── */

    /**
     * @notice Processes a claim against a policy.
     * @dev This function is the core of the claim process, orchestrating loss distribution,
     * payouts, and state updates. It is protected against "Stack too deep" errors
     * by using the `_prepareClaimData` helper function.
     * @param policyId The ID of the policy NFT being claimed.
     */
    function processClaim(uint256 policyId) external nonReentrant {
        // --- 1. PREPARE & VALIDATE ---
        // Gather all required data in a memory struct to avoid stack issues.
        ClaimData memory data = _prepareClaimData(policyId);

        // The claimant check must be in the external function for access control.
        require(msg.sender == data.claimant, "Only policy owner");

        uint256 poolId = data.policy.poolId;
        uint256 coverage = data.policy.coverage;

        // --- 2. PREMIUM DISTRIBUTION (if applicable) ---
        // If the policy had coverage, the claimant must have provided the protocol tokens
        // as a premium. These are distributed to the pool's underwriters.
        if (coverage > 0) {
            uint8 protocolDecimals = IERC20Metadata(address(data.protocolToken)).decimals();
            uint8 underlyingDecimals = IERC20Metadata(address(capitalPool.underlyingAsset())).decimals();
            uint256 protocolCoverage = _scaleAmount(coverage, underlyingDecimals, protocolDecimals);
            data.protocolToken.safeTransferFrom(msg.sender, address(rewardDistributor), protocolCoverage);
            rewardDistributor.distribute(poolId, address(data.protocolToken), protocolCoverage, data.totalCapitalPledged);
        }

        // --- 3. LOSS DISTRIBUTION ---
        // Distribute the loss across all underwriters in the pool and handle any shortfall.
        lossDistributor.distributeLoss(poolId, coverage, data.totalCapitalPledged);

        uint256 lossBorneByPool = Math.min(coverage, data.totalCapitalPledged);
        uint256 shortfall = coverage > lossBorneByPool ? coverage - lossBorneByPool : 0;
        if (shortfall > 0) {
            catPool.drawFund(shortfall);
        }

        // --- 4. PAYOUT EXECUTION ---
        // Calculate the claim fee and construct the payout data.
        uint256 claimFee = (coverage * data.poolClaimFeeBps) / BPS;

        ICapitalPool.PayoutData memory payoutData = ICapitalPool.PayoutData({
            claimant: data.claimant,
            claimantAmount: coverage - claimFee,
            feeRecipient: committee,
            feeAmount: claimFee,
            adapters: data.adapters,
            capitalPerAdapter: data.capitalPerAdapter,
            totalCapitalFromPoolLPs: data.totalCapitalPledged
        });

        // Trigger the payout from the CapitalPool.
        capitalPool.executePayout(payoutData);

        // --- 5. STATE UPDATES (Post-Payout) ---
        // Reduce the capital allocation of each underwriter's adapter based on the loss.
        if (lossBorneByPool > 0 && data.totalCapitalPledged > 0) {
            for (uint256 i = 0; i < data.adapters.length; i++) {
                uint256 adapterLoss = (lossBorneByPool * data.capitalPerAdapter[i]) / data.totalCapitalPledged;
                if (adapterLoss > 0) {
                    poolRegistry.updateCapitalAllocation(poolId, data.adapters[i], adapterLoss, false);
                }
            }
        }

        // Update the total coverage sold for the pool.
        uint256 reduction = Math.min(coverage, data.totalCoverageSold);
        if (reduction > 0) {
            poolRegistry.updateCoverageSold(poolId, reduction, false);
        }

        // Burn the used policy NFT.
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
     * and makes one isolated external call per token.
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

        // FIX: Pre-fetching the data is still efficient, so we keep it.
        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(allocations);

        for (uint256 i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];

            // FIX: The reduction amount is simply the principalComponent of the cancelled request.
            // The Math.min check was incorrect and has been removed. A simple underflow check is sufficient.
            if (principalComponent > 0 && allPoolData[i].capitalPendingWithdrawal >= principalComponent) {
                poolRegistry.updateCapitalPendingWithdrawal(poolId, principalComponent, false);
            }

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

        // Reduce the underwriter's total pledge.
        uint256 pledgeAfterLosses = underwriterTotalPledge[underwriter];
        uint256 amountToSubtract = Math.min(pledgeAfterLosses, principalComponentRemoved);
        underwriterTotalPledge[underwriter] -= amountToSubtract;

        uint256[] memory allocations = underwriterAllocations[underwriter];

        // Fetch all pool data at once to avoid multiple external calls inside the loop.
        IPoolRegistry.PoolInfo[] memory allPoolData = poolRegistry.getMultiplePoolData(allocations);

        // Loop through each allocation and process the withdrawal.
        // The logic is moved to a helper function to avoid "Stack too deep" errors.
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

        // If it was a full withdrawal, clear the underwriter's allocation array.
        if (isFullWithdrawal) {
            delete underwriterAllocations[underwriter];
        }
    }

    /* ───────────────── Internal Functions ───────────────── */

    /**
     * @dev Internal function to process the withdrawal logic for a single pool.
     * @notice This is separated from `onCapitalWithdrawn` to prevent "Stack too deep" errors.
     * @param pendingWithdrawal The amount of capital pending withdrawal in the pool.
     * @param protocolToken The protocol token associated with the pool.
     */
    function _processWithdrawalForPool(
        address underwriter,
        uint256 poolId,
        uint256 principalComponentRemoved,
        bool isFullWithdrawal,
        uint256 pendingWithdrawal,
        address protocolToken
    ) internal {
        // Update the amount of capital pending withdrawal in the pool.
        uint256 reduction = Math.min(principalComponentRemoved, pendingWithdrawal);
        if (reduction > 0) {
            poolRegistry.updateCapitalPendingWithdrawal(poolId, reduction, false);
        }

        // Calculate the new pledge amount for the underwriter in this pool.
        uint256 currentPoolPledge = underwriterPoolPledge[underwriter][poolId];
        uint256 newPoolPledge = (principalComponentRemoved >= currentPoolPledge)
            ? 0
            : currentPoolPledge - principalComponentRemoved;

        // Update the underwriter's pledge for the pool.
        underwriterPoolPledge[underwriter][poolId] = newPoolPledge;

        // Update the user's state in the reward distributor with the new pledge amount.
        rewardDistributor.updateUserState(
            underwriter, poolId, protocolToken, newPoolPledge
        );

        // If the pledge is now zero or it's a full withdrawal, remove the underwriter from the pool.
        if (isFullWithdrawal || newPoolPledge == 0) {
            _removeUnderwriterFromPool(underwriter, poolId);
        }
    }


    function _prepareClaimData(uint256 _policyId) internal view returns (ClaimData memory data) {
        data.policy = policyNFT.getPolicy(_policyId);
        require(block.timestamp >= data.policy.activation, "Policy not active");

        data.claimant = policyNFT.ownerOf(_policyId);

        (data.adapters, data.capitalPerAdapter, data.totalCapitalPledged) =
            poolRegistry.getPoolPayoutData(data.policy.poolId);

        (
            data.protocolToken,
            , // _pledged
            data.totalCoverageSold,
            , // _pending
            , // _paused
            , // _feeRecipient
            data.poolClaimFeeBps
        ) = poolRegistry.getPoolData(data.policy.poolId);
    }


    function _checkDeallocationRequest(address _underwriter, uint256 _poolId, uint256 _amount) internal view {
        // --- VALIDATION ---
        require(_poolId < poolRegistry.getPoolCount(), "Invalid poolId");
        require(isAllocatedToPool[_underwriter][_poolId], "Not allocated to this pool");
        if (deallocationRequestTimestamp[_underwriter][_poolId] != 0) revert DeallocationRequestPending();

        require(_amount > 0, "Invalid amount");
        uint256 currentPledge = underwriterPoolPledge[_underwriter][_poolId];
        require(_amount <= currentPledge, "Amount exceeds pledge");
        if (underwriterTotalPledge[_underwriter] == 0) revert NoCapitalToAllocate();

        // The call that returns many variables and causes the stack issue.
        // We only use the variables we need and discard the rest by leaving them unnamed.
        (
            /* IERC20 _pt */,
            uint256 totalPledged,
            uint256 totalSold,
            uint256 pendingWithdrawal,
            /* bool _paused */,
            /* address _fr */,
            /* uint256 _cf */
        ) = poolRegistry.getPoolData(_poolId);

        // Check if there is enough unutilized capital in the pool.
        uint256 freeCapital =
            totalPledged > totalSold + pendingWithdrawal ? totalPledged - totalSold - pendingWithdrawal : 0;
        if (_amount > freeCapital) revert InsufficientFreeCapital();
    }

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
     * — **NO** external calls in here.
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