// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IPoolRegistry.sol";

/**
 * @title PoolRegistry
 * @author Gemini
 * @notice This contract is the single source of truth for creating and managing risk pools.
 * It is owned and controlled by the RiskManager contract.
 */
contract PoolRegistry is IPoolRegistry, Ownable {

    struct PoolData {
        IERC20 protocolTokenToCover;
        RateModel rateModel;
        uint256 totalCapitalPledgedToPool;
        uint256 capitalPendingWithdrawal;
        uint256 totalCoverageSold;
        uint256 claimFeeBps;
        bool isPaused;
        uint256 pauseTimestamp;
        address feeRecipient;
        mapping(address => uint256) capitalPerAdapter;
        address[] activeAdapters;
        mapping(address => uint256) adapterIndex;
        mapping(address => bool) isAdapterInPool;
    }

    PoolData[] public protocolRiskPools;
    address public riskManager;

    event RiskManagerAddressSet(address indexed newRiskManager);

    modifier onlyRiskManager() {
        require(msg.sender == riskManager, "PR: Not RiskManager");
        _;
    }

    constructor(address _initialOwner, address _riskManager) Ownable(_initialOwner) {
        require(_riskManager != address(0), "PR: Zero address");
        riskManager = _riskManager;
    }

    function setRiskManager(address newRiskManager) external onlyOwner {
        require(newRiskManager != address(0), "PR: Zero address");
        riskManager = newRiskManager;
        emit RiskManagerAddressSet(newRiskManager);
    }
    
    /* ───────────────────── State Modifying Functions (RM only) ───────────────────── */

    function addProtocolRiskPool(
        address protocolTokenToCover,
        RateModel calldata rateModel,
        uint256 claimFeeBps
    ) external onlyRiskManager returns (uint256) {
        uint256 poolId = protocolRiskPools.length;
        protocolRiskPools.push();
        PoolData storage pool = protocolRiskPools[poolId];
        pool.protocolTokenToCover = IERC20(protocolTokenToCover);
        pool.rateModel = rateModel;
        pool.claimFeeBps = claimFeeBps;
        return poolId;
    }

    function updateCapitalAllocation(uint256 poolId, address adapterAddress, uint256 pledgeAmount, bool isAllocation) external onlyRiskManager {
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

    function updateCapitalPendingWithdrawal(uint256 poolId, uint256 amount, bool isRequest) external onlyRiskManager {
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

    function setPauseState(uint256 poolId, bool isPaused) external onlyRiskManager {
        PoolData storage pool = protocolRiskPools[poolId];
        pool.isPaused = isPaused;
        pool.pauseTimestamp = isPaused ? block.timestamp : 0;
    }
    
    function setFeeRecipient(uint256 poolId, address recipient) external onlyRiskManager {
        protocolRiskPools[poolId].feeRecipient = recipient;
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
    
    function getPoolRateModel(uint256 poolId) external view override returns (RateModel memory) {
        return protocolRiskPools[poolId].rateModel;
    }
    
    function getPoolActiveAdapters(uint256 poolId) external view override returns (address[] memory) {
        return protocolRiskPools[poolId].activeAdapters;
    }

    function getCapitalPerAdapter(uint256 poolId, address adapter) external view override returns (uint256) {
        return protocolRiskPools[poolId].capitalPerAdapter[adapter];
    }
    
    /**
     * @notice CORRECTED: This function is now implemented to serve the on-chain needs of the RiskManager.
     */
    function getPoolPayoutData(uint256 poolId) external view override returns (address[] memory, uint256[] memory, uint256) {
        PoolData storage pool = protocolRiskPools[poolId];
        address[] memory adapters = pool.activeAdapters;
        uint256[] memory capitalPerAdapter = new uint256[](adapters.length);
        for(uint i = 0; i < adapters.length; i++){
            capitalPerAdapter[i] = pool.capitalPerAdapter[adapters[i]];
        }
        return (adapters, capitalPerAdapter, pool.totalCapitalPledgedToPool);
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