// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; // Import Ownable

contract PolicyNFT is ERC721URIStorage, Ownable { // Inherit Ownable
    struct Policy {
        uint256 coverage;        // liability in USDC (or other underlyingAsset)
        uint256 poolId;          // CoverPool's protocolRiskPools index
        uint256 start;           // block-timestamp of purchase
        uint256 activation;      // start + COVER_COOLDOWN_PERIOD
        uint256 lastPaidUntil;   // premium is settled up to (timestamp)
    }

    uint256 public nextId = 1;
    mapping(uint256 => Policy) public policies;
    address public coverPoolContract; // Address of the authorized CoverPool contract

    event PolicyLastPaidUpdated(uint256 indexed id, uint256 newLastPaidUntil, address caller);

    modifier onlyCoverPool() {
        require(msg.sender == coverPoolContract, "PolicyNFT: Caller is not the authorized CoverPool contract");
        _;
    }

    /**
     * @param initialOwner The account that will initially own this PolicyNFT contract (e.g., the deployer).
     */
    constructor(address initialOwner) ERC721("Perpetual Cover", "PCOVER") Ownable(initialOwner) {
        // coverPoolContract is NOT set at construction.
        // It will be set later by the owner via setCoverPoolAddress.
    }

    /**
     * @notice Sets or updates the authorized CoverPool contract address.
     * @dev Can only be called by the owner of this PolicyNFT contract.
     * This allows the CoverPool contract to mint, burn, and update policies.
     * @param _newCoverPoolAddress The address of the CoverPool contract.
     */
    function setCoverPoolAddress(address _newCoverPoolAddress) external onlyOwner {
        require(_newCoverPoolAddress != address(0), "PolicyNFT: CoverPool address cannot be zero");
        coverPoolContract = _newCoverPoolAddress;
        // Consider emitting an event
        // emit CoverPoolAddressSet(_newCoverPoolAddress);
    }

    /**
     * @notice Mints a new policy NFT. Only callable by the authorized CoverPool contract.
     * @param to The recipient of the new policy NFT.
     * @param pid The poolId from CoverPool this policy relates to.
     * @param coverage The coverage amount.
     * @param activation The timestamp when the policy becomes active.
     * @param paidUntil The timestamp until which the first premium covers.
     * @return id The ID of the newly minted policy NFT.
     */
    function mint(
        address  to,
        uint256  pid,
        uint256  coverage,
        uint256  activation,
        uint256  paidUntil
    ) external onlyCoverPool returns (uint256 id) {
        require(coverPoolContract != address(0), "PolicyNFT: CoverPool address not set");
        id = nextId++;
        _safeMint(to, id); // Mints the ERC721 token
        policies[id] = Policy({
            coverage:  coverage,
            poolId:    pid,
            start:     block.timestamp, // Timestamp of minting
            activation: activation,
            lastPaidUntil: paidUntil
        });
        return id;
    }

    /**
     * @notice Burns a policy NFT. Only callable by the authorized CoverPool contract.
     * @param id The ID of the policy NFT to burn.
     */
    function burn(uint256 id) external onlyCoverPool {
        require(coverPoolContract != address(0), "PolicyNFT: CoverPool address not set");
        // _exists(id) check is implicitly handled by _burn.
        // ERC721 _burn will revert if token doesn't exist or caller isn't authorized (but here CoverPool is always authorized by onlyCoverPool)
        _burn(id); // Burns the ERC721 token
        delete policies[id]; // Deletes associated policy data
    }

    /**
     * @notice Updates the lastPaidUntil timestamp for a policy. Only callable by the authorized CoverPool contract.
     * @param id The ID of the policy NFT.
     * @param ts The new lastPaidUntil timestamp.
        */
    function updateLastPaid(uint256 id, uint256 ts) external onlyCoverPool {
        require(coverPoolContract != address(0), "PolicyNFT: CoverPool address not set");
        require(policies[id].coverage > 0, "PolicyNFT: Policy does not exist or has zero coverage");
        policies[id].lastPaidUntil = ts;
        emit PolicyLastPaidUpdated(id, ts, msg.sender); // Add event
    }


    /**
     * @notice Retrieves the data for a specific policy.
     * @param id The ID of the policy NFT.
     * @return p The Policy struct containing policy details.
     */
    function getPolicy(uint256 id) external view returns (Policy memory p) {
        // No restriction needed as it's a view function, anyone can query policy data if they know the ID.
        p = policies[id];
    }

    // Event for when CoverPool address is set (optional but good practice)
    // event CoverPoolAddressSet(address indexed newCoverPoolAddress);
}