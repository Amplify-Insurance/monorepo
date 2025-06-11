// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract PolicyNFT is ERC721URIStorage, Ownable {
    // --- CORRECTED: Updated Policy struct ---
    struct Policy {
        uint256 coverage;        // Liability in USDC
        uint256 poolId;          // RiskManager's protocolRiskPools index
        uint256 start;           // Timestamp of minting
        uint256 activation;      // Timestamp when cover becomes active
        uint128 premiumDeposit;  // The remaining premium balance for this policy
        uint128 lastDrainTime;   // The timestamp when the premium was last drained
    }

    uint256 public nextId = 1;
    mapping(uint256 => Policy) public policies;
    address public riskManagerContract; // Renamed for clarity

    // Events
    event PolicyPremiumAccountUpdated(uint256 indexed policyId, uint128 newDeposit, uint128 newDrainTime);
    event RiskManagerAddressSet(address indexed newRiskManagerAddress);

    modifier onlyRiskManager() {
        require(riskManagerContract != address(0), "PolicyNFT: RiskManager address not set");
        require(msg.sender == riskManagerContract, "PolicyNFT: Caller is not the authorized RiskManager");
        _;
    }

    constructor(address initialOwner) ERC721("Premium Drain Cover", "PCOVER") Ownable(initialOwner) {}

    /**
     * @notice Sets or updates the authorized RiskManager contract address.
     * @param _newRiskManagerAddress The address of the RiskManager contract.
     */
    function setRiskManagerAddress(address _newRiskManagerAddress) external onlyOwner {
        require(_newRiskManagerAddress != address(0), "PolicyNFT: Address cannot be zero");
        riskManagerContract = _newRiskManagerAddress;
        emit RiskManagerAddressSet(_newRiskManagerAddress);
    }

    /**
     * @notice Mints a new policy NFT. Only callable by the authorized RiskManager contract.
     * @dev CORRECTED: Signature updated to accept premium deposit fields.
     */
    function mint(
        address to,
        uint256 pid,
        uint256 coverage,
        uint256 activation,
        uint128 premiumDeposit,
        uint128 lastDrainTime
    ) external onlyRiskManager returns (uint256 id) {
        id = nextId++;
        _safeMint(to, id);
        policies[id] = Policy({
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
     * @notice Burns a policy NFT. Only callable by the authorized RiskManager contract.
     */
    function burn(uint256 id) external onlyRiskManager {
        _burn(id);
        delete policies[id];
    }

    /**
     * @notice ADDED: The missing function to update premium details.
     * @param id The ID of the policy NFT.
     * @param newDeposit The new remaining premium deposit amount.
     * @param newDrainTime The new drain timestamp (usually block.timestamp).
     */
    function updatePremiumAccount(uint256 id, uint128 newDeposit, uint128 newDrainTime) external onlyRiskManager {
        // --- FIX: Check for policy existence by verifying a non-zero value in the struct ---
        // The 'start' timestamp is always non-zero for a minted policy.
        require(policies[id].start != 0, "PolicyNFT: Policy does not exist or has been burned");
        
        Policy storage policy = policies[id];
        policy.premiumDeposit = newDeposit;
        policy.lastDrainTime = newDrainTime;
        emit PolicyPremiumAccountUpdated(id, newDeposit, newDrainTime);
    }
    /**
     * @notice Retrieves the data for a specific policy.
     */
    function getPolicy(uint256 id) external view returns (Policy memory p) {
        p = policies[id];
    }

    /**
     * @notice DEPRECATED: This function belongs to the old premium model.
     * It is left here to avoid breaking other potential dependencies but should not be used in the new model.
     */
    function updateLastPaid(uint256, uint256) external onlyRiskManager {
        revert("PolicyNFT: updateLastPaid is deprecated; use updatePremiumAccount");
    }
}