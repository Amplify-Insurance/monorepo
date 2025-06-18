// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ContractRegistry
 * @notice Simple registry mapping identifier hashes to contract addresses.
 * Allows the owner to update entries so other contracts or frontends can
 * look up the active implementation addresses.
 */
contract ContractRegistry is Ownable {
    mapping(bytes32 => address) private registry;

    event ContractRegistered(bytes32 indexed id, address indexed addr);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Set the address for a given identifier.
     * @param id Keccak256 hash or other identifier for the contract.
     * @param addr Address of the deployed contract.
     */
    function setContract(bytes32 id, address addr) external onlyOwner {
        require(addr != address(0), "Registry: zero address");
        registry[id] = addr;
        emit ContractRegistered(id, addr);
    }

    /**
     * @notice Get the registered address for an identifier.
     * @param id Identifier hash.
     * @return Registered contract address or zero address if missing.
     */
    function getContract(bytes32 id) external view returns (address) {
        return registry[id];
    }
}
