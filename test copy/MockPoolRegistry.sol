// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IPoolRegistry.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockPoolRegistry is IPoolRegistry, Ownable {
    struct PoolData {
        IERC20 protocolTokenToCover;
        uint256 totalCapitalPledgedToPool;
        uint256 totalCoverageSold;
        uint256 capitalPendingWithdrawal;
        bool isPaused;
        address feeRecipient;
        uint256 claimFeeBps;
    }

    mapping(uint256 => PoolData) public pools;
    mapping(uint256 => mapping(address => uint256)) public capitalPerAdapter;
    mapping(uint256 => RateModel) public rateModels;
    uint256 public poolCount;
    address[] public payoutAdapters;
    uint256[] public payoutAmounts;
    uint256 public payoutTotal;

    // --- Variables for test assertions ---
    uint256 public updateCapitalAllocationCallCount;
    uint256 public updateCapitalPendingWithdrawalCallCount;

    uint256 public last_updateCapitalAllocation_poolId;
    address public last_updateCapitalAllocation_adapter;
    uint256 public last_updateCapitalAllocation_amount;
    bool public last_updateCapitalAllocation_isAllocation;

    uint256 public last_updateCapitalPendingWithdrawal_poolId;
    uint256 public last_updateCapitalPendingWithdrawal_amount;
    bool public last_updateCapitalPendingWithdrawal_isRequest;

    constructor() Ownable(msg.sender) {}

    function setPoolData(
        uint256 poolId,
        IERC20 token,
        uint256 totalCapital,
        uint256 totalSold,
        uint256 pendingWithdrawal,
        bool paused,
        address feeRecipient,
        uint256 claimFeeBps
    ) external onlyOwner {
        pools[poolId] = PoolData({
            protocolTokenToCover: token,
            totalCapitalPledgedToPool: totalCapital,
            totalCoverageSold: totalSold,
            capitalPendingWithdrawal: pendingWithdrawal,
            isPaused: paused,
            feeRecipient: feeRecipient,
            claimFeeBps: claimFeeBps
        });
    }

    function setRateModel(uint256 poolId, RateModel calldata model) external onlyOwner {
        rateModels[poolId] = model;
    }

    function setPoolCount(uint256 count) external {
        poolCount = count;
    }

    function setPayoutData(address[] calldata adapters, uint256[] calldata amounts, uint256 total) public {
        payoutAdapters = adapters;
        payoutAmounts = amounts;
        payoutTotal = total;
        for (uint256 i = 0; i < adapters.length; i++) {
            capitalPerAdapter[0][adapters[i]] = amounts[i];
        }
    }

    function setPoolPayoutData(uint256, address[] calldata adapters, uint256[] calldata amounts, uint256 total)
        external
    {
        setPayoutData(adapters, amounts, total);
    }

    function getPoolData(uint256 poolId)
        external
        view
        override
        returns (
            IERC20 protocolTokenToCover,
            uint256 totalCapitalPledgedToPool,
            uint256 totalCoverageSold,
            uint256 capitalPendingWithdrawal,
            bool isPaused,
            address feeRecipient,
            uint256 claimFeeBps
        )
    {
        PoolData storage d = pools[poolId];
        protocolTokenToCover = d.protocolTokenToCover;
        totalCapitalPledgedToPool = d.totalCapitalPledgedToPool;
        totalCoverageSold = d.totalCoverageSold;
        capitalPendingWithdrawal = d.capitalPendingWithdrawal;
        isPaused = d.isPaused;
        feeRecipient = d.feeRecipient;
        claimFeeBps = d.claimFeeBps;
    }

    function getPoolRateModel(uint256 poolId) external view override returns (RateModel memory) {
        return rateModels[poolId];
    }

    function getPoolPayoutData(uint256) external view override returns (address[] memory, uint256[] memory, uint256) {
        return (payoutAdapters, payoutAmounts, payoutTotal);
    }

    function getPoolActiveAdapters(uint256) external view override returns (address[] memory) {
        address[] memory a;
        return a;
    }

    function getCapitalPerAdapter(uint256 poolId, address adapter) external view override returns (uint256) {
        return capitalPerAdapter[poolId][adapter];
    }

    function addProtocolRiskPool(address, RateModel calldata, uint256) external override returns (uint256) {
        return 0;
    }

    function updateCapitalAllocation(uint256 poolId, address adapter, uint256 amount, bool isAllocation)
        external
        override
    {
        PoolData storage pool = pools[poolId];
        if (isAllocation) {
            pool.totalCapitalPledgedToPool += amount;
            capitalPerAdapter[poolId][adapter] += amount;
        } else {
            pool.totalCapitalPledgedToPool -= amount;
            capitalPerAdapter[poolId][adapter] -= amount;
        }

        updateCapitalAllocationCallCount++;
        last_updateCapitalAllocation_poolId = poolId;
        last_updateCapitalAllocation_adapter = adapter;
        last_updateCapitalAllocation_amount = amount;
        last_updateCapitalAllocation_isAllocation = isAllocation;
    }

    function updateCapitalPendingWithdrawal(uint256 poolId, uint256 amount, bool isRequest) external override {
        if (isRequest) {
            pools[poolId].capitalPendingWithdrawal += amount;
        } else {
            pools[poolId].capitalPendingWithdrawal -= amount;
        }

        updateCapitalPendingWithdrawalCallCount++;
        last_updateCapitalPendingWithdrawal_poolId = poolId;
        last_updateCapitalPendingWithdrawal_amount = amount;
        last_updateCapitalPendingWithdrawal_isRequest = isRequest;
    }

    function updateCoverageSold(uint256 poolId, uint256 amount, bool isSale) external override {
        if (isSale) {
            pools[poolId].totalCoverageSold += amount;
        } else {
            pools[poolId].totalCoverageSold -= amount;
        }
    }

    function getPoolCount() external view override returns (uint256) {
        return poolCount;
    }

    function setPauseState(uint256 poolId, bool paused) external override {
        pools[poolId].isPaused = paused;
    }

    function setFeeRecipient(uint256 poolId, address recipient) external override {
        pools[poolId].feeRecipient = recipient;
    }

    function getMultiplePoolData(uint256[] calldata poolIds)
        external
        view
        override
        returns (IPoolRegistry.PoolInfo[] memory infos)
    {
        uint256 len = poolIds.length;
        infos = new IPoolRegistry.PoolInfo[](len);
        for (uint256 i = 0; i < len; i++) {
            PoolData storage d = pools[poolIds[i]];
            infos[i] = IPoolRegistry.PoolInfo({
                protocolTokenToCover: d.protocolTokenToCover,
                totalCapitalPledgedToPool: d.totalCapitalPledgedToPool,
                totalCoverageSold: d.totalCoverageSold,
                capitalPendingWithdrawal: d.capitalPendingWithdrawal,
                isPaused: d.isPaused,
                feeRecipient: d.feeRecipient,
                claimFeeBps: d.claimFeeBps
            });
        }
    }

    // Helper view functions for tests
    function get_last_updateCapitalAllocation()
        external
        view
        returns (uint256 poolId, address adapter, uint256 amount, bool isAllocation)
    {
        return (
            last_updateCapitalAllocation_poolId,
            last_updateCapitalAllocation_adapter,
            last_updateCapitalAllocation_amount,
            last_updateCapitalAllocation_isAllocation
        );
    }

    function get_last_updateCapitalPendingWithdrawal()
        external
        view
        returns (uint256 poolId, uint256 amount, bool isRequest)
    {
        return (
            last_updateCapitalPendingWithdrawal_poolId,
            last_updateCapitalPendingWithdrawal_amount,
            last_updateCapitalPendingWithdrawal_isRequest
        );
    }
}
