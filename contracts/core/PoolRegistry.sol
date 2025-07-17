// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IPoolRegistry.sol";

/**
 * @title PoolRegistry
 * @author Gemini
 * @notice This contract is the single source of truth for creating and managing risk pools.
 */
contract PoolRegistry is IPoolRegistry, Ownable {

    struct PoolData {
        // Group smaller types together for gas savings
        IERC20 protocolTokenToCover;
        address feeRecipient;
        bool isPaused;
        // --- uint256 variables ---
        uint256 totalCapitalPledgedToPool;
        uint256 capitalPendingWithdrawal;
        uint256 totalCoverageSold;
        uint256 claimFeeBps;
        uint256 pauseTimestamp;
        // Complex types at the end
        RateModel rateModel;
        mapping(address => uint256) capitalPerAdapter;
        address[] activeAdapters;
        mapping(address => uint256) adapterIndex;
        mapping(address => bool) isAdapterInPool;
    }


    PoolData[] public protocolRiskPools;
    address public riskManager;
    address public underwriterManager;

    // NEW: Mapping to differentiate pool types for the RewardDistributor
    mapping(uint256 => bool) public isYieldRewardPool;


    event RiskManagerAddressSet(address indexed newRiskManager);
    event UnderwriterManagerAddressSet(address indexed newUnderwriterManager);
    event PoolTypeSet(uint256 indexed poolId, bool isYieldPool); // NEW Event


    modifier onlyRiskManager() {
        require(msg.sender == riskManager, "PR: Not RiskManager");
        _;
    }

    modifier onlyUnderwriterManager() {
        require(msg.sender == underwriterManager, "PR: Not UnderwriterManager");
        _;
    }

    modifier onlyUMOrRM() {
        require(msg.sender == underwriterManager || msg.sender == riskManager , "PR: Not RiskManager or UnderwriterManager");
        _;
    }


    constructor(address initialOwner, address riskManagerAddress, address underwriterManagerAddress) Ownable(initialOwner) {
        require(riskManagerAddress != address(0), "PR: Zero address for RM");
        require(underwriterManagerAddress != address(0), "PR: Zero address for UM");
        riskManager = riskManagerAddress;
        underwriterManager = underwriterManagerAddress;
    }

    function setRiskManager(address newRiskManager) external onlyOwner {
        require(newRiskManager != address(0), "PR: Zero address");
        riskManager = newRiskManager;
        emit RiskManagerAddressSet(newRiskManager);
    }

    function setUnderwriterManager(address newUnderwriterManager) external onlyOwner {
        require(newUnderwriterManager != address(0), "PR: Zero address");
        underwriterManager = newUnderwriterManager;
        emit UnderwriterManagerAddressSet(newUnderwriterManager);
    }


    function setPauseState(uint256 poolId, bool isPaused) external onlyOwner {
        require(poolId < protocolRiskPools.length, "PR: Invalid poolId");
        PoolData storage pool = protocolRiskPools[poolId];
        pool.isPaused = isPaused;
        pool.pauseTimestamp = isPaused ? block.timestamp : 0;
    }
    
    function setFeeRecipient(uint256 poolId, address recipient) external onlyOwner {
        require(poolId < protocolRiskPools.length, "PR: Invalid poolId");
        protocolRiskPools[poolId].feeRecipient = recipient;
    }

    /**
     * @notice NEW: Sets whether a pool ID is for yield rewards.
     * @dev This allows the RewardDistributor to distinguish between reward types.
     */
    function setIsYieldRewardPool(uint256 poolId, bool isYieldPool) external onlyOwner {
        require(poolId < protocolRiskPools.length, "PR: Invalid poolId");
        isYieldRewardPool[poolId] = isYieldPool;
        emit PoolTypeSet(poolId, isYieldPool);
    }

    /* ───────────────────── State Modifying Functions (RM only) ───────────────────── */

    function addProtocolRiskPool(
        address protocolTokenToCover,
        RateModel calldata rateModel,
        uint256 claimFeeBps
    ) external onlyOwner returns (uint256) {
        uint256 poolId = protocolRiskPools.length;
        protocolRiskPools.push();
        PoolData storage pool = protocolRiskPools[poolId];
        pool.protocolTokenToCover = IERC20(protocolTokenToCover);
        pool.rateModel = rateModel;
        pool.claimFeeBps = claimFeeBps;
        return poolId;
    }

    function updateCapitalAllocation(uint256 poolId, address adapterAddress, uint256 pledgeAmount, bool isAllocation) external onlyUMOrRM {
        PoolData storage pool = protocolRiskPools[poolId];
        if (isAllocation) {
            pool.totalCapitalPledgedToPool += pledgeAmount;
            pool.capitalPerAdapter[adapterAddress] += pledgeAmount;
            if (!pool.isAdapterInPool[adapterAddress]) {
                pool.isAdapterInPool[adapterAddress] = true;
                pool.activeAdapters.push(adapterAddress);
                pool.adapterIndex[adapterAddress] = pool.activeAdapters.length - 1;
            }
        } else {
            pool.totalCapitalPledgedToPool -= pledgeAmount;
            pool.capitalPerAdapter[adapterAddress] -= pledgeAmount;
            if (pool.capitalPerAdapter[adapterAddress] == 0) {
                _removeAdapterFromPool(pool, adapterAddress);
            }
        }
    }

    function updateCapitalPendingWithdrawal(uint256 poolId, uint256 amount, bool isRequest) external onlyUnderwriterManager {
        PoolData storage pool = protocolRiskPools[poolId];
        if (isRequest) {
            pool.capitalPendingWithdrawal += amount;
        } else {
            pool.capitalPendingWithdrawal -= amount;
        }
    }

    function updateCoverageSold(uint256 poolId, uint256 amount, bool isSale) external onlyRiskManager {
        PoolData storage pool = protocolRiskPools[poolId];
        if (isSale) {
            pool.totalCoverageSold += amount;
        } else {
            pool.totalCoverageSold -= amount;
        }
    }
    /* ───────────────────── View Functions ───────────────────── */

    function getPoolCount() external view returns (uint256) {
        return protocolRiskPools.length;
    }

    function getPoolData(uint256 poolId) external view override returns (
        IERC20 protocolTokenToCover,
        uint256 totalCapitalPledgedToPool,
        uint256 totalCoverageSold,
        uint256 capitalPendingWithdrawal,
        bool isPaused,
        address feeRecipient,
        uint256 claimFeeBps
    ) {
        PoolData storage pool = protocolRiskPools[poolId];
        return (
            pool.protocolTokenToCover,
            pool.totalCapitalPledgedToPool,
            pool.totalCoverageSold,
            pool.capitalPendingWithdrawal,
            pool.isPaused,
            pool.feeRecipient,
            pool.claimFeeBps
        );
    }


    function getMultiplePoolData(uint256[] calldata poolIds) external view returns (IPoolRegistry.PoolInfo[] memory) {
        uint256 numPools = poolIds.length;
        IPoolRegistry.PoolInfo[] memory multiplePoolData = new IPoolRegistry.PoolInfo[](numPools);

        for (uint256 i = 0; i < numPools; i++) {
            uint256 poolId = poolIds[i];
            PoolData storage pool = protocolRiskPools[poolId];

            multiplePoolData[i] = IPoolRegistry.PoolInfo({
                protocolTokenToCover: pool.protocolTokenToCover,
                totalCapitalPledgedToPool: pool.totalCapitalPledgedToPool,
                totalCoverageSold: pool.totalCoverageSold,
                capitalPendingWithdrawal: pool.capitalPendingWithdrawal,
                isPaused: pool.isPaused,
                feeRecipient: pool.feeRecipient,
                claimFeeBps: pool.claimFeeBps
            });
        }

        return multiplePoolData;
    }
    
    function getPoolRateModel(uint256 poolId) external view override returns (RateModel memory) {
        return protocolRiskPools[poolId].rateModel;
    }
    
    function getPoolActiveAdapters(uint256 poolId) external view override returns (address[] memory) {
        return protocolRiskPools[poolId].activeAdapters;
    }

    function getCapitalPerAdapter(uint256 poolId, address adapter) external view override returns (uint256) {
        return protocolRiskPools[poolId].capitalPerAdapter[adapter];
    }
    
    function getPoolPayoutData(uint256 poolId) external view override returns (address[] memory, uint256[] memory, uint256) {
        PoolData storage pool = protocolRiskPools[poolId];
        address[] memory adapters = pool.activeAdapters;
        uint256[] memory capitalPerAdapter = new uint256[](adapters.length);
        for(uint i = 0; i < adapters.length; i++){
            capitalPerAdapter[i] = pool.capitalPerAdapter[adapters[i]];
        }
        return (adapters, capitalPerAdapter, pool.totalCapitalPledgedToPool);
    }


    function getPoolTokens(uint256[] calldata poolIds)
        external
        view
        returns (address[] memory tokens)
    {
        uint256 len = poolIds.length;
        tokens = new address[](len);

        for (uint256 i = 0; i < len; i++) {
            uint256 pid = poolIds[i];
            require(pid < protocolRiskPools.length, "PR: Invalid poolId");
            tokens[i] = address(protocolRiskPools[pid].protocolTokenToCover);
        }

        return tokens;
    }
    
    /* ───────────────── Internal & Helper Functions ──────────────── */
    function _removeAdapterFromPool(PoolData storage pool, address adapterAddress) internal {
        if (!pool.isAdapterInPool[adapterAddress]) return;
        uint256 indexToRemove = pool.adapterIndex[adapterAddress];
        address lastAdapter = pool.activeAdapters[pool.activeAdapters.length - 1];
        pool.activeAdapters[indexToRemove] = lastAdapter;
        pool.adapterIndex[lastAdapter] = indexToRemove;
        pool.activeAdapters.pop();
        delete pool.isAdapterInPool[adapterAddress];
        delete pool.adapterIndex[adapterAddress];
    }
}