const { expect } = require("chai");
const { ethers } = require("hardhat");

const PRECISION = 10n ** 18n;

async function deployFixture() {
  const [owner, riskManager, catPool, user, other] = await ethers.getSigners();

  const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
  const rd = await RewardDistributor.deploy(riskManager.address);

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy("Reward", "RWD", 18);
  await token.mint(rd.target, ethers.parseEther("1000"));

  return { owner, riskManager, catPool, user, other, rd, token };
}

describe("RewardDistributor", function () {
  describe("Deployment", function () {
    it("sets the initial riskManager", async function () {
      const { riskManager, rd } = await deployFixture();
      expect(await rd.riskManager()).to.equal(riskManager.address);
    });

    it("reverts if riskManager is zero", async function () {
      const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
      await expect(RewardDistributor.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        RewardDistributor, "ZeroAddress"
      );
    });
  });

  describe("Admin functions", function () {
    it("owner can set catPool", async function () {
      const { owner, catPool, rd } = await deployFixture();
      await expect(rd.connect(owner).setCatPool(catPool.address))
        .to.emit(rd, "CatPoolSet")
        .withArgs(catPool.address);
      expect(await rd.catPool()).to.equal(catPool.address);
    });

    it("non-owner cannot set catPool", async function () {
      const { catPool, rd, other } = await deployFixture();
      await expect(rd.connect(other).setCatPool(catPool.address)).to.be.revertedWithCustomError(
        rd,
        "OwnableUnauthorizedAccount"
      );
    });

    it("reverts when setting catPool to zero", async function () {
      const { owner, rd } = await deployFixture();
      await expect(rd.connect(owner).setCatPool(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        rd,
        "ZeroAddress"
      );
    });

    it("owner can set riskManager", async function () {
      const { owner, other, rd } = await deployFixture();
      await expect(rd.connect(owner).setRiskManager(other.address)).to.not.be.reverted;
      expect(await rd.riskManager()).to.equal(other.address);
    });

    it("non-owner cannot set riskManager", async function () {
      const { other, rd } = await deployFixture();
      await expect(rd.connect(other).setRiskManager(other.address)).to.be.revertedWithCustomError(
        rd,
        "OwnableUnauthorizedAccount"
      );
    });

    it("reverts when setting riskManager to zero", async function () {
      const { owner, rd } = await deployFixture();
      await expect(rd.connect(owner).setRiskManager(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        rd,
        "ZeroAddress"
      );
    });
  });

  describe("Reward logic", function () {
    const poolId = 1;
    const totalPledge = ethers.parseEther("1000");
    const rewardAmount = ethers.parseEther("100");
    const userPledge = ethers.parseEther("100");

    async function setupDistribution() {
      const { owner, riskManager, catPool, user, other, rd, token } = await deployFixture();
      await rd.connect(owner).setCatPool(catPool.address);
      await rd.connect(riskManager).distribute(poolId, token.target, rewardAmount, totalPledge);
      await rd.connect(riskManager).updateUserState(user.address, poolId, token.target, userPledge);
      await rd.connect(riskManager).distribute(poolId, token.target, rewardAmount, totalPledge);
      return { owner, riskManager, catPool, user, other, rd, token };
    }

    it("distribute updates accumulatedRewardsPerShare", async function () {
      const { riskManager, rd, token } = await deployFixture();
      await rd.connect(riskManager).distribute(poolId, token.target, rewardAmount, totalPledge);
      const tracker = await rd.poolRewardTrackers(poolId, token.target);
      const expected = (rewardAmount * PRECISION) / totalPledge;
      expect(tracker).to.equal(expected);
    });

    it("distribute accumulates over multiple calls", async function () {
      const { riskManager, rd, token } = await deployFixture();
      await rd.connect(riskManager).distribute(poolId, token.target, rewardAmount, totalPledge);
      await rd
        .connect(riskManager)
        .distribute(poolId, token.target, rewardAmount / 2n, totalPledge);
      const tracker = await rd.poolRewardTrackers(poolId, token.target);
      const expected = ((rewardAmount + rewardAmount / 2n) * PRECISION) / totalPledge;
      expect(tracker).to.equal(expected);
    });

    it("distribute ignores zero values", async function () {
      const { riskManager, rd, token } = await deployFixture();
      await rd.connect(riskManager).distribute(poolId, token.target, rewardAmount, totalPledge);
      const before = await rd.poolRewardTrackers(poolId, token.target);
      await rd.connect(riskManager).distribute(poolId, token.target, 0, totalPledge);
      await rd.connect(riskManager).distribute(poolId, token.target, rewardAmount, 0);
      const after = await rd.poolRewardTrackers(poolId, token.target);
      expect(after).to.equal(before);
    });

    it("only risk manager can distribute", async function () {
      const { rd, token, other } = await deployFixture();
      await expect(
        rd.connect(other).distribute(poolId, token.target, rewardAmount, totalPledge)
      ).to.be.revertedWith("RD: Not RiskManager");
    });

    it("claim pays out rewards and updates state", async function () {
      const { riskManager, user, rd, token } = await setupDistribution();
      const pending = await rd.pendingRewards(user.address, poolId, token.target, userPledge);
      const beforeBal = await token.balanceOf(user.address);
      const claimed = await rd
        .connect(riskManager)
        .getFunction("claim")
        .staticCall(user.address, poolId, token.target, userPledge);
      await rd
        .connect(riskManager)
        .claim(user.address, poolId, token.target, userPledge);
      const afterBal = await token.balanceOf(user.address);
      const userDebt = await rd.userRewardStates(user.address, poolId, token.target);
      const tracker = await rd.poolRewardTrackers(poolId, token.target);
      expect(afterBal - beforeBal).to.equal(pending);
      expect(userDebt).to.equal((userPledge * tracker) / PRECISION);
      expect(claimed).to.equal(pending);
    });

    it("claim returns zero when nothing pending", async function () {
      const { riskManager, user, rd, token } = await deployFixture();
      await rd.connect(riskManager).updateUserState(user.address, poolId, token.target, userPledge);
      await expect(rd.connect(riskManager).claim(user.address, poolId, token.target, userPledge)).to.not.be
        .reverted;
      expect(await token.balanceOf(user.address)).to.equal(0);
    });

    it("only risk manager can call claim", async function () {
      const { rd, user, token, other } = await deployFixture();
      await expect(
        rd.connect(other).claim(user.address, poolId, token.target, userPledge)
      ).to.be.revertedWith("RD: Not RiskManager");
    });

    it("claimForCatPool can be called by catPool", async function () {
      const { catPool, user, rd, token, riskManager } = await setupDistribution();
      const pending = await rd.pendingRewards(user.address, poolId, token.target, userPledge);
      const beforeBal = await token.balanceOf(user.address);
      await rd.connect(catPool).claimForCatPool(user.address, poolId, token.target, userPledge);
      const afterBal = await token.balanceOf(user.address);
      expect(afterBal - beforeBal).to.equal(pending);
      const tracker = await rd.poolRewardTrackers(poolId, token.target);
      const userDebt = await rd.userRewardStates(user.address, poolId, token.target);
      expect(userDebt).to.equal((userPledge * tracker) / PRECISION);
    });

    it("reverts if non-catPool calls claimForCatPool", async function () {
      const { rd, user, token, other } = await setupDistribution();
      await expect(
        rd.connect(other).claimForCatPool(user.address, poolId, token.target, userPledge)
      ).to.be.revertedWith("RD: Not CatPool");
    });

    it("reverts if catPool is not set", async function () {
      const { catPool, user, rd, token } = await deployFixture();
      await expect(
        rd.connect(catPool).claimForCatPool(user.address, poolId, token.target, userPledge)
      ).to.be.revertedWith("RD: Not CatPool");
    });

    it("claimForCatPool returns zero when nothing pending", async function () {
      const { owner, catPool, user, rd, token } = await deployFixture();
      await rd.connect(owner).setCatPool(catPool.address);
      await expect(
        rd.connect(catPool).claimForCatPool(user.address, poolId, token.target, userPledge)
      ).to.not.be.reverted;
      expect(await token.balanceOf(user.address)).to.equal(0);
    });

    it("updateUserState only risk manager", async function () {
      const { rd, token, other } = await deployFixture();
      await expect(
        rd.connect(other).updateUserState(other.address, poolId, token.target, userPledge)
      ).to.be.revertedWith("RD: Not RiskManager");
    });

    it("updateUserState records reward debt", async function () {
      const { riskManager, user, rd, token } = await setupDistribution();
      const tracker = await rd.poolRewardTrackers(poolId, token.target);
      await rd
        .connect(riskManager)
        .updateUserState(user.address, poolId, token.target, userPledge);
      const userDebt = await rd.userRewardStates(user.address, poolId, token.target);
      expect(userDebt).to.equal((userPledge * tracker) / PRECISION);
    });

    it("pendingRewards returns correct amount", async function () {
      const { user, rd, token } = await setupDistribution();
      const pending = await rd.pendingRewards(user.address, poolId, token.target, userPledge);
      expect(pending).to.equal(ethers.parseEther("10"));
    });

    it("handles multiple tokens independently", async function () {
      const { user, rd, token, riskManager } = await setupDistribution();
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token2 = await MockERC20.deploy("Reward2", "RW2", 18);
      await token2.mint(rd.target, ethers.parseEther("1000"));
      await rd
        .connect(riskManager)
        .distribute(poolId, token2.target, rewardAmount, totalPledge);
      await rd
        .connect(riskManager)
        .updateUserState(user.address, poolId, token2.target, userPledge);
      await rd
        .connect(riskManager)
        .distribute(poolId, token2.target, rewardAmount, totalPledge);
      const pending1 = await rd.pendingRewards(user.address, poolId, token.target, userPledge);
      const pending2 = await rd.pendingRewards(user.address, poolId, token2.target, userPledge);
      expect(pending1).to.equal(ethers.parseEther("10"));
      expect(pending2).to.equal(ethers.parseEther("10"));
    });

    it("pendingRewards is zero after claim", async function () {
      const { riskManager, user, rd, token } = await setupDistribution();
      await rd.connect(riskManager).claim(user.address, poolId, token.target, userPledge);
      const pending = await rd.pendingRewards(user.address, poolId, token.target, userPledge);
      expect(pending).to.equal(0n);
    });

    it("new risk manager controls privileged functions", async function () {
      const { owner, riskManager, other, rd, token } = await deployFixture();
      await rd.connect(owner).setRiskManager(other.address);
      await expect(
        rd.connect(riskManager).distribute(poolId, token.target, rewardAmount, totalPledge)
      ).to.be.revertedWith("RD: Not RiskManager");
      await expect(
        rd.connect(other).distribute(poolId, token.target, rewardAmount, totalPledge)
      ).to.not.be.reverted;
    });

    it("tracks rewards independently per pool", async function () {
      const otherPool = 2;
      const { owner, riskManager, catPool, user, rd, token } = await deployFixture();
      await rd.connect(owner).setCatPool(catPool.address);
      const userPledge2 = ethers.parseEther("50");

      await rd.connect(riskManager).distribute(poolId, token.target, rewardAmount, totalPledge);
      await rd.connect(riskManager).updateUserState(user.address, poolId, token.target, userPledge);
      await rd.connect(riskManager).distribute(poolId, token.target, rewardAmount, totalPledge);

      await rd.connect(riskManager).distribute(otherPool, token.target, rewardAmount, totalPledge);
      await rd
        .connect(riskManager)
        .updateUserState(user.address, otherPool, token.target, userPledge2);
      await rd.connect(riskManager).distribute(otherPool, token.target, rewardAmount, totalPledge);

      const pending1 = await rd.pendingRewards(user.address, poolId, token.target, userPledge);
      const pending2 = await rd.pendingRewards(user.address, otherPool, token.target, userPledge2);
      expect(pending1).to.equal(ethers.parseEther("10"));
      expect(pending2).to.equal(ethers.parseEther("5"));
    });

    it("handles fractional reward calculations", async function () {
      const { owner, riskManager, catPool, user, rd, token } = await deployFixture();
      await rd.connect(owner).setCatPool(catPool.address);

      await rd.connect(riskManager).distribute(poolId, token.target, 1, 2);
      await rd.connect(riskManager).updateUserState(user.address, poolId, token.target, 1);
      await rd.connect(riskManager).distribute(poolId, token.target, 1, 2);

      const pending = await rd.pendingRewards(user.address, poolId, token.target, 1);
      expect(pending).to.equal(1);
    });

    it("new catPool takes over claimForCatPool", async function () {
      const { owner, riskManager, catPool, user, rd, token, other } = await setupDistribution();
      await rd.connect(owner).setCatPool(other.address);
      await expect(
        rd.connect(catPool).claimForCatPool(user.address, poolId, token.target, userPledge)
      ).to.be.revertedWith("RD: Not CatPool");
      await expect(
        rd.connect(other).claimForCatPool(user.address, poolId, token.target, userPledge)
      ).to.not.be.reverted;
    });
  });
});
