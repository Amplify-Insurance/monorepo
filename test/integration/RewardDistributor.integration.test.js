const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const POOL_ID = 0;
const PLEDGE_AMOUNT = ethers.parseUnits("1000", 6);
const REWARD_AMOUNT = ethers.parseUnits("100", 6);

async function deployFixture() {
  const [owner, committee, underwriter] = await ethers.getSigners();

  // --- Deploy tokens and adapter ---
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

  const MockYieldAdapter = await ethers.getContractFactory("MockYieldAdapter");
  const adapter = await MockYieldAdapter.deploy(usdc.target, ethers.ZeroAddress, owner.address);

  // --- Deploy core protocol contracts ---
  const CatShare = await ethers.getContractFactory("CatShare");
  const catShare = await CatShare.deploy();

  const CapitalPool = await ethers.getContractFactory("CapitalPool");
  const capitalPool = await CapitalPool.deploy(owner.address, usdc.target);
  await capitalPool.setBaseYieldAdapter(1, adapter.target);

  const CatPool = await ethers.getContractFactory("CatInsurancePool");
  const catPool = await CatPool.deploy(usdc.target, catShare.target, adapter.target, owner.address);
  await catShare.transferOwnership(catPool.target);
  await catPool.initialize();
  await adapter.setDepositor(capitalPool.target);

  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  const policyNFT = await PolicyNFT.deploy(ethers.ZeroAddress, owner.address);

  const PolicyManager = await ethers.getContractFactory("PolicyManager");
  const policyManager = await PolicyManager.deploy(policyNFT.target, owner.address);
  await policyNFT.setPolicyManagerAddress(policyManager.target);

  const RiskManager = await ethers.getContractFactory("RiskManager");
  const riskManager = await RiskManager.deploy(owner.address);

  await capitalPool.setRiskManager(riskManager.target);

  const PoolRegistry = await ethers.getContractFactory("PoolRegistry");
  const poolRegistry = await PoolRegistry.deploy(owner.address, riskManager.target);

  const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
  const rewardDistributor = await RewardDistributor.deploy(riskManager.target);
  await rewardDistributor.setCatPool(catPool.target);

  const LossDistributor = await ethers.getContractFactory("LossDistributor");
  const lossDistributor = await LossDistributor.deploy(riskManager.target);

  // Configure protocol relationships
  await riskManager.setAddresses(
    capitalPool.target,
    poolRegistry.target,
    policyManager.target,
    catPool.target,
    lossDistributor.target,
    rewardDistributor.target
  );
  await riskManager.setCommittee(committee.address);

  await policyManager.setAddresses(
    poolRegistry.target,
    capitalPool.target,
    catPool.target,
    rewardDistributor.target,
    riskManager.target
  );

  await catPool.setRiskManagerAddress(riskManager.target);
  await catPool.setPolicyManagerAddress(policyManager.target);
  await catPool.setCapitalPoolAddress(capitalPool.target);
  await catPool.setRewardDistributor(rewardDistributor.target);

  // Create a pool
  const rate = { base: 100, slope1: 0, slope2: 0, kink: 8000 };
  await riskManager.addProtocolRiskPool(usdc.target, rate, 0);

  // Initial deposit & allocation
  await usdc.mint(underwriter.address, PLEDGE_AMOUNT);
  await usdc.connect(underwriter).approve(capitalPool.target, PLEDGE_AMOUNT);
  await capitalPool.connect(underwriter).deposit(PLEDGE_AMOUNT, 1);
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
    adapterAddress: adapter.target,
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
      adapterAddress,
    } = await loadFixture(deployFixture);

    let [, totalPledged] = await poolRegistry.getPoolData(POOL_ID);
    let rm = await impersonate(riskManager.target);
    await rewardDistributor.connect(rm).distribute(POOL_ID, usdc.target, REWARD_AMOUNT, totalPledged);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);
    await riskManager.connect(underwriter).claimPremiumRewards(POOL_ID);

    const extra = ethers.parseUnits("500", 6);
    await usdc.mint(underwriter.address, extra);
    await usdc.connect(underwriter).approve(capitalPool.target, extra);
    await capitalPool.connect(underwriter).deposit(extra, 1);
    const rm2 = await impersonate(riskManager.target);
    await poolRegistry.connect(rm2).updateCapitalAllocation(POOL_ID, adapterAddress, extra, true);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);

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

  it("accrues rewards after withdrawal", async function () {
    const {
      owner,
      riskManager,
      rewardDistributor,
      poolRegistry,
      capitalPool,
      usdc,
      underwriter,
      adapterAddress,
    } = await loadFixture(deployFixture);

    let [, totalPledged] = await poolRegistry.getPoolData(POOL_ID);
    let rm = await impersonate(riskManager.target);
    await rewardDistributor
      .connect(rm)
      .distribute(POOL_ID, usdc.target, REWARD_AMOUNT, totalPledged);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [
      riskManager.target,
    ]);
    await riskManager.connect(underwriter).claimPremiumRewards(POOL_ID);

    const withdraw = ethers.parseUnits("400", 6);
    const cpSigner = await impersonate(capitalPool.target);
    await riskManager
      .connect(cpSigner)
      .onCapitalWithdrawn(underwriter.address, withdraw, false);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [capitalPool.target]);
    const rm2 = await impersonate(riskManager.target);
    await poolRegistry.connect(rm2).updateCapitalAllocation(POOL_ID, adapterAddress, withdraw, false);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);

    [, totalPledged] = await poolRegistry.getPoolData(POOL_ID);
    rm = await impersonate(riskManager.target);
    await rewardDistributor
      .connect(rm)
      .distribute(POOL_ID, usdc.target, REWARD_AMOUNT, totalPledged);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [
      riskManager.target,
    ]);

    const pledgeNow = await riskManager.underwriterPoolPledge(
      underwriter.address,
      POOL_ID
    );
    const expected = await rewardDistributor.pendingRewards(
      underwriter.address,
      POOL_ID,
      usdc.target,
      pledgeNow
    );
    const before = await usdc.balanceOf(underwriter.address);
    await riskManager.connect(underwriter).claimPremiumRewards(POOL_ID);
    const after = await usdc.balanceOf(underwriter.address);
    expect(after - before).to.equal(expected);
  });

  it("allows catPool to claim rewards for user", async function () {
    const {
      rewardDistributor,
      poolRegistry,
      riskManager,
      catPool,
      usdc,
      underwriter,
    } = await loadFixture(deployFixture);

    const [, totalPledged] = await poolRegistry.getPoolData(POOL_ID);
    const rm = await impersonate(riskManager.target);
    await rewardDistributor
      .connect(rm)
      .distribute(POOL_ID, usdc.target, REWARD_AMOUNT, totalPledged);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [
      riskManager.target,
    ]);

    const pledgeNow = await riskManager.underwriterPoolPledge(
      underwriter.address,
      POOL_ID
    );
    const expected = await rewardDistributor.pendingRewards(
      underwriter.address,
      POOL_ID,
      usdc.target,
      pledgeNow
    );

    const cp = await impersonate(catPool.target);
    await rewardDistributor
      .connect(cp)
      .claimForCatPool(underwriter.address, POOL_ID, usdc.target, pledgeNow);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [
      catPool.target,
    ]);

    expect(await usdc.balanceOf(underwriter.address)).to.equal(expected);
  });
});
