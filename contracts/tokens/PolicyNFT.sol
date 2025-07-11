// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IPolicyNFT.sol";

/**
 * @title PolicyNFT
 * @author Gemini
 * @notice This contract manages the ownership and state of insurance policies as NFTs.
 * This version is simplified to work with a PolicyManager that handles pending increase logic externally.
 */
contract PolicyNFT is ERC721URIStorage, Ownable, IPolicyNFT {

    uint256 public nextId = 1;
    mapping(uint256 => IPolicyNFT.Policy) public policies;
    address public policyManagerContract;

    // --- Events ---
    event PolicyPremiumAccountUpdated(uint256 indexed policyId, uint128 newDeposit, uint128 newDrainTime);
    event PolicyCoverageIncreased(uint256 indexed policyId, uint256 newTotalCoverage);
    event PolicyManagerAddressSet(address indexed newPolicyManagerAddress);


    modifier onlyPolicyManager() {
        require(policyManagerContract != address(0), "PolicyNFT: PolicyManager address not set");
        require(msg.sender == policyManagerContract, "PolicyNFT: Caller is not the authorized PolicyManager");
        _;
    }

    constructor(address _initialPolicyManager, address initialOwner) ERC721("Policy", "PCOVER") Ownable(initialOwner) {
        require(_initialPolicyManager != address(0), "PolicyNFT: PolicyManager address cannot be zero");
        policyManagerContract = _initialPolicyManager;
    }

    function setPolicyManagerAddress(address _newPolicyManagerAddress) external onlyOwner {
        require(_newPolicyManagerAddress != address(0), "PolicyNFT: Address cannot be zero");
        policyManagerContract = _newPolicyManagerAddress;
        emit PolicyManagerAddressSet(_newPolicyManagerAddress);
    }

    /**
     * @notice Mints a new policy NFT. Only callable by the authorized PolicyManager.
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
        
        // MODIFIED: Initialize the simpler struct.
        policies[id] = IPolicyNFT.Policy({
            coverage: coverage,
            poolId: pid,
            start: block.timestamp,
            activation: activation,
            premiumDeposit: premiumDeposit,
            lastDrainTime: lastDrainTime
        });
        return id;
    }

    /**
     * @notice Burns a policy NFT. Only callable by the authorized PolicyManager.
     */
    function burn(uint256 id) external onlyPolicyManager {
        _burn(id);
        delete policies[id];
    }

    /**
     * @notice Updates the premium details for a policy.
     */
    function updatePremiumAccount(uint256 id, uint128 newDeposit, uint128 newDrainTime) external onlyPolicyManager {
        // A non-zero 'start' time confirms the policy exists.
        require(policies[id].start != 0, "PolicyNFT: Policy does not exist or has been burned");
        
        IPolicyNFT.Policy storage policy = policies[id];
        policy.premiumDeposit = newDeposit;
        policy.lastDrainTime = newDrainTime;
        emit PolicyPremiumAccountUpdated(id, newDeposit, newDrainTime);
    }
    
    /**
     * @notice NEW: Finalizes one or more matured increases, adding the total amount to the main coverage.
     * @dev Called by the PolicyManager after it has processed its queue of pending increases.
     * @param id The ID of the policy NFT.
     * @param totalAmountToAdd The sum of all matured coverage increases to be added.
     */
    function finalizeIncreases(uint256 id, uint256 totalAmountToAdd) external onlyPolicyManager {
        require(policies[id].start != 0, "PolicyNFT: Policy does not exist or has been burned");
        require(totalAmountToAdd > 0, "PolicyNFT: Amount to add must be greater than zero");

        IPolicyNFT.Policy storage policy = policies[id];
        policy.coverage += totalAmountToAdd;
        
        emit PolicyCoverageIncreased(id, policy.coverage);
    }
    /**
     * @notice Retrieves the data for a specific policy.
     */
    function getPolicy(uint256 id) external view returns (IPolicyNFT.Policy memory) {
        return policies[id];
    }

    function ownerOf(uint256 id)
        public
        view
        override(ERC721, IERC721, IPolicyNFT)
        returns (address)
    {
        return super.ownerOf(id);
    }
}