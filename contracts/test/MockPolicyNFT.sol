// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../../contracts/interfaces/IPolicyNFT.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockPolicyNFT
 * @notice A mock implementation of the PolicyNFT contract for testing purposes.
 * @dev This contract simulates the core functionalities of the real PolicyNFT
 * that are called by an external contract like a RiskManager. It does not
 * implement the full ERC721 standard to keep it simple and focused for testing.
 */
contract MockPolicyNFT is Ownable, IPolicyNFT {

    // Internal struct used for storage. Includes an extra field compared to the
    // IPolicyNFT.Policy struct to help tests track premium payments.
    struct PolicyInfo {
        uint256 poolId;
        uint256 coverage;
        uint256 activation;
        uint256 lastPaidUntil;
        uint128 premiumDeposit;
        uint128 lastDrainTime;
    }

    // --- State for Mocking ---

    // Counter for the next policy token id
    uint256 public nextPolicyId = 1;
    mapping(uint256 => PolicyInfo) public policies;
    mapping(uint256 => address) private _owners; // Internal mapping to mock ownerOf
    // Address of the CoverPool contract that is allowed to mint/burn
    address public coverPoolAddress;

    // Variables to record the last call for testing convenience
    address public last_mint_to;
    uint256 public last_burn_id;

    // --- Events for Testing ---

    event PolicyBurned(uint256 indexed id);
    event PolicyLastPaidUpdated(uint256 indexed id, uint256 newLastPaidUntil);

    event PolicyMinted(
        uint256 policyId,
        address owner,
        uint256 poolId,
        uint256 coverage,
        uint256 activation,
        uint128 premium,
        uint128 lastDrain
    );
    constructor(address _initialOwner) Ownable(_initialOwner) {}

    /**
     * @dev Internal mint function used by the mock to assign ownership of a
     *      newly created policy. This keeps the implementation minimal but
     *      mirrors the behaviour needed by the tests.
     */
    function _mint(address to, uint256 id) internal {
        require(to != address(0), "MockPolicyNFT: mint to zero address");
        require(_owners[id] == address(0), "MockPolicyNFT: policy already minted");
        _owners[id] = to;
        last_mint_to = to;
    }

    // ------------------------------------------------------------------
    // Convenience setters used only in the tests. These functions allow the
    // test suite to directly manipulate policy state without going through a
    // full CoverPool workflow.
    // ------------------------------------------------------------------

    modifier onlyCoverPool() {
        require(msg.sender == coverPoolAddress, "MockPolicyNFT: Not CoverPool");
        _;
    }

    // New helper mirroring the production contract's API
    function setRiskManagerAddress(address _riskManager) external onlyOwner {
        require(_riskManager != address(0), "MockPolicyNFT: RM address cannot be zero");
        coverPoolAddress = _riskManager;
    }

    function setCoverPoolAddress(address _coverPool) external onlyOwner {
        require(_coverPool != address(0), "MockPolicyNFT: CoverPool address cannot be zero");
        coverPoolAddress = _coverPool;
    }

    function mock_setPolicy(
        uint256 id,
        address owner,
        uint256 pid,
        uint256 coverage,
        uint256 activation,
        uint256 paidUntil,
        uint128 premiumDeposit,
        uint128 lastDrainTime
    ) external {
        policies[id] = PolicyInfo({
            poolId: pid,
            coverage: coverage,
            activation: activation,
            lastPaidUntil: paidUntil,
            premiumDeposit: premiumDeposit,
            lastDrainTime: lastDrainTime
        });
        _owners[id] = owner;
    }

    function mock_setLastPaid(uint256 id, uint256 ts) external {
        policies[id].lastPaidUntil = ts;
    }

    function mock_setCoverage(uint256 id, uint256 coverage) external {
        policies[id].coverage = coverage;
    }

    function mock_setActivation(uint256 id, uint256 activation) external {
        policies[id].activation = activation;
    }


    // --- Mocked Functions (Publicly callable for easy test setup) ---

    /**
     * @notice Mocks the minting of a new policy.
     */
    function mint(
        address _owner,
        uint256 _poolId,
        uint256 _coverage,
        uint256 _activation,
        uint128 _premiumDeposit,
        uint128 _lastDrainTime
    ) external override onlyCoverPool returns (uint256) {
        uint256 id = nextPolicyId++;
        policies[id] = PolicyInfo({
            poolId: _poolId,
            coverage: _coverage,
            activation: _activation,
            lastPaidUntil: 0,
            premiumDeposit: _premiumDeposit,
            lastDrainTime: _lastDrainTime
        });
        _mint(_owner, id);
        // Note: The PolicyMinted event is a custom event for testing purposes.
        // It's defined here to match what the test expects.
        emit PolicyMinted(id, _owner, _poolId, _coverage, _activation, _premiumDeposit, _lastDrainTime);
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
    function getPolicy(uint256 id) external view returns (IPolicyNFT.Policy memory) {
        PolicyInfo memory p = policies[id];
        return IPolicyNFT.Policy({
            poolId: p.poolId,
            coverage: p.coverage,
            activation: p.activation,
            premiumDeposit: p.premiumDeposit,
            lastDrainTime: p.lastDrainTime
        });
    }

    /**
     * @notice Mocks the ownerOf view function from the ERC721 standard.
     */
    function ownerOf(uint256 id) external view returns (address) {
        address owner = _owners[id];
        require(owner != address(0), "MockPolicyNFT: owner query for nonexistent token");
        return owner;
    }

        function updatePremiumAccount(uint256 _policyId, uint128 _newDeposit, uint128 _newDrainTime) external override onlyCoverPool {
        policies[_policyId].premiumDeposit = _newDeposit;
        policies[_policyId].lastDrainTime = _newDrainTime;
    }
}