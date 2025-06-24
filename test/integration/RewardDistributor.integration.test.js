const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const POOL_ID = 0;
const PLEDGE_AMOUNT = ethers.parseUnits("1000", 6);
const REWARD_AMOUNT = ethers.parseUnits("100", 6);

async function deployFixture() {
  const [owner, committee, underwriter, adapter] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

  const MockPoolRegistry = await ethers.getContractFactory("MockPoolRegistry");
  const poolRegistry = await MockPoolRegistry.deploy();
  await poolRegistry.setPoolCount(1);
  await poolRegistry.connect(owner).setPoolData(
    POOL_ID,
    usdc.target,
    0,
    0,
    0,
    false,
    committee.address,
    0
  );

  const MockCapitalPool = await ethers.getContractFactory("MockCapitalPool");
  const capitalPool = await MockCapitalPool.deploy(owner.address, usdc.target);

  const MockPolicyNFT = await ethers.getContractFactory("MockPolicyNFT");
  const policyNFT = await MockPolicyNFT.deploy(owner.address);
  await policyNFT.setRiskManagerAddress(owner.address);

  const MockPolicyManager = await ethers.getContractFactory("MockPolicyManager");
  const policyManager = await MockPolicyManager.deploy();
  await policyManager.setPolicyNFT(policyNFT.target);

  const MockCatPool = await ethers.getContractFactory("MockCatInsurancePool");
  const catPool = await MockCatPool.deploy(owner.address);

  const RiskManager = await ethers.getContractFactory("RiskManager");
  const riskManager = await RiskManager.deploy(owner.address);

  const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
  const rewardDistributor = await RewardDistributor.deploy(riskManager.target);
  await rewardDistributor.setCatPool(catPool.target);

  const LossDistributor = await ethers.getContractFactory("LossDistributor");
  const lossDistributor = await LossDistributor.deploy(riskManager.target);

  await riskManager.setAddresses(
    capitalPool.target,
    poolRegistry.target,
    policyManager.target,
    catPool.target,
    lossDistributor.target,
    rewardDistributor.target
  );
  await riskManager.setCommittee(committee.address);

  // initial deposit and allocation
  await capitalPool.triggerOnCapitalDeposited(
    riskManager.target,
    underwriter.address,
    PLEDGE_AMOUNT
  );
  await capitalPool.setUnderwriterAdapterAddress(underwriter.address, adapter.address);
  await riskManager.connect(underwriter).allocateCapital([POOL_ID]);

  // fund distributor
  await usdc.mint(rewardDistributor.target, ethers.parseUnits("1000", 6));

  return {
    owner,
    committee,
    underwriter,
    adapter,
    usdc,
    poolRegistry,
    capitalPool,
    policyNFT,
    policyManager,
    catPool,
    riskManager,
    rewardDistributor,
  };
}

async function impersonate(address) {
  await ethers.provider.send("hardhat_impersonateAccount", [address]);
  await ethers.provider.send("hardhat_setBalance", [address, "0x1000000000000000000"]);
  return await ethers.getSigner(address);
}

describe("RewardDistributor Integration", function () {
  it("allows underwriter to claim distributed rewards via RiskManager", async function () {
    const { riskManager, rewardDistributor, poolRegistry, usdc, underwriter } = await loadFixture(deployFixture);

    const [, totalPledged] = await poolRegistry.getPoolData(POOL_ID);
    const rm = await impersonate(riskManager.target);
    await rewardDistributor.connect(rm).distribute(POOL_ID, usdc.target, REWARD_AMOUNT, totalPledged);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);

    const pledgeNow = await riskManager.underwriterPoolPledge(underwriter.address, POOL_ID);
    const expected = await rewardDistributor.pendingRewards(underwriter.address, POOL_ID, usdc.target, pledgeNow);
    const before = await usdc.balanceOf(underwriter.address);
    await riskManager.connect(underwriter).claimPremiumRewards(POOL_ID);
    const after = await usdc.balanceOf(underwriter.address);
    expect(after - before).to.equal(expected);
  });

  it("accrues rewards after additional deposit", async function () {
    const {
      owner,
      riskManager,
      rewardDistributor,
      poolRegistry,
      capitalPool,
      usdc,
      underwriter,
      adapter,
    } = await loadFixture(deployFixture);

    let [, totalPledged] = await poolRegistry.getPoolData(POOL_ID);
    let rm = await impersonate(riskManager.target);
    await rewardDistributor.connect(rm).distribute(POOL_ID, usdc.target, REWARD_AMOUNT, totalPledged);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);
    await riskManager.connect(underwriter).claimPremiumRewards(POOL_ID);

    const extra = ethers.parseUnits("500", 6);
    await capitalPool.triggerOnCapitalDeposited(riskManager.target, underwriter.address, extra);
    await poolRegistry.connect(owner).setPoolData(
      POOL_ID,
      usdc.target,
      PLEDGE_AMOUNT + extra,
      0,
      0,
      false,
      owner.address,
      0
    );

    [, totalPledged] = await poolRegistry.getPoolData(POOL_ID);
    rm = await impersonate(riskManager.target);
    await rewardDistributor.connect(rm).distribute(POOL_ID, usdc.target, REWARD_AMOUNT, totalPledged);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);

    const pledgeNow = await riskManager.underwriterPoolPledge(underwriter.address, POOL_ID);
    const expected = await rewardDistributor.pendingRewards(underwriter.address, POOL_ID, usdc.target, pledgeNow);
    const before = await usdc.balanceOf(underwriter.address);
    await riskManager.connect(underwriter).claimPremiumRewards(POOL_ID);
    const after = await usdc.balanceOf(underwriter.address);
    expect(after - before).to.equal(expected);
  });
});
