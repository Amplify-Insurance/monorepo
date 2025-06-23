// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract PolicyNFT is ERC721URIStorage, Ownable {
    // --- MODIFIED: Policy struct with fields for pending increases ---
    struct Policy {
        uint256 coverage;                   // Currently active liability
        uint256 poolId;
        uint256 start;
        uint256 activation;                 // Activation for the initial coverage
        uint128 premiumDeposit;
        uint128 lastDrainTime;
        // --- ADDED: Fields for managing coverage increases ---
        uint256 pendingIncrease;            // The amount of coverage being added
        uint256 increaseActivationTimestamp; // Timestamp when the pendingIncrease becomes active
    }

    uint256 public nextId = 1;
    mapping(uint256 => Policy) public policies;
    address public policyManagerContract; // Renamed for clarity

    // Events
    event PolicyPremiumAccountUpdated(uint256 indexed policyId, uint128 newDeposit, uint128 newDrainTime);
    event PolicyCoverageIncreased(uint256 indexed policyId, uint256 newTotalCoverage);
    event PendingIncreaseAdded(uint256 indexed policyId, uint256 pendingAmount, uint256 activationTimestamp);
    event PolicyManagerAddressSet(address indexed newPolicyManagerAddress);
    event PolicyCoverageUpdated(uint256 indexed policyId, uint256 newCoverage); // --- ADDED: Event for coverage updates


    modifier onlyPolicyManager() {
        require(policyManagerContract != address(0), "PolicyNFT: PolicyManager address not set");
        require(msg.sender == policyManagerContract, "PolicyNFT: Caller is not the authorized PolicyManager");
        _;
    }



    constructor(address _policyManagerAddress, address initialOwner) ERC721("Policy", "PCOVER") Ownable(initialOwner) {
        policyManagerContract = _policyManagerAddress;
    }

    function setPolicyManagerAddress(address _newPolicyManagerAddress) external onlyOwner {
        require(_newPolicyManagerAddress != address(0), "PolicyNFT: Address cannot be zero");
        policyManagerContract = _newPolicyManagerAddress;
        emit PolicyManagerAddressSet(_newPolicyManagerAddress);
    }

    /**
     * @notice Mints a new policy NFT. Only callable by the authorized PolicyManager contract.
     */
    function mint(
        address to,
        uint256 pid,
        uint256 coverage,
        uint256 activation,
        uint128 premiumDeposit,
        uint128 lastDrainTime
    ) external onlyPolicyManager returns (uint256 id) {
        id = nextId++;
        _safeMint(to, id);
        
        // --- FIX: Initialize all 8 fields of the struct ---
        policies[id] = Policy({
            coverage: coverage,
            poolId: pid,
            start: block.timestamp,
            activation: activation,
            premiumDeposit: premiumDeposit,
            lastDrainTime: lastDrainTime,
            pendingIncrease: 0,
            increaseActivationTimestamp: 0
        });
        return id;
    }

    /**
     * @notice Burns a policy NFT. Only callable by the authorized RiskManager contract.
     */
    function burn(uint256 id) external onlyPolicyManager {
        _burn(id);
        delete policies[id];
    }

    /**
     * @notice Updates the premium details for a policy.
     * @param id The ID of the policy NFT.
     * @param newDeposit The new remaining premium deposit amount.
     * @param newDrainTime The new drain timestamp (usually block.timestamp).
     */
    function updatePremiumAccount(uint256 id, uint128 newDeposit, uint128 newDrainTime) external onlyPolicyManager {
        // --- FIX: Check for policy existence by verifying a non-zero value in the struct ---
        // The 'start' timestamp is always non-zero for a minted policy.
        require(policies[id].start != 0, "PolicyNFT: Policy does not exist or has been burned");
        
        Policy storage policy = policies[id];
        policy.premiumDeposit = newDeposit;
        policy.lastDrainTime = newDrainTime;
        emit PolicyPremiumAccountUpdated(id, newDeposit, newDrainTime);
    }
    
    /**
     * @notice ADDED: Updates the coverage amount for a policy.
     * @dev Intended for increasing coverage. Only callable by the authorized RiskManager contract.
     * @param id The ID of the policy NFT.
     * @param newCoverage The new, higher total coverage amount.
     */
    function updateCoverage(uint256 id, uint256 newCoverage) external onlyPolicyManager {
        require(policies[id].start != 0, "PolicyNFT: Policy does not exist or has been burned");

        Policy storage policy = policies[id];
        
        // Safety check to ensure coverage is only increased via this function.
        require(newCoverage > policy.coverage, "PolicyNFT: New coverage must be greater than current");

        policy.coverage = newCoverage;
        emit PolicyCoverageUpdated(id, newCoverage);
    }


        /**
     * @notice Adds a pending coverage increase to a policy.
     * @dev Only callable by the PolicyManager. This is called when a user wishes to increase cover.
     * @param id The ID of the policy NFT.
     * @param amount The additional coverage amount.
     * @param activationTimestamp The time when this amount becomes active.
     */
    function addPendingIncrease(uint256 id, uint256 amount, uint256 activationTimestamp) external onlyPolicyManager {
        require(policies[id].start != 0, "PolicyNFT: Policy does not exist");
        require(policies[id].pendingIncrease == 0, "PolicyNFT: An increase is already pending");

        Policy storage policy = policies[id];
        policy.pendingIncrease = amount;
        policy.increaseActivationTimestamp = activationTimestamp;
        
        emit PendingIncreaseAdded(id, amount, activationTimestamp);
    }


        /**
     * @notice Finalizes a pending increase, merging it into the main coverage.
     * @dev Only callable by the PolicyManager. This is triggered when the cooldown has passed.
     * @param id The ID of the policy NFT.
     */
    function finalizeIncrease(uint256 id) external onlyPolicyManager {
        Policy storage policy = policies[id];
        require(policies[id].start != 0, "PolicyNFT: Policy does not exist");
        require(policy.pendingIncrease > 0, "PolicyNFT: No pending increase");
        require(block.timestamp >= policy.increaseActivationTimestamp, "PolicyNFT: Cooldown still active");

        policy.coverage += policy.pendingIncrease;
        
        emit PolicyCoverageIncreased(id, policy.coverage);

        // Reset pending increase fields
        policy.pendingIncrease = 0;
        policy.increaseActivationTimestamp = 0;
    }

    /**
     * @notice Retrieves the data for a specific policy.
     */
    function getPolicy(uint256 id) external view returns (Policy memory p) {
        p = policies[id];
    }
}