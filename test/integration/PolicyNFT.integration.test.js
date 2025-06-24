const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

async function deployFixture() {
  const [owner, user] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD", "USD", 6);

  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  const policyNFT = await PolicyNFT.deploy(ethers.ZeroAddress, owner.address);

  const PolicyManager = await ethers.getContractFactory("PolicyManager");
  const policyManager = await PolicyManager.deploy(policyNFT.target, owner.address);

  // allow PolicyManager to manage PolicyNFT
  await policyNFT.setPolicyManagerAddress(policyManager.target);

  const MockPoolRegistry = await ethers.getContractFactory("MockPoolRegistry");
  const poolRegistry = await MockPoolRegistry.deploy();
  const MockCapitalPool = await ethers.getContractFactory("MockCapitalPool");
  const capitalPool = await MockCapitalPool.deploy(owner.address, usdc.target);
  const MockCatInsurancePool = await ethers.getContractFactory("MockCatInsurancePool");
  const catPool = await MockCatInsurancePool.deploy(owner.address);
  const MockRewardDistributor = await ethers.getContractFactory("MockRewardDistributor");
  const rewardDistributor = await MockRewardDistributor.deploy();
  const MockRiskManager = await ethers.getContractFactory("MockRiskManagerHook");
  const riskManager = await MockRiskManager.deploy();

  await policyManager.setAddresses(
    poolRegistry.target,
    capitalPool.target,
    catPool.target,
    rewardDistributor.target,
    riskManager.target
  );

  // simple pool setup with zero premium rate
  await poolRegistry.setPoolCount(1);
  await poolRegistry.setPoolData(
    0,
    usdc.target,
    ethers.parseUnits("100000", 6),
    0,
    0,
    false,
    owner.address,
    0
  );
  await poolRegistry.setRateModel(0, { base: 0, slope1: 0, slope2: 0, kink: 8000 });

  // fund user and approve
  await usdc.mint(user.address, ethers.parseUnits("1000", 6));
  await usdc.connect(user).approve(policyManager.target, ethers.MaxUint256);

  return { owner, user, usdc, policyNFT, policyManager };
}

describe("PolicyNFT integration via PolicyManager", function () {
  it("emits event when manager address updated", async function () {
    const { owner, policyNFT, policyManager } = await loadFixture(deployFixture);

    await expect(
      policyNFT.connect(owner).setPolicyManagerAddress(owner.address)
    )
      .to.emit(policyNFT, "PolicyManagerAddressSet")
      .withArgs(owner.address);

    expect(await policyNFT.policyManagerContract()).to.equal(owner.address);

    // set back for subsequent operations
    await policyNFT.setPolicyManagerAddress(policyManager.target);
  });
  it("mints a policy when purchasing cover", async function () {
    const { user, policyManager, policyNFT } = await loadFixture(deployFixture);
    const coverage = ethers.parseUnits("500", 6);
    const premium = ethers.parseUnits("100", 6);

    await expect(policyManager.connect(user).purchaseCover(0, coverage, premium))
      .to.emit(policyNFT, "Transfer")
      .withArgs(ethers.ZeroAddress, user.address, 1n);

    const pol = await policyNFT.getPolicy(1);
    expect(pol.coverage).to.equal(coverage);
    expect(pol.poolId).to.equal(0);
  });

  it("updates premium deposit via addPremium", async function () {
    const { user, policyManager, policyNFT } = await loadFixture(deployFixture);
    const coverage = ethers.parseUnits("500", 6);
    const premium = ethers.parseUnits("100", 6);

    await policyManager.connect(user).purchaseCover(0, coverage, premium);

    const extra = ethers.parseUnits("20", 6);
    await expect(policyManager.connect(user).addPremium(1, extra))
      .to.emit(policyNFT, "PolicyPremiumAccountUpdated")
      .withArgs(1n, premium + extra, anyValue);

    const pol = await policyNFT.getPolicy(1);
    expect(pol.premiumDeposit).to.equal(premium + extra);
  });

  it("handles coverage increase and finalization", async function () {
    const { user, policyManager, policyNFT } = await loadFixture(deployFixture);
    const coverage = ethers.parseUnits("500", 6);
    const premium = ethers.parseUnits("100", 6);

    await policyManager.connect(user).purchaseCover(0, coverage, premium);

    const inc = ethers.parseUnits("200", 6);
    await expect(policyManager.connect(user).increaseCover(1, inc))
      .to.emit(policyNFT, "PendingIncreaseAdded")
      .withArgs(1n, inc, anyValue);

    let pol = await policyNFT.getPolicy(1);
    expect(pol.pendingIncrease).to.equal(inc);
    const activation = pol.increaseActivationTimestamp;

    await time.increaseTo(activation + 1n);
    const extra = ethers.parseUnits("5", 6);
    await expect(policyManager.connect(user).addPremium(1, extra))
      .to.emit(policyNFT, "PolicyCoverageIncreased")
      .withArgs(1n, coverage + inc);

    pol = await policyNFT.getPolicy(1);
    expect(pol.coverage).to.equal(coverage + inc);
    expect(pol.pendingIncrease).to.equal(0);
  });

  it("burns the policy when canceled", async function () {
    const { user, policyManager, policyNFT } = await loadFixture(deployFixture);
    const coverage = ethers.parseUnits("500", 6);
    const premium = ethers.parseUnits("100", 6);

    await policyManager.connect(user).purchaseCover(0, coverage, premium);
    await time.increase(1);

    await policyManager.connect(user).cancelCover(1);
    await expect(policyNFT.ownerOf(1)).to.be.reverted;
  });
});