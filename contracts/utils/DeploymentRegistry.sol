// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IDeploymentRegistry.sol";

/**
 * @title DeploymentRegistry
 * @notice Records addresses for successive contract deployments.
 * The owner can append entries so off-chain services can query all
 * historical deployments.
 */
contract DeploymentRegistry is Ownable, IDeploymentRegistry {
    Deployment[] private deployments;

    event DeploymentRegistered(uint256 indexed id, address indexed policyManager);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Append a new deployment to the registry.
     * @param deployment Deployment struct with component addresses.
     * @return id Index assigned to this deployment.
     */
    function registerDeployment(
        Deployment calldata deployment
    ) external override onlyOwner returns (uint256 id) {
        require(deployment.policyManager != address(0), "DR: zero address");
        deployments.push(deployment);
        id = deployments.length - 1;
        emit DeploymentRegistered(id, deployment.policyManager);
    }

    /// @inheritdoc IDeploymentRegistry
    function getDeployment(uint256 index) external view override returns (Deployment memory) {
        require(index < deployments.length, "DR: invalid index");
        return deployments[index];
    }

    /// @inheritdoc IDeploymentRegistry
    function getDeployments() external view override returns (Deployment[] memory) {
        return deployments;
    }

    /// @inheritdoc IDeploymentRegistry
    function getCount() external view override returns (uint256) {
        return deployments.length;
    }
}
