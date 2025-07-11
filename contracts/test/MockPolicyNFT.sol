// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IPolicyNFT.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockPolicyNFT is IPolicyNFT, Ownable {
    uint256 public nextPolicyId = 1;
    mapping(uint256 => IPolicyNFT.Policy) public policies;
    address public coverPoolAddress;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setCoverPoolAddress(address _pool) external {
        coverPoolAddress = _pool;
    }

    function mint(
        address,
        uint256 poolId,
        uint256 coverage,
        uint256 activation,
        uint128 premiumDeposit,
        uint128 lastDrainTime
    ) external override returns (uint256 id) {
        id = nextPolicyId++;
        policies[id] = IPolicyNFT.Policy({
            coverage: coverage,
            poolId: poolId,
            start: block.timestamp,
            activation: activation,
            premiumDeposit: premiumDeposit,
            lastDrainTime: lastDrainTime
        });
    }

    function finalizeIncreases(uint256 policyId, uint256 amount) external override {
        policies[policyId].coverage += amount;
    }

    function burn(uint256 policyId) external override {
        delete policies[policyId];
    }

    function ownerOf(uint256) external view override returns (address) {
        return address(0);
    }

    function getPolicy(uint256 policyId) external view override returns (Policy memory) {
        return policies[policyId];
    }

    function updatePremiumAccount(uint256 policyId, uint128 newDeposit, uint128 newDrainTime) external override {
        IPolicyNFT.Policy storage pol = policies[policyId];
        pol.premiumDeposit = newDeposit;
        pol.lastDrainTime = newDrainTime;
    }

    function mock_setPolicy(
        uint256 policyId,
        address,
        uint256 poolId,
        uint256 coverage,
        uint256 start,
        uint256 activation,
        uint128 premiumDeposit,
        uint128 lastDrainTime
    ) external {
        policies[policyId] = IPolicyNFT.Policy({
            coverage: coverage,
            poolId: poolId,
            start: start,
            activation: activation,
            premiumDeposit: premiumDeposit,
            lastDrainTime: lastDrainTime
        });
        if (policyId >= nextPolicyId) {
            nextPolicyId = policyId + 1;
        }
    }
}
