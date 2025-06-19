const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

async function deployFixture() {
  const [owner, riskManager, user, other] = await ethers.getSigners();
  const LossDistributor = await ethers.getContractFactory("LossDistributor");
  const lossDistributor = await LossDistributor.deploy(riskManager.address);
  return { owner, riskManager, user, other, lossDistributor };
}

describe("LossDistributor", function () {
  describe("Deployment", function () {
    it("Initializes with correct owner and risk manager", async function () {
      const { owner, riskManager, lossDistributor } = await loadFixture(
        deployFixture
      );
      expect(await lossDistributor.owner()).to.equal(owner.address);
      expect(await lossDistributor.riskManager()).to.equal(riskManager.address);
    });

    it("Reverts when risk manager is zero", async function () {
      const LossDistributor = await ethers.getContractFactory(
        "LossDistributor"
      );
      await expect(
        LossDistributor.deploy(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(LossDistributor, "ZeroAddress");
    });
  });

  describe("setRiskManager", function () {
    it("Only owner can set new risk manager", async function () {
      const { other, lossDistributor } = await loadFixture(deployFixture);
      await expect(lossDistributor.connect(other).setRiskManager(other.address))
        .to.be.revertedWithCustomError(
          lossDistributor,
          "OwnableUnauthorizedAccount"
        )
        .withArgs(other.address);
    });

    it("Reverts on zero address", async function () {
      const { owner, lossDistributor } = await loadFixture(deployFixture);
      await expect(
        lossDistributor.connect(owner).setRiskManager(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(lossDistributor, "ZeroAddress");
    });

    it("Updates the risk manager", async function () {
      const { owner, other, lossDistributor } = await loadFixture(
        deployFixture
      );
      await lossDistributor.connect(owner).setRiskManager(other.address);
      expect(await lossDistributor.riskManager()).to.equal(other.address);
    });

    it("New risk manager controls privileged functions", async function () {
      const { owner, riskManager, other, lossDistributor } = await loadFixture(
        deployFixture
      );
      await lossDistributor.connect(owner).setRiskManager(other.address);
      await expect(
        lossDistributor
          .connect(riskManager)
          .distributeLoss(1, 1, 1)
      ).to.be.revertedWith("LD: Not RiskManager");
      await expect(
        lossDistributor.connect(other).distributeLoss(1, 1, 1)
      ).to.not.be.reverted;
    });
  });

  describe("distributeLoss", function () {
    const poolId = 1;
    const lossAmount = 100n;
    const pledge = 1000n;

    it("Reverts when called by non-risk manager", async function () {
      const { other, lossDistributor } = await loadFixture(deployFixture);
      await expect(
        lossDistributor
          .connect(other)
          .distributeLoss(poolId, lossAmount, pledge)
      ).to.be.revertedWith("LD: Not RiskManager");
    });

    it("Accumulates loss per share correctly", async function () {
      const { riskManager, lossDistributor } = await loadFixture(deployFixture);
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(poolId, lossAmount, pledge);
      const tracker = await lossDistributor.poolLossTrackers(poolId);
      const expected = (lossAmount * 10n ** 18n) / pledge;
      expect(tracker).to.equal(expected);
    });

    it("No-op when lossAmount or totalPledge is zero", async function () {
      const { riskManager, lossDistributor } = await loadFixture(deployFixture);
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(poolId, 0, pledge);
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(poolId, lossAmount, 0);
      const tracker = await lossDistributor.poolLossTrackers(poolId);
      expect(tracker).to.equal(0n);
    });

    it("Accumulates across multiple distributions and pools", async function () {
      const { riskManager, lossDistributor } = await loadFixture(deployFixture);
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(poolId, lossAmount, pledge);
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(poolId, lossAmount, pledge);
      const expected = (2n * lossAmount * 10n ** 18n) / pledge;
      expect(await lossDistributor.poolLossTrackers(poolId)).to.equal(expected);

      const otherPool = 2;
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(otherPool, lossAmount, pledge);
      expect(await lossDistributor.poolLossTrackers(otherPool)).to.equal(
        (lossAmount * 10n ** 18n) / pledge
      );
    });
  });

  describe("Loss realization", function () {
    const poolId = 1;
    const pledge = 1000n;

    it("Only risk manager can realize losses", async function () {
      const { other, user, lossDistributor } = await loadFixture(deployFixture);
      await expect(
        lossDistributor
          .connect(other)
          .realizeLosses(user.address, poolId, pledge)
      ).to.be.revertedWith("LD: Not RiskManager");
    });

    it("Computes and updates pending losses", async function () {
      const { riskManager, user, lossDistributor } = await loadFixture(
        deployFixture
      );
      // distribute 10% loss
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(poolId, 100n, pledge);
      expect(
        await lossDistributor.getPendingLosses(user.address, poolId, pledge)
      ).to.equal(100n);
      const realizedTx = await lossDistributor
        .connect(riskManager)
        .realizeLosses(user.address, poolId, pledge);
      await realizedTx.wait();
      expect(realizedTx).to.not.be.null;
      expect(
        await lossDistributor.getPendingLosses(user.address, poolId, pledge)
      ).to.equal(0n);
      let state = await lossDistributor.userLossStates(user.address, poolId);
      expect(state).to.equal(100n);

      // another loss
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(poolId, 100n, pledge);
      expect(
        await lossDistributor.getPendingLosses(user.address, poolId, pledge)
      ).to.equal(100n);
    });

    it("Returns zero when no losses are pending", async function () {
      const { riskManager, user, lossDistributor } = await loadFixture(
        deployFixture
      );
      const pending = await lossDistributor
        .connect(riskManager)
        .getFunction("realizeLosses")
        .staticCall(user.address, poolId, pledge);
      expect(pending).to.equal(0n);
      const tx = await lossDistributor
        .connect(riskManager)
        .realizeLosses(user.address, poolId, pledge);
      await tx.wait();
      expect(
        await lossDistributor.userLossStates(user.address, poolId)
      ).to.equal(0n);
    });

    it("Accumulates losses over multiple realizations", async function () {
      const { riskManager, user, lossDistributor } = await loadFixture(
        deployFixture
      );

      await lossDistributor
        .connect(riskManager)
        .distributeLoss(poolId, 100n, pledge);
      const firstPending = await lossDistributor
        .connect(riskManager)
        .getFunction("realizeLosses")
        .staticCall(user.address, poolId, pledge);
      expect(firstPending).to.equal(100n);
      await (
        await lossDistributor
          .connect(riskManager)
          .realizeLosses(user.address, poolId, pledge)
      ).wait();

      await lossDistributor
        .connect(riskManager)
        .distributeLoss(poolId, 50n, pledge);
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(poolId, 50n, pledge);
      const secondPending = await lossDistributor
        .connect(riskManager)
        .getFunction("realizeLosses")
        .staticCall(user.address, poolId, pledge);
      expect(secondPending).to.equal(100n);
      await (
        await lossDistributor
          .connect(riskManager)
          .realizeLosses(user.address, poolId, pledge)
      ).wait();

      const finalPending = await lossDistributor
        .connect(riskManager)
        .getFunction("realizeLosses")
        .staticCall(user.address, poolId, pledge);
      expect(finalPending).to.equal(0n);
    });

    it("Tracks losses independently per pool", async function () {
      const { riskManager, user, lossDistributor } = await loadFixture(
        deployFixture
      );
      const poolA = 1;
      const poolB = 2;
      const pledgeAmount = 1000n;
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(poolA, 100n, pledgeAmount);
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(poolB, 200n, pledgeAmount);
      await (
        await lossDistributor
          .connect(riskManager)
          .realizeLosses(user.address, poolA, pledgeAmount)
      ).wait();
      expect(
        await lossDistributor.getPendingLosses(user.address, poolB, pledgeAmount)
      ).to.equal(200n);
    });

    it("Handles fractional loss calculations", async function () {
      const { riskManager, user, lossDistributor } = await loadFixture(
        deployFixture
      );
      const pool = 3;
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(pool, 1n, 2n);
      expect(
        await lossDistributor.getPendingLosses(user.address, pool, 1n)
      ).to.equal(0n);
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(pool, 1n, 2n);
      expect(
        await lossDistributor.getPendingLosses(user.address, pool, 1n)
      ).to.equal(1n);
      await lossDistributor
        .connect(riskManager)
        .realizeLosses(user.address, pool, 1n);
      expect(
        await lossDistributor.getPendingLosses(user.address, pool, 1n)
      ).to.equal(0n);
    });

    it("Calculates pending losses for multiple users", async function () {
      const { riskManager, user, other, lossDistributor } = await loadFixture(
        deployFixture
      );
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(poolId, 100n, pledge);
      expect(
        await lossDistributor.getPendingLosses(user.address, poolId, pledge)
      ).to.equal(100n);
      expect(
        await lossDistributor.getPendingLosses(
          other.address,
          poolId,
          pledge / 2n
        )
      ).to.equal(50n);
    });

    it("Handles zero pledge when realizing losses", async function () {
      const { riskManager, user, lossDistributor } = await loadFixture(
        deployFixture
      );
      await lossDistributor
        .connect(riskManager)
        .distributeLoss(poolId, 100n, pledge);

      const pending = await lossDistributor
        .connect(riskManager)
        .getFunction("realizeLosses")
        .staticCall(user.address, poolId, 0);
      expect(pending).to.equal(0n);

      await (
        await lossDistributor
          .connect(riskManager)
          .realizeLosses(user.address, poolId, 0)
      ).wait();

      expect(
        await lossDistributor.userLossStates(user.address, poolId)
      ).to.equal(0n);
    });
  });
});
