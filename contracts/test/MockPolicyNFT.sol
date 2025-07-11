// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockPolicyNFT {
    struct Policy {
        uint256 coverage;
        uint256 poolId;
        uint256 start;
        uint256 activation;
        uint128 premiumDeposit;
        uint128 lastDrainTime;
    }

    mapping(uint256 => Policy) public policies;
    mapping(uint256 => address) public ownerOf;

    uint256 public nextPolicyId = 1;
    uint256 public last_burn_id;
    address public coverPool;
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address _owner) {
        owner = _owner;
    }

    function setCoverPoolAddress(address _coverPool) external onlyOwner {
        coverPool = _coverPool;
    }

    function mint(address to, uint256 poolId, uint256 coverage, uint256 activation, uint128 deposit, uint128 drain)
        external
        returns (uint256 id)
    {
        require(msg.sender == coverPool, "not cover pool");
        id = nextPolicyId++;
        ownerOf[id] = to;
        policies[id] = Policy({
            coverage: coverage,
            poolId: poolId,
            start: block.timestamp,
            activation: activation,
            premiumDeposit: deposit,
            lastDrainTime: drain
        });
    }

    function burn(uint256 id) external {
        require(msg.sender == coverPool, "not cover pool");
        last_burn_id = id;
        delete ownerOf[id];
        delete policies[id];
    }

    function updatePremiumAccount(uint256 id, uint128 newDeposit, uint128 newDrainTime) external {
        require(msg.sender == coverPool, "not cover pool");
        Policy storage p = policies[id];
        p.premiumDeposit = newDeposit;
        p.lastDrainTime = newDrainTime;
    }

    function finalizeIncreases(uint256 id, uint256 add) external {
        require(msg.sender == coverPool, "not cover pool");
        policies[id].coverage += add;
    }

    function getPolicy(uint256 id) external view returns (Policy memory) {
        return policies[id];
    }

    function mock_setPolicy(
        uint256 id,
        address to,
        uint256 poolId,
        uint256 coverage,
        uint256 start,
        uint256 activation,
        uint128 deposit,
        uint128 drain
    ) external {
        ownerOf[id] = to;
        policies[id] = Policy({
            coverage: coverage,
            poolId: poolId,
            start: start,
            activation: activation,
            premiumDeposit: deposit,
            lastDrainTime: drain
        });
    }
}
