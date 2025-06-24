const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

async function deployFixture() {
  const [owner, user] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD", "USD", 6);

  const CatShare = await ethers.getContractFactory("CatShare");
  const catShare = await CatShare.deploy();

  const YieldAdapter = await ethers.getContractFactory("MockYieldAdapter");
  const adapter = await YieldAdapter.deploy(usdc.target, ethers.ZeroAddress, owner.address);

  const CapitalPool = await ethers.getContractFactory("CapitalPool");
  const capitalPool = await CapitalPool.deploy(owner.address, usdc.target);
  await adapter.setDepositor(capitalPool.target);
  await capitalPool.setBaseYieldAdapter(3, adapter.target); // OTHER_YIELD

  const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
  const rewardDistributor = await RewardDistributor.deploy(owner.address);

  const CatPool = await ethers.getContractFactory("CatInsurancePool");
  const catPool = await CatPool.deploy(usdc.target, catShare.target, ethers.ZeroAddress, owner.address);
  await catShare.transferOwnership(catPool.target);
  await catPool.initialize();
  await rewardDistributor.setCatPool(catPool.target);

  const LossDistributor = await ethers.getContractFactory("LossDistributor");
  const lossDistributor = await LossDistributor.deploy(owner.address);

  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  const policyNFT = await PolicyNFT.deploy(ethers.ZeroAddress, owner.address);

  const PolicyManager = await ethers.getContractFactory("PolicyManager");
  const policyManager = await PolicyManager.deploy(policyNFT.target, owner.address);

  const RiskManager = await ethers.getContractFactory("RiskManager");
  const riskManager = await RiskManager.deploy(owner.address);

  const PoolRegistry = await ethers.getContractFactory("PoolRegistry");
  const poolRegistry = await PoolRegistry.deploy(owner.address, riskManager.target);

  await policyNFT.setPolicyManagerAddress(policyManager.target);

  await capitalPool.setRiskManager(riskManager.target);
  await catPool.setPolicyManagerAddress(policyManager.target);
  await catPool.setCapitalPoolAddress(capitalPool.target);
  await catPool.setRiskManagerAddress(riskManager.target);
  await catPool.setRewardDistributor(rewardDistributor.target);
  await rewardDistributor.setRiskManager(policyManager.target);
  await lossDistributor.setRiskManager(riskManager.target);

  await policyManager.setAddresses(
    poolRegistry.target,
    capitalPool.target,
    catPool.target,
    rewardDistributor.target,
    riskManager.target
  );

  await riskManager.setAddresses(
    capitalPool.target,
    poolRegistry.target,
    policyManager.target,
    catPool.target,
    lossDistributor.target,
    rewardDistributor.target
  );

  // create pool and allocate some capital
  const rate = { base: 0, slope1: 0, slope2: 0, kink: 8000 };
  await riskManager.addProtocolRiskPool(usdc.target, rate, 0);
  const pledge = ethers.parseUnits("100000", 6);
  await usdc.mint(owner.address, pledge);
  await usdc.approve(capitalPool.target, pledge);
  await capitalPool.deposit(pledge, 3);
  await riskManager.allocateCapital([0]);

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