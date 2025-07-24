// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IPoolRegistry.sol";

/**
 * @title PoolRegistry
 * @author Gemini
 * @notice This contract stores static configuration data for risk pools, including risk ratings.
 * @dev CORRECTED: This contract has been updated to include a RiskRating enum and functionality
 * to set and retrieve the risk level for each pool.
 */
contract PoolRegistry is IPoolRegistry, Ownable {

    // --- Enums ---

    /**
     * @notice Defines the risk tiers for covered assets.
     * @dev This rating can be used by other contracts to determine leverage, pricing, etc.
     */

    // --- Structs ---

    struct PoolData {
        // --- Static Configuration ---
        IERC20 protocolTokenToCover;
        RateModel rateModel;
        address feeRecipient;
        uint256 claimFeeBps;
        RiskRating riskRating; // NEW: Risk rating for the pool

        // --- Dynamic State (Managed by this contract) ---
        uint256 totalCoverageSold;
        bool isPaused;
        uint256 pauseTimestamp;
    }

    // --- State Variables ---

    PoolData[] public protocolRiskPools;
    address public riskManager;
    address public policyManager;

    mapping(uint256 => bool) public isYieldRewardPool;

    // --- Events ---

    event RiskManagerAddressSet(address indexed newRiskManager);
    event PolicyManagerAddressSet(address indexed newPolicyManager);
    event PoolTypeSet(uint256 indexed poolId, bool isYieldPool);
    event PoolCreated(uint256 indexed poolId, address indexed protocolTokenToCover, RateModel rateModel, uint256 claimFeeBps, RiskRating riskRating); // UPDATED
    event PoolRiskRatingUpdated(uint256 indexed poolId, RiskRating newRiskRating); // NEW
    event CoverageSoldUpdated(uint256 indexed poolId, uint256 newTotalCoverageSold);
    event PauseStateSet(uint256 indexed poolId, bool isPaused);
    event FeeRecipientSet(uint256 indexed poolId, address indexed recipient);


    // --- Modifiers ---

    modifier onlyRiskManager() {
        require(msg.sender == riskManager, "PR: Not RiskManager");
        _;
    }

    modifier onlyPolicyManager() {
        require(msg.sender == policyManager, "PR: Not PolicyManager");
        _;
    }

    modifier onlyApproved() {
        require(msg.sender == policyManager || msg.sender == riskManager , "PR: Not Approved");
        _;
    }
    // --- Constructor ---
    // --- Constructor ---

    constructor(address initialOwner, address riskManagerAddress, address policyManagerAddress) Ownable(initialOwner) {
        require(riskManagerAddress != address(0), "PR: Zero address for RM");
        require(policyManagerAddress != address(0), "PR: Zero address for PM");
        riskManager = riskManagerAddress;
        policyManager = policyManagerAddress;
    }

    // --- Admin Functions ---

    function setRiskManager(address newRiskManager) external onlyOwner {
        require(newRiskManager != address(0), "PR: Zero address");
        riskManager = newRiskManager;
        emit RiskManagerAddressSet(newRiskManager);
    }

    function setPolicyManager(address newPolicyManager) external onlyOwner {
        require(newPolicyManager != address(0), "PR: Zero address");
        policyManager = newPolicyManager;
        emit PolicyManagerAddressSet(newPolicyManager);
    }

    function setPauseState(uint256 poolId, bool isPaused) external onlyOwner {
        require(poolId < protocolRiskPools.length, "PR: Invalid poolId");
        PoolData storage pool = protocolRiskPools[poolId];
        pool.isPaused = isPaused;
        pool.pauseTimestamp = isPaused ? block.timestamp : 0;
        emit PauseStateSet(poolId, isPaused);
    }
    
    function setFeeRecipient(uint256 poolId, address recipient) external onlyOwner {
        require(poolId < protocolRiskPools.length, "PR: Invalid poolId");
        require(recipient != address(0), "PR: Zero address for recipient");
        protocolRiskPools[poolId].feeRecipient = recipient;
        emit FeeRecipientSet(poolId, recipient);
    }

    function setIsYieldRewardPool(uint256 poolId, bool isYieldPool) external onlyOwner {
        require(poolId < protocolRiskPools.length, "PR: Invalid poolId");
        isYieldRewardPool[poolId] = isYieldPool;
        emit PoolTypeSet(poolId, isYieldPool);
    }

    /**
     * @notice Sets the risk rating for an existing pool.
     * @dev Allows the protocol owner to adjust risk profiles as projects evolve.
     * @param poolId The ID of the pool to update.
     * @param newRating The new risk rating for the pool.
     */
    function setPoolRiskRating(uint256 poolId, RiskRating newRating) external onlyOwner {
        require(poolId < protocolRiskPools.length, "PR: Invalid poolId");
        protocolRiskPools[poolId].riskRating = newRating;
        emit PoolRiskRatingUpdated(poolId, newRating);
    }

    // --- State Modifying Functions ---

    /**
     * @notice Creates a new risk pool with its static parameters, including its risk rating.
     */
    function addProtocolRiskPool(
        address protocolTokenToCover,
        RateModel calldata rateModel,
        uint256 claimFeeBps,
        RiskRating riskRating // NEW
    ) external onlyOwner returns (uint256) {
        uint256 poolId = protocolRiskPools.length;
        
        protocolRiskPools.push(PoolData({
            protocolTokenToCover: IERC20(protocolTokenToCover),
            rateModel: rateModel,
            claimFeeBps: claimFeeBps,
            riskRating: riskRating, // NEW
            feeRecipient: address(0),
            totalCoverageSold: 0,
            isPaused: false,
            pauseTimestamp: 0
        }));

        emit PoolCreated(poolId, protocolTokenToCover, rateModel, claimFeeBps, riskRating); // UPDATED
        return poolId;
    }

    /**
     * @notice Updates the total amount of coverage sold for a given pool.
     */
    function updateCoverageSold(uint256 poolId, uint256 amount, bool isSale) external onlyApproved {
        require(poolId < protocolRiskPools.length, "PR: Invalid poolId");
        PoolData storage pool = protocolRiskPools[poolId];
        if (isSale) {
            pool.totalCoverageSold += amount;
        } else {
            pool.totalCoverageSold = (pool.totalCoverageSold > amount) ? pool.totalCoverageSold - amount : 0;
        }
        emit CoverageSoldUpdated(poolId, pool.totalCoverageSold);
    }

    // --- View Functions ---

    function getPoolCount() external view returns (uint256) {
        return protocolRiskPools.length;
    }

    /**
     * @notice Returns the static configuration and essential state of a pool, including its risk rating.
     */
    function getPoolStaticData(uint256 poolId) external view  returns (
        IERC20 protocolTokenToCover,
        uint256 totalCoverageSold,
        bool isPaused,
        address feeRecipient,
        uint256 claimFeeBps,
        RiskRating riskRating 
    ) {
        require(poolId < protocolRiskPools.length, "PR: Invalid poolId");
        PoolData storage pool = protocolRiskPools[poolId];
        return (
            pool.protocolTokenToCover,
            pool.totalCoverageSold,
            pool.isPaused,
            pool.feeRecipient,
            pool.claimFeeBps,
            pool.riskRating 
        );
    }
    
    function getPoolRateModel(uint256 poolId) external view returns (RateModel memory) {
        require(poolId < protocolRiskPools.length, "PR: Invalid poolId");
        return protocolRiskPools[poolId].rateModel;
    }
    
    function getPoolTokens(uint256[] calldata poolIds) external view returns (address[] memory tokens) {
        uint256 len = poolIds.length;
        tokens = new address[](len);

        for (uint256 i = 0; i < len; i++) {
            uint256 pid = poolIds[i];
            require(pid < protocolRiskPools.length, "PR: Invalid poolId");
            tokens[i] = address(protocolRiskPools[pid].protocolTokenToCover);
        }

        return tokens;
    }

    function getPoolRiskRating(uint256 poolId) external view returns (RiskRating) {
        require(poolId < protocolRiskPools.length, "PR: Invalid poolId");
        return protocolRiskPools[poolId].riskRating;
    }
}
