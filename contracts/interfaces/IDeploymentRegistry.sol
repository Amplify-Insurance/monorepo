// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IDeploymentRegistry {
    struct Deployment {
        address policyNFT;
        address policyManager;
        address poolRegistry;
        address backstopPool;
        address capitalPool;
        address lossDistributor;
        address rewardDistributor;
        address riskManager;
        address protocolConfigurator;
        address underwriterManager;
    }

    function registerDeployment(
        Deployment calldata deployment
    ) external returns (uint256);

    function getDeployment(
        uint256 index
    ) external view returns (Deployment memory);

    function getDeployments() external view returns (Deployment[] memory);

    function getCount() external view returns (uint256);
}
