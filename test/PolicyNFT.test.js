const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

async function deployFixture() {
  const [owner, riskManager, user, other] = await ethers.getSigners();
  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  const policyNFT = await PolicyNFT.deploy(owner.address);
  return { owner, riskManager, user, other, policyNFT };
}

describe("PolicyNFT", function () {
  describe("Deployment", function () {
    it("Initial state", async function () {
      const { owner, policyNFT } = await loadFixture(deployFixture);
      expect(await policyNFT.owner()).to.equal(owner.address);
      expect(await policyNFT.nextId()).to.equal(1n);
      expect(await policyNFT.riskManagerContract()).to.equal(ethers.ZeroAddress);
      expect(await policyNFT.name()).to.equal("Premium Drain Cover");
      expect(await policyNFT.symbol()).to.equal("PCOVER");
    });
  });

  describe("setRiskManagerAddress", function () {
    it("Only owner can set", async function () {
      const { owner, riskManager, other, policyNFT } = await loadFixture(deployFixture);
      await expect(policyNFT.connect(other).setRiskManagerAddress(riskManager.address))
        .to.be.revertedWithCustomError(policyNFT, "OwnableUnauthorizedAccount")
        .withArgs(other.address);
      await policyNFT.connect(owner).setRiskManagerAddress(riskManager.address);
      expect(await policyNFT.riskManagerContract()).to.equal(riskManager.address);
    });

    it("Emits event on update", async function () {
      const { owner, riskManager, policyNFT } = await loadFixture(deployFixture);
      await expect(policyNFT.connect(owner).setRiskManagerAddress(riskManager.address))
        .to.emit(policyNFT, "RiskManagerAddressSet")
        .withArgs(riskManager.address);
    });

    it("Cannot set zero address", async function () {
      const { owner, policyNFT } = await loadFixture(deployFixture);
      await expect(policyNFT.connect(owner).setRiskManagerAddress(ethers.ZeroAddress))
        .to.be.revertedWith("PolicyNFT: Address cannot be zero");
    });
  });

  describe("mint", function () {
    const poolId = 1n;
    const coverage = 1000n;
    const activation = 12345n;
    const premiumDeposit = 1000n;
    const lastDrainTime = 12346n;

    it("Reverts if risk manager address not set", async function () {
      const { policyNFT, riskManager, user } = await loadFixture(deployFixture);
      await expect(
        policyNFT.connect(riskManager).mint(user.address, poolId, coverage, activation, premiumDeposit, lastDrainTime)
      ).to.be.revertedWith("PolicyNFT: RiskManager address not set");
    });

    it("Only risk manager can mint and policy is stored", async function () {
      const { owner, policyNFT, riskManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setRiskManagerAddress(riskManager.address);

      await expect(
        policyNFT.connect(owner).mint(user.address, poolId, coverage, activation, premiumDeposit, lastDrainTime)
      ).to.be.revertedWith("PolicyNFT: Caller is not the authorized RiskManager");

      const tx = await policyNFT
        .connect(riskManager)
        .mint(user.address, poolId, coverage, activation, premiumDeposit, lastDrainTime);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(policyNFT, "Transfer")
        .withArgs(ethers.ZeroAddress, user.address, 1n);

      expect(await policyNFT.nextId()).to.equal(2n);
      const policy = await policyNFT.getPolicy(1n);
      expect(policy.coverage).to.equal(coverage);
      expect(policy.poolId).to.equal(poolId);
      expect(policy.activation).to.equal(activation);
      expect(policy.premiumDeposit).to.equal(premiumDeposit);
      expect(policy.lastDrainTime).to.equal(lastDrainTime);
      expect(policy.start).to.equal(BigInt(block.timestamp));
      expect(await policyNFT.ownerOf(1n)).to.equal(user.address);
    });

    it("Increments token ids sequentially", async function () {
      const { owner, policyNFT, riskManager, user, other } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setRiskManagerAddress(riskManager.address);
      await policyNFT.connect(riskManager).mint(user.address, poolId, coverage, activation, premiumDeposit, lastDrainTime);
      await policyNFT.connect(riskManager).mint(other.address, poolId, coverage, activation, premiumDeposit, lastDrainTime);
      expect(await policyNFT.nextId()).to.equal(3n);
      expect(await policyNFT.ownerOf(1n)).to.equal(user.address);
      expect(await policyNFT.ownerOf(2n)).to.equal(other.address);
    });
  });

  describe("burn", function () {
    it("Burns token and deletes policy", async function () {
      const { owner, policyNFT, riskManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setRiskManagerAddress(riskManager.address);
      await policyNFT.connect(riskManager).mint(user.address, 1, 1000, 0, 0, 0);

      await expect(policyNFT.connect(owner).burn(1)).to.be.revertedWith(
        "PolicyNFT: Caller is not the authorized RiskManager"
      );

      await policyNFT.connect(riskManager).burn(1);
      await expect(policyNFT.ownerOf(1)).to.be.reverted;
      const policy = await policyNFT.getPolicy(1);
      expect(policy.coverage).to.equal(0n);
      expect(policy.poolId).to.equal(0n);
      expect(policy.start).to.equal(0n);
      expect(policy.activation).to.equal(0n);
      expect(policy.premiumDeposit).to.equal(0n);
      expect(policy.lastDrainTime).to.equal(0n);
    });

    it("Reverts when token does not exist", async function () {
      const { owner, riskManager, policyNFT } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setRiskManagerAddress(riskManager.address);
      await expect(policyNFT.connect(riskManager).burn(1))
        .to.be.revertedWithCustomError(policyNFT, "ERC721NonexistentToken")
        .withArgs(1);
    });
  });

  describe("updatePremiumAccount", function () {
    it("Reverts if risk manager address not set", async function () {
      const { policyNFT, riskManager } = await loadFixture(deployFixture);
      await expect(policyNFT.connect(riskManager).updatePremiumAccount(1, 0, 0))
        .to.be.revertedWith("PolicyNFT: RiskManager address not set");
    });

    it("Reverts if caller is not risk manager", async function () {
      const { owner, other, policyNFT, riskManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setRiskManagerAddress(riskManager.address);
      await policyNFT.connect(riskManager).mint(user.address, 1, 1000, 0, 0, 0);
      await expect(policyNFT.connect(other).updatePremiumAccount(1, 0, 0))
        .to.be.revertedWith("PolicyNFT: Caller is not the authorized RiskManager");
    });

    it("Updates premium fields and emits event", async function () {
      const { owner, policyNFT, riskManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setRiskManagerAddress(riskManager.address);
      await policyNFT.connect(riskManager).mint(user.address, 1, 1000, 0, 500, 0);

      const newDeposit = 300n;
      const newDrainTime = 5000n;
      await expect(policyNFT.connect(owner).updatePremiumAccount(1, newDeposit, newDrainTime)).to.be.revertedWith(
        "PolicyNFT: Caller is not the authorized RiskManager"
      );

      await expect(policyNFT.connect(riskManager).updatePremiumAccount(2, newDeposit, newDrainTime)).to.be.revertedWith(
        "PolicyNFT: Policy does not exist or has been burned"
      );

      await expect(policyNFT.connect(riskManager).updatePremiumAccount(1, newDeposit, newDrainTime))
        .to.emit(policyNFT, "PolicyPremiumAccountUpdated")
        .withArgs(1n, newDeposit, newDrainTime);

      const policy = await policyNFT.getPolicy(1);
      expect(policy.premiumDeposit).to.equal(newDeposit);
      expect(policy.lastDrainTime).to.equal(newDrainTime);
    });

    it("Reverts if policy was burned", async function () {
      const { owner, policyNFT, riskManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setRiskManagerAddress(riskManager.address);
      await policyNFT.connect(riskManager).mint(user.address, 1, 1000, 0, 0, 0);
      await policyNFT.connect(riskManager).burn(1);
      await expect(policyNFT.connect(riskManager).updatePremiumAccount(1, 0, 0)).to.be.revertedWith(
        "PolicyNFT: Policy does not exist or has been burned"
      );
    });
  });

  describe("updateLastPaid", function () {
    it("Reverts if risk manager address not set", async function () {
      const { riskManager, policyNFT } = await loadFixture(deployFixture);
      await expect(policyNFT.connect(riskManager).updateLastPaid(1, 0)).to.be.revertedWith(
        "PolicyNFT: RiskManager address not set"
      );
    });

    it("Reverts if caller is not risk manager", async function () {
      const { owner, other, riskManager, policyNFT } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setRiskManagerAddress(riskManager.address);
      await expect(policyNFT.connect(other).updateLastPaid(1, 0)).to.be.revertedWith(
        "PolicyNFT: Caller is not the authorized RiskManager"
      );
    });

    it("Always reverts", async function () {
      const { owner, riskManager, policyNFT } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setRiskManagerAddress(riskManager.address);
      await expect(policyNFT.connect(riskManager).updateLastPaid(1, 0)).to.be.revertedWith(
        "PolicyNFT: updateLastPaid is deprecated; use updatePremiumAccount"
      );
    });
  });

  describe("getPolicy", function () {
    it("Returns zero struct for unknown id", async function () {
      const { policyNFT } = await loadFixture(deployFixture);
      const policy = await policyNFT.getPolicy(99);
      expect(policy.coverage).to.equal(0);
      expect(policy.poolId).to.equal(0);
      expect(policy.start).to.equal(0);
    });
  });
});

