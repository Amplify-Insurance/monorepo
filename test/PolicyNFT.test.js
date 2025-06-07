const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

async function deployFixture() {
  const [owner, coverPool, user, other] = await ethers.getSigners();
  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  const policyNFT = await PolicyNFT.deploy(owner.address);
  return { owner, coverPool, user, other, policyNFT };
}

describe("PolicyNFT", function () {
  describe("Deployment", function () {
    it("Initial state", async function () {
      const { owner, policyNFT } = await loadFixture(deployFixture);
      expect(await policyNFT.owner()).to.equal(owner.address);
      expect(await policyNFT.nextId()).to.equal(1n);
      expect(await policyNFT.coverPoolContract()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("setCoverPoolAddress", function () {
    it("Only owner can set", async function () {
      const { owner, coverPool, other, policyNFT } = await loadFixture(deployFixture);
      await expect(policyNFT.connect(other).setCoverPoolAddress(coverPool.address))
        .to.be.revertedWithCustomError(policyNFT, "OwnableUnauthorizedAccount")
        .withArgs(other.address);
      await policyNFT.connect(owner).setCoverPoolAddress(coverPool.address);
      expect(await policyNFT.coverPoolContract()).to.equal(coverPool.address);
    });

    it("Cannot set zero address", async function () {
      const { owner, policyNFT } = await loadFixture(deployFixture);
      await expect(policyNFT.connect(owner).setCoverPoolAddress(ethers.ZeroAddress))
        .to.be.revertedWith("PolicyNFT: CoverPool address cannot be zero");
    });
  });

  describe("mint", function () {
    const poolId = 1n;
    const coverage = 1000n;
    const activation = 12345n;
    const paidUntil = 12346n;

    it("Reverts if coverPool address not set", async function () {
      const { policyNFT, coverPool, user } = await loadFixture(deployFixture);
      await expect(
        policyNFT.connect(coverPool).mint(user.address, poolId, coverage, activation, paidUntil)
      ).to.be.revertedWith("PolicyNFT: CoverPool address not set");
    });

    it("Only coverPool can mint and policy is stored", async function () {
      const { owner, policyNFT, coverPool, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setCoverPoolAddress(coverPool.address);

      await expect(
        policyNFT.connect(owner).mint(user.address, poolId, coverage, activation, paidUntil)
      ).to.be.revertedWith("PolicyNFT: Caller is not the authorized CoverPool contract");

      const tx = await policyNFT
        .connect(coverPool)
        .mint(user.address, poolId, coverage, activation, paidUntil);
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
      expect(policy.lastPaidUntil).to.equal(paidUntil);
      expect(policy.start).to.equal(BigInt(block.timestamp));
      expect(await policyNFT.ownerOf(1n)).to.equal(user.address);
    });
  });

  describe("burn", function () {
    it("Burns token and deletes policy", async function () {
      const { owner, policyNFT, coverPool, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setCoverPoolAddress(coverPool.address);
      await policyNFT.connect(coverPool).mint(user.address, 1, 1000, 0, 0);

      await expect(policyNFT.connect(owner).burn(1)).to.be.revertedWith(
        "PolicyNFT: Caller is not the authorized CoverPool contract"
      );

      await policyNFT.connect(coverPool).burn(1);
      await expect(policyNFT.ownerOf(1)).to.be.reverted;
      const policy = await policyNFT.getPolicy(1);
      expect(policy.coverage).to.equal(0n);
    });
  });

  describe("updateLastPaid", function () {
    it("Updates timestamp and emits event", async function () {
      const { owner, policyNFT, coverPool, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setCoverPoolAddress(coverPool.address);
      await policyNFT.connect(coverPool).mint(user.address, 1, 1000, 0, 0);

      const newTs = 5000n;
      await expect(policyNFT.connect(owner).updateLastPaid(1, newTs)).to.be.revertedWith(
        "PolicyNFT: Caller is not the authorized CoverPool contract"
      );

      await expect(policyNFT.connect(coverPool).updateLastPaid(2, newTs)).to.be.revertedWith(
        "PolicyNFT: Policy does not exist or has zero coverage"
      );

      await expect(policyNFT.connect(coverPool).updateLastPaid(1, newTs))
        .to.emit(policyNFT, "PolicyLastPaidUpdated")
        .withArgs(1n, newTs, coverPool.address);

      const policy = await policyNFT.getPolicy(1);
      expect(policy.lastPaidUntil).to.equal(newTs);
    });
  });
});

