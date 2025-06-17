// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IPolicyNFT.sol";
import "../interfaces/IPoolRegistry.sol";
import "../interfaces/ICapitalPool.sol";
import "../interfaces/ICatInsurancePool.sol";
import "../interfaces/ILossDistributor.sol";
import "../interfaces/IPolicyManager.sol";

/**
 * @title RiskManager
 * @author Gemini
 * @notice A lean orchestrator for a decentralized insurance protocol. It manages capital allocation,
 * claim processing, and liquidations by coordinating with specialized satellite contracts.
 */
contract RiskManager is Ownable, ReentrancyGuard {

    /* ───────────────────────── State Variables ───────────────────────── */
    ICapitalPool public capitalPool;
    IPoolRegistry public poolRegistry;
    IPolicyNFT public policyNFT;
    ICatInsurancePool public catPool;
    ILossDistributor public lossDistributor;
    address public policyManager;
    address public committee;

    mapping(address => uint256) public underwriterTotalPledge;
    mapping(uint256 => address[]) public poolSpecificUnderwriters;
    mapping(address => uint256[]) public underwriterAllocations;
    mapping(address => mapping(uint256 => bool)) public isAllocatedToPool;
    mapping(uint256 => mapping(address => uint256)) public underwriterIndexInPoolArray;
    
    uint256 public constant MAX_ALLOCATIONS_PER_UNDERWRITER = 5;
    uint256 public constant CLAIM_FEE_BPS = 500;
    uint256 public constant BPS = 10_000;

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

    event AddressesSet(address capital, address registry, address policy, address cat, address loss);
    event CommitteeSet(address committee);
    event UnderwriterLiquidated(address indexed liquidator, address indexed underwriter);
    event CapitalAllocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);
    event CapitalDeallocated(address indexed underwriter, uint256 indexed poolId, uint256 amount);

    /* ───────────────────── Constructor & Setup ───────────────────── */

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    function setAddresses(address _capital, address _registry, address _policy, address _cat, address _loss) external onlyOwner {
        require(
            _capital != address(0) &&
            _registry != address(0) &&
            _policy != address(0) &&
            _cat != address(0) &&
            _loss != address(0),
            "Zero address not allowed"
        );
        capitalPool = ICapitalPool(_capital);
        poolRegistry = IPoolRegistry(_registry);
        policyManager = _policy;
        policyNFT = IPolicyManager(_policy).policyNFT();
        catPool = ICatInsurancePool(_cat);
        lossDistributor = ILossDistributor(_loss);
        emit AddressesSet(_capital, _registry, _policy, _cat, _loss);
    }

    function setCommittee(address _committee) external onlyOwner {
        require(_committee != address(0), "Zero address not allowed");
        committee = _committee;
        emit CommitteeSet(_committee);
    }

    /**
     * @notice Wrapper for PoolRegistry.addProtocolRiskPool restricted to the owner.
     * @dev Enables governance to create new pools through the RiskManager.
     */
    function addProtocolRiskPool(
        address _protocolTokenToCover,
        IPoolRegistry.RateModel calldata _rateModel,
        IPoolRegistry.ProtocolRiskIdentifier _protocolCovered
    ) external onlyOwner returns (uint256) {
        return poolRegistry.addProtocolRiskPool(_protocolTokenToCover, _rateModel, _protocolCovered);
    }
    
    /* ──────────────── Underwriter Capital Allocation ──────────────── */
    
    function allocateCapital(uint256[] calldata _poolIds) external nonReentrant {
        uint256 totalPledge = underwriterTotalPledge[msg.sender];
        if (totalPledge == 0) revert NoCapitalToAllocate();
        require(_poolIds.length > 0 && _poolIds.length <= MAX_ALLOCATIONS_PER_UNDERWRITER, "Invalid number of allocations");

        address userAdapterAddress = capitalPool.getUnderwriterAdapterAddress(msg.sender);
        require(userAdapterAddress != address(0), "User has no yield adapter set in CapitalPool");
        
        uint256 poolCount = poolRegistry.getPoolCount();

        for(uint i = 0; i < _poolIds.length; i++){
            uint256 poolId = _poolIds[i];
            require(poolId < poolCount, "Invalid poolId");
            require(!isAllocatedToPool[msg.sender][poolId], "Already allocated to this pool");
            
            poolRegistry.updateCapitalAllocation(poolId, userAdapterAddress, totalPledge, true);

            isAllocatedToPool[msg.sender][poolId] = true;
            underwriterAllocations[msg.sender].push(poolId);
            poolSpecificUnderwriters[poolId].push(msg.sender);
            underwriterIndexInPoolArray[poolId][msg.sender] = poolSpecificUnderwriters[poolId].length - 1;
            
            emit CapitalAllocated(msg.sender, poolId, totalPledge);
        }
    }
    
    function deallocateFromPool(uint256 _poolId) external nonReentrant {
        address underwriter = msg.sender;
        _realizeLossesForAllPools(underwriter);
        
        uint256 totalPledge = underwriterTotalPledge[underwriter];
        if (totalPledge == 0) revert NoCapitalToAllocate();
        
        uint256 poolCount = poolRegistry.getPoolCount();
        require(_poolId < poolCount, "Invalid poolId");
        require(isAllocatedToPool[underwriter][_poolId], "Not allocated to this pool");
        
        address userAdapterAddress = capitalPool.getUnderwriterAdapterAddress(underwriter);
        require(userAdapterAddress != address(0), "User has no yield adapter set in CapitalPool");
        
        poolRegistry.updateCapitalAllocation(_poolId, userAdapterAddress, totalPledge, false);
        _removeUnderwriterFromPool(underwriter, _poolId);

        emit CapitalDeallocated(underwriter, _poolId, totalPledge);
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
            totalPendingLosses += lossDistributor.getPendingLosses(_underwriter, allocations[i], underwriterTotalPledge[_underwriter]);
        }

        if (totalPendingLosses < totalShareValue) revert UnderwriterNotInsolvent();

        _realizeLossesForAllPools(_underwriter);

        emit UnderwriterLiquidated(msg.sender, _underwriter);
    }

    /* ───────────────────── Claim Processing ───────────────────── */

    function processClaim(uint256 _policyId) external nonReentrant {
        IPolicyNFT.Policy memory policy = policyNFT.getPolicy(_policyId);
        uint256 poolId = policy.poolId;
        uint256 coverage = policy.coverage;
        (address[] memory adapters, uint256[] memory capitalPerAdapter, uint256 totalCapitalPledged) = poolRegistry.getPoolPayoutData(poolId);
        
        lossDistributor.distributeLoss(poolId, coverage, totalCapitalPledged);
        
        uint256 lossBorneByPool = Math.min(coverage, totalCapitalPledged);
        uint256 shortfall = coverage > lossBorneByPool ? coverage - lossBorneByPool : 0;
        if (shortfall > 0) {
            catPool.drawFund(shortfall);
        }
        
        uint256 claimFee = (coverage * CLAIM_FEE_BPS) / BPS;
        
        ICapitalPool.PayoutData memory payoutData;
        payoutData.claimant = policyNFT.ownerOf(_policyId);
        payoutData.claimantAmount = coverage - claimFee;
        payoutData.feeRecipient = committee;
        payoutData.feeAmount = claimFee;
        payoutData.adapters = adapters;
        payoutData.capitalPerAdapter = capitalPerAdapter;
        payoutData.totalCapitalFromPoolLPs = totalCapitalPledged;
        
        capitalPool.executePayout(payoutData);

        // Update coverage sold directly without going through the PolicyManager
        // hook to avoid the NotPolicyManager revert when processing claims.
        poolRegistry.updateCoverageSold(poolId, coverage, false);

        policyNFT.burn(_policyId);
    }
    
    /* ───────────────── Hooks & State Updaters ───────────────── */

    function updateCoverageSold(uint256 _poolId, uint256 _amount, bool _isSale) public {
        if(msg.sender != policyManager) revert NotPolicyManager();
        poolRegistry.updateCoverageSold(_poolId, _amount, _isSale);
    }

    function onCapitalDeposited(address _underwriter, uint256 _amount) external {
        if(msg.sender != address(capitalPool)) revert NotCapitalPool();
        underwriterTotalPledge[_underwriter] += _amount;
    }

    function onWithdrawalRequested(address _underwriter, uint256 _principalComponent) external {
        if(msg.sender != address(capitalPool)) revert NotCapitalPool();
        uint256[] memory allocations = underwriterAllocations[_underwriter];
        for (uint i = 0; i < allocations.length; i++) {
            poolRegistry.updateCapitalPendingWithdrawal(allocations[i], _principalComponent, true);
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
            poolRegistry.updateCapitalPendingWithdrawal(poolId, _principalComponentRemoved, false);
            if (_isFullWithdrawal) {
                _removeUnderwriterFromPool(_underwriter, poolId);
            }
        }
        if (_isFullWithdrawal) {
            delete underwriterAllocations[_underwriter];
        }
    }
    
    /* ───────────────── Internal Functions ───────────────── */

    function _realizeLossesForAllPools(address _user) internal {
        uint256[] memory allocations = underwriterAllocations[_user];
        uint256 originalPledge = underwriterTotalPledge[_user];
        for (uint i = 0; i < allocations.length; i++) {
            uint256 poolId = allocations[i];
            uint256 currentPledge = underwriterTotalPledge[_user];
            if (currentPledge == 0) break;
            uint256 pendingLoss = lossDistributor.realizeLosses(_user, poolId, originalPledge);
            if (pendingLoss > 0) {
                underwriterTotalPledge[_user] -= Math.min(currentPledge, pendingLoss);
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
    }
}