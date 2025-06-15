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
        ProtocolRiskIdentifier protocolCovered;
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

    modifier onlyRiskManager() {
        require(msg.sender == riskManager, "PR: Not RiskManager");
        _;
    }

    constructor(address _initialOwner, address _riskManager) Ownable(_initialOwner) {
        riskManager = _riskManager;
    }

    function setRiskManager(address _newRiskManager) external onlyOwner {
        require(_newRiskManager != address(0), "PR: Zero address");
        riskManager = _newRiskManager;
    }
    
    /* ───────────────────── State Modifying Functions (RM only) ───────────────────── */

    function addProtocolRiskPool(
        address _protocolTokenToCover,
        RateModel calldata _rateModel,
        ProtocolRiskIdentifier _protocolCovered
    ) external onlyRiskManager returns (uint256) {
        uint256 poolId = protocolRiskPools.length;
        protocolRiskPools.push();
        PoolData storage pool = protocolRiskPools[poolId];
        pool.protocolTokenToCover = IERC20(_protocolTokenToCover);
        pool.rateModel = _rateModel;
        pool.protocolCovered = _protocolCovered;
        return poolId;
    }

    function updateCapitalAllocation(uint256 _poolId, address _adapterAddress, uint256 _pledgeAmount, bool _isAllocation) external onlyRiskManager {
        PoolData storage pool = protocolRiskPools[_poolId];
        if (_isAllocation) {
            pool.totalCapitalPledgedToPool += _pledgeAmount;
            pool.capitalPerAdapter[_adapterAddress] += _pledgeAmount;
            if (!pool.isAdapterInPool[_adapterAddress]) {
                pool.isAdapterInPool[_adapterAddress] = true;
                pool.activeAdapters.push(_adapterAddress);
                pool.adapterIndex[_adapterAddress] = pool.activeAdapters.length - 1;
            }
        } else {
            pool.totalCapitalPledgedToPool -= _pledgeAmount;
            pool.capitalPerAdapter[_adapterAddress] -= _pledgeAmount;
            if (pool.capitalPerAdapter[_adapterAddress] == 0) {
                _removeAdapterFromPool(pool, _adapterAddress);
            }
        }
    }

    function updateCapitalPendingWithdrawal(uint256 _poolId, uint256 _amount, bool _isRequest) external onlyRiskManager {
        PoolData storage pool = protocolRiskPools[_poolId];
        if (_isRequest) {
            pool.capitalPendingWithdrawal += _amount;
        } else {
            pool.capitalPendingWithdrawal -= _amount;
        }
    }

    function updateCoverageSold(uint256 _poolId, uint256 _amount, bool _isSale) external onlyRiskManager {
        PoolData storage pool = protocolRiskPools[_poolId];
        if (_isSale) {
            pool.totalCoverageSold += _amount;
        } else {
            pool.totalCoverageSold -= _amount;
        }
    }

    function updatePoolPauseState(uint256 _poolId, bool _isPaused) external onlyRiskManager {
        PoolData storage pool = protocolRiskPools[_poolId];
        pool.isPaused = _isPaused;
        pool.pauseTimestamp = _isPaused ? block.timestamp : 0;
    }
    
    function setFeeRecipient(uint256 _poolId, address _recipient) external onlyRiskManager {
        protocolRiskPools[_poolId].feeRecipient = _recipient;
    }

    /* ───────────────────── View Functions ───────────────────── */

    function getPoolCount() external view returns (uint256) {
        return protocolRiskPools.length;
    }

    function getPoolData(uint256 _poolId) external view override returns (
        IERC20 protocolTokenToCover,
        uint256 totalCapitalPledgedToPool,
        uint256 totalCoverageSold,
        uint256 capitalPendingWithdrawal,
        bool isPaused,
        address feeRecipient
    ) {
        PoolData storage pool = protocolRiskPools[_poolId];
        return (
            pool.protocolTokenToCover,
            pool.totalCapitalPledgedToPool,
            pool.totalCoverageSold,
            pool.capitalPendingWithdrawal,
            pool.isPaused,
            pool.feeRecipient
        );
    }
    
    function getPoolRateModel(uint256 _poolId) external view override returns (RateModel memory) {
        return protocolRiskPools[_poolId].rateModel;
    }
    
    function getPoolActiveAdapters(uint256 _poolId) external view override returns (address[] memory) {
        return protocolRiskPools[_poolId].activeAdapters;
    }

    function getCapitalPerAdapter(uint256 _poolId, address _adapter) external view override returns (uint256) {
        return protocolRiskPools[_poolId].capitalPerAdapter[_adapter];
    }
    
    /**
     * @notice CORRECTED: This function is now implemented to serve the on-chain needs of the RiskManager.
     */
    function getPoolPayoutData(uint256 _poolId) external view override returns (address[] memory, uint256[] memory, uint256) {
        PoolData storage pool = protocolRiskPools[_poolId];
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