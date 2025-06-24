const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PolicyManager Integration", function () {
  let owner, user;
  let usdc, poolRegistry, capitalPool, catPool, rewardDistributor, riskManager;
  let policyNFT, policyManager;

  const POOL_ID = 0;
  const COVERAGE = ethers.parseUnits("10000", 6);
  const PREMIUM = ethers.parseUnits("100", 6);
  const RATE_MODEL = { base: 100, slope1: 0, slope2: 0, kink: 8000 };
  const SECS_YEAR = 365 * 24 * 60 * 60;
  const BPS = 10000;

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

    const MockPoolRegistry = await ethers.getContractFactory("MockPoolRegistry");
    poolRegistry = await MockPoolRegistry.deploy();
    await poolRegistry.setPoolCount(1);
    await poolRegistry.setPoolData(
      POOL_ID,
      usdc.target,
      ethers.parseUnits("100000", 6),
      0,
      0,
      false,
      owner.address,
      0
    );
    await poolRegistry.setRateModel(POOL_ID, RATE_MODEL);

    const MockCapitalPool = await ethers.getContractFactory("MockCapitalPool");
    capitalPool = await MockCapitalPool.deploy(owner.address, usdc.target);

    const CatShare = await ethers.getContractFactory("CatShare");
    const catShare = await CatShare.deploy();

    const MockYieldAdapter = await ethers.getContractFactory("MockYieldAdapter");
    const adapter = await MockYieldAdapter.deploy(usdc.target, ethers.ZeroAddress, owner.address);

    const CatPool = await ethers.getContractFactory("CatInsurancePool");
    catPool = await CatPool.deploy(usdc.target, catShare.target, adapter.target, owner.address);
    await catShare.transferOwnership(catPool.target);
    await catPool.initialize();

    const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
    rewardDistributor = await RewardDistributor.deploy(owner.address);
    await rewardDistributor.setCatPool(catPool.target);

    const MockRiskManagerHook = await ethers.getContractFactory("MockRiskManagerHook");
    riskManager = await MockRiskManagerHook.deploy();

    const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
    policyNFT = await PolicyNFT.deploy(ethers.ZeroAddress, owner.address);

    const PolicyManager = await ethers.getContractFactory("PolicyManager");
    policyManager = await PolicyManager.deploy(policyNFT.target, owner.address);

    await policyNFT.setPolicyManagerAddress(policyManager.target);
    await catPool.setPolicyManagerAddress(policyManager.target);
    await catPool.setCapitalPoolAddress(capitalPool.target);
    await catPool.setRiskManagerAddress(riskManager.target);
    await catPool.setRewardDistributor(rewardDistributor.target);
    await rewardDistributor.setRiskManager(policyManager.target);

    await policyManager.setAddresses(
      poolRegistry.target,
      capitalPool.target,
      catPool.target,
      rewardDistributor.target,
      riskManager.target
    );

    await usdc.mint(user.address, ethers.parseUnits("1000", 6));
    await usdc.connect(user).approve(policyManager.target, ethers.MaxUint256);
  });

  it("purchases cover and mints a policy", async function () {
    const tx = await policyManager.connect(user).purchaseCover(POOL_ID, COVERAGE, PREMIUM);
    await expect(tx)
      .to.emit(riskManager, "CoverageUpdated")
      .withArgs(POOL_ID, COVERAGE, true);
    expect(await policyNFT.nextId()).to.equal(2);
  });

  it("distributes premium on cancellation", async function () {
    await policyManager.connect(user).purchaseCover(POOL_ID, COVERAGE, PREMIUM);

    await time.increase(30 * 24 * 60 * 60);

    const catBefore = await catPool.idleUSDC();
    const trackerBefore = await rewardDistributor.poolRewardTrackers(POOL_ID, usdc.target);
    const userBalBefore = await usdc.balanceOf(user.address);

    await policyManager.connect(user).cancelCover(1);

    const catAfter = await catPool.idleUSDC();
    const trackerAfter = await rewardDistributor.poolRewardTrackers(POOL_ID, usdc.target);
    const userBalAfter = await usdc.balanceOf(user.address);

    expect(catAfter).to.be.gt(catBefore);
    expect(trackerAfter).to.be.gt(trackerBefore);
    expect(userBalAfter).to.be.gt(userBalBefore);
  });

  it("drains accrued premium when adding more", async function () {
    await policyManager.connect(user).purchaseCover(POOL_ID, COVERAGE, PREMIUM);

    await time.increase(30 * 24 * 60 * 60);

    const infoBefore = await policyNFT.getPolicy(1);
    const catBefore = await catPool.idleUSDC();
    const trackerBefore = await rewardDistributor.poolRewardTrackers(POOL_ID, usdc.target);

    const ADDITIONAL = ethers.parseUnits("50", 6);
    await policyManager.connect(user).addPremium(1, ADDITIONAL);

    const infoAfter = await policyNFT.getPolicy(1);
    const catAfter = await catPool.idleUSDC();
    const trackerAfter = await rewardDistributor.poolRewardTrackers(POOL_ID, usdc.target);

    expect(infoAfter.premiumDeposit).to.be.lt(infoBefore.premiumDeposit + ADDITIONAL);
    expect(infoAfter.lastDrainTime).to.be.gt(infoBefore.lastDrainTime);
    expect(catAfter).to.be.gt(catBefore);
    expect(trackerAfter).to.be.gt(trackerBefore);
  });

  it("finalizes coverage increase after cooldown", async function () {
    await policyManager.connect(owner).setCoverCooldownPeriod(24 * 60 * 60);
    await policyManager.connect(user).purchaseCover(POOL_ID, COVERAGE, PREMIUM);

    const ADD_COVER = ethers.parseUnits("5000", 6);
    await expect(policyManager.connect(user).increaseCover(1, ADD_COVER))
      .to.emit(riskManager, "CoverageUpdated")
      .withArgs(POOL_ID, ADD_COVER, true);

    await time.increase(24 * 60 * 60 + 1);
    await policyManager.connect(user).addPremium(1, ethers.parseUnits("1", 6));

    const info = await policyNFT.getPolicy(1);
    expect(info.coverage).to.equal(COVERAGE + ADD_COVER);
    expect(info.pendingIncrease).to.equal(0);
  });

  it("lapses policy when premium is exhausted", async function () {
    await policyManager.connect(user).purchaseCover(POOL_ID, COVERAGE, PREMIUM);

    await time.increase(SECS_YEAR * 2);

    await expect(policyManager.connect(user).lapsePolicy(1))
      .to.emit(riskManager, "CoverageUpdated")
      .withArgs(POOL_ID, COVERAGE, false);

    await expect(policyNFT.ownerOf(1)).to.be.revertedWithCustomError(policyNFT, "ERC721NonexistentToken");
  });
});