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
 * @dev UPDATED: Now includes a `reduceCoverage` function to support partial claims.
 */
contract PolicyNFT is ERC721URIStorage, Ownable, IPolicyNFT {

    uint256 public nextId = 1;
    mapping(uint256 => IPolicyNFT.Policy) public policies;
    address public policyManagerContract;
    address public riskManagerContract;

    // --- Events ---
    event PolicyPremiumAccountUpdated(uint256 indexed policyId, uint128 newDeposit, uint128 newDrainTime);
    event PolicyCoverageIncreased(uint256 indexed policyId, uint256 newTotalCoverage);
    event PolicyCoverageReduced(uint256 indexed policyId, uint256 newTotalCoverage); // NEW
    event PolicyManagerAddressSet(address indexed newPolicyManagerAddress);
    event RiskManagerAddressSet(address indexed newRiskManagerAddress);


    modifier onlyPolicyManager() {
        require(policyManagerContract != address(0), "PolicyNFT: PolicyManager address not set");
        require(msg.sender == policyManagerContract, "PolicyNFT: Caller is not the authorized PolicyManager");
        _;
    }

    modifier onlyRMOrPM() {
        require(riskManagerContract != address(0) || policyManagerContract != address(0), "PolicyNFT: Address not set");
        require(msg.sender == riskManagerContract || msg.sender == policyManagerContract , "PolicyNFT: Caller is not authorized");
        _;
    }

    constructor(address _initialPolicyManager, address initialOwner) ERC721("Policy", "PCOVER") Ownable(initialOwner) {
        // NOTE: The require check for a non-zero address was removed to allow for a two-step deployment pattern.
        // It's crucial that the address is set via setPolicyManagerAddress before any minting can occur.
        policyManagerContract = _initialPolicyManager;
    }

    function setPolicyManagerAddress(address newPolicyManagerAddress) external onlyOwner {
        require(newPolicyManagerAddress != address(0), "PolicyNFT: Address cannot be zero");
        policyManagerContract = newPolicyManagerAddress;
        emit PolicyManagerAddressSet(newPolicyManagerAddress);
    }

    function setRiskManagerAddress(address newRiskManagerAddress) external onlyOwner {
        require(newRiskManagerAddress != address(0), "PolicyNFT: Address cannot be zero");
        riskManagerContract = newRiskManagerAddress;
        emit RiskManagerAddressSet(newRiskManagerAddress);
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
     * @notice Burns a policy NFT. Only callable by the authorized PolicyManager or RiskManager.
     */
    function burn(uint256 id) external override onlyRMOrPM {
        _burn(id);
        delete policies[id];
    }

    /**
     * @notice Updates the premium details for a policy.
     */
    function updatePremiumAccount(uint256 id, uint128 newDeposit, uint128 newDrainTime) external onlyPolicyManager {
        require(policies[id].start != 0, "PolicyNFT: Policy does not exist or has been burned");
        
        IPolicyNFT.Policy storage policy = policies[id];
        policy.premiumDeposit = newDeposit;
        policy.lastDrainTime = newDrainTime;
        emit PolicyPremiumAccountUpdated(id, newDeposit, newDrainTime);
    }
    
    /**
     * @notice Finalizes one or more matured increases, adding the total amount to the main coverage.
     */
    function finalizeIncreases(uint256 id, uint256 totalAmountToAdd) external onlyPolicyManager {
        require(policies[id].start != 0, "PolicyNFT: Policy does not exist or has been burned");
        require(totalAmountToAdd > 0, "PolicyNFT: Amount to add must be greater than zero");

        IPolicyNFT.Policy storage policy = policies[id];
        policy.coverage += totalAmountToAdd;
        
        emit PolicyCoverageIncreased(id, policy.coverage);
    }

    /**
     * @notice NEW: Reduces a policy's coverage after a partial claim.
     * @dev Called by the RiskManager after a partial claim is processed.
     * @param id The ID of the policy NFT.
     * @param reductionAmount The amount to reduce the coverage by.
     */
    function reduceCoverage(uint256 id, uint256 reductionAmount) external override onlyRMOrPM {
        IPolicyNFT.Policy storage policy = policies[id];
        require(policy.start != 0, "PolicyNFT: Policy does not exist or has been burned");
        require(reductionAmount > 0 && reductionAmount < policy.coverage, "PolicyNFT: Invalid reduction amount");

        policy.coverage -= reductionAmount;
        
        emit PolicyCoverageReduced(id, policy.coverage);
    }

    /**
     * @notice Retrieves the data for a specific policy.
     */
    function getPolicy(uint256 id) external view override returns (IPolicyNFT.Policy memory) {
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
