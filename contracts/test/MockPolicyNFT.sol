// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockPolicyNFT
 * @notice A mock implementation of the PolicyNFT contract for testing purposes.
 * @dev This contract simulates the core functionalities of the real PolicyNFT
 * that are called by an external contract like a RiskManager. It does not
 * implement the full ERC721 standard to keep it simple and focused for testing.
 */
contract MockPolicyNFT is Ownable {

    // Mimic the Policy struct from the real contract
    struct Policy {
        uint256 coverage;
        uint256 poolId;
        uint256 start;
        uint256 activation;
        uint256 lastPaidUntil;
    }

    // --- State for Mocking ---

    uint256 public nextTokenId = 1;
    mapping(uint256 => Policy) public policies;
    mapping(uint256 => address) private _owners; // Internal mapping to mock ownerOf

    // Variables to record the last call for testing convenience
    address public last_mint_to;
    uint256 public last_burn_id;

    // --- Events for Testing ---

    event PolicyMinted(uint256 indexed id, address indexed owner, uint256 poolId, uint256 coverage);
    event PolicyBurned(uint256 indexed id);
    event PolicyLastPaidUpdated(uint256 indexed id, uint256 newLastPaidUntil);

    constructor(address _initialOwner) Ownable(_initialOwner) {}


    // --- Mocked Functions (Publicly callable for easy test setup) ---

    /**
     * @notice Mocks the minting of a new policy.
     */
    function mint(
        address to,
        uint256 pid,
        uint256 coverage,
        uint256 activation,
        uint256 paidUntil
    ) external returns (uint256 id) {
        id = nextTokenId++;
        _owners[id] = to;
        policies[id] = Policy({
            coverage: coverage,
            poolId: pid,
            start: block.timestamp,
            activation: activation,
            lastPaidUntil: paidUntil
        });
        
        last_mint_to = to; // Record for testing
        emit PolicyMinted(id, to, pid, coverage);
        return id;
    }

    /**
     * @notice Mocks the burning of a policy.
     */
    function burn(uint256 id) external {
        require(_owners[id] != address(0), "MockPolicyNFT: Policy does not exist");
        delete policies[id];
        delete _owners[id];
        
        last_burn_id = id; // Record for testing
        emit PolicyBurned(id);
    }

    /**
     * @notice Mocks updating the lastPaidUntil timestamp.
     */
    function updateLastPaid(uint256 id, uint256 ts) external {
        require(policies[id].coverage > 0, "MockPolicyNFT: Policy does not exist");
        policies[id].lastPaidUntil = ts;
        emit PolicyLastPaidUpdated(id, ts);
    }

    // --- View Functions for Mocking ERC721 and Contract State ---

    /**
     * @notice Mocks the getPolicy view function.
     */
    function getPolicy(uint256 id) external view returns (Policy memory) {
        return policies[id];
    }

    /**
     * @notice Mocks the ownerOf view function from the ERC721 standard.
     */
    function ownerOf(uint256 id) external view returns (address) {
        address owner = _owners[id];
        require(owner != address(0), "MockPolicyNFT: owner query for nonexistent token");
        return owner;
    }
}