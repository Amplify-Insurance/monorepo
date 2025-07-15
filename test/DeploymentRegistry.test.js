const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

async function deployFixture() {
  const [owner, other] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("DeploymentRegistry");
  const registry = await Registry.deploy();
  return { owner, other, registry };
}

describe("DeploymentRegistry", function () {
  it("records deployments and returns them", async function () {
    const { registry } = await loadFixture(deployFixture);
    const deployment = {
      policyNFT: "0x52E49178ad281dfF1B27eCBabb648a9daD610166",
      policyManager: "0x990C52D044bdDa263D54BBf30124c35D8B27cD88",
      poolRegistry: "0xCFb0b00AEA3dc5c260642bd1D04D8BDC5f422fC0",
      backstopPool: "0x088e04d044eD987e9c99AE6a82bA385bC3C06f24",
      capitalPool: "0x7b3E7a44C5b498F53F0EACe8F34c83521bc1d838",
      lossDistributor: "0x9b455F2CB52563AbE7cA18aBA95ED112a8eEC75D",
      rewardDistributor: "0x72Bf15F8765a0e946934D405f02DEf9D74a841bb",
      riskManager: "0x0AC80254b545e573ec2583a818e20F7437AebFE0",
      protocolConfigurator: ethers.Wallet.createRandom().address,
      underwriterManager: ethers.Wallet.createRandom().address,
    };

    await registry.registerDeployment(deployment);
    expect(await registry.getCount()).to.equal(1);
    const stored = await registry.getDeployment(0);
    expect(stored.policyNFT).to.equal(deployment.policyNFT);
    expect(stored.policyManager).to.equal(deployment.policyManager);
    expect(stored.poolRegistry).to.equal(deployment.poolRegistry);
    expect(stored.backstopPool).to.equal(deployment.backstopPool);
    expect(stored.capitalPool).to.equal(deployment.capitalPool);
    expect(stored.lossDistributor).to.equal(deployment.lossDistributor);
    expect(stored.rewardDistributor).to.equal(deployment.rewardDistributor);
    expect(stored.riskManager).to.equal(deployment.riskManager);
    expect(stored.protocolConfigurator).to.equal(deployment.protocolConfigurator);
    expect(stored.underwriterManager).to.equal(deployment.underwriterManager);
    const list = await registry.getDeployments();
    expect(list.length).to.equal(1);
    expect(list[0].policyManager).to.equal(deployment.policyManager);
  });

  it("restricts registration to the owner", async function () {
    const { registry, other } = await loadFixture(deployFixture);
    await expect(
      registry.connect(other).registerDeployment({
        policyNFT: other.address,
        policyManager: other.address,
        poolRegistry: other.address,
        backstopPool: other.address,
        capitalPool: other.address,
        lossDistributor: other.address,
        rewardDistributor: other.address,
        riskManager: other.address,
        protocolConfigurator: other.address,
        underwriterManager: other.address,
      })
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
  });
});
