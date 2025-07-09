const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const PRECISION = 10n ** 18n;
const PLATFORM = 1; // AAVE enum value

async function mintPolicy(riskManager, policyNFT, claimant, poolId, coverage) {
  await ethers.provider.send("hardhat_impersonateAccount", [riskManager.target]);
  await ethers.provider.send("hardhat_setBalance", [riskManager.target, "0x100000000000000000"]);
  const rmSigner = await ethers.getSigner(riskManager.target);
  const id = await policyNFT.nextId();
  await policyNFT.connect(rmSigner).mint(claimant.address, poolId, coverage, 0, 0, 0);
  await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);
  return id;
}

async function deployFixture() {
  const [owner, committee, underwriter, claimant, secondUnderwriter, nonParty] =
    await ethers.getSigners();

  const Token = await ethers.getContractFactory("ResetApproveERC20");
  const usdc = await Token.deploy("USD Coin", "USDC", 6);
  const protocolToken = await Token.deploy("Protocol", "PTKN", 6);

  const RiskManager = await ethers.getContractFactory("RiskManager");
  const riskManager = await RiskManager.deploy(owner.address);

  const Adapter = await ethers.getContractFactory("SimpleYieldAdapter");
  const adapter = await Adapter.deploy(usdc.target, ethers.ZeroAddress, owner.address);

  const CapitalPool = await ethers.getContractFactory("CapitalPool");
  const capitalPool = await CapitalPool.deploy(owner.address, usdc.target);
  await capitalPool.setBaseYieldAdapter(PLATFORM, adapter.target);
  await adapter.setDepositor(capitalPool.target);
  await capitalPool.setRiskManager(riskManager.target);

  const CatShare = await ethers.getContractFactory("CatShare");
  const catShare = await CatShare.deploy();

  const CatPool = await ethers.getContractFactory("BackstopPool");
  const catPool = await CatPool.deploy(usdc.target, catShare.target, adapter.target, owner.address);
  await catShare.transferOwnership(catPool.target);
  await catPool.initialize();
  await catPool.setRiskManagerAddress(riskManager.target);
  await catPool.setCapitalPoolAddress(capitalPool.target);

  const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
  const rewardDistributor = await RewardDistributor.deploy(riskManager.target);
  await rewardDistributor.setCatPool(catPool.target);

  const LossDistributor = await ethers.getContractFactory("LossDistributor");
  const lossDistributor = await LossDistributor.deploy(riskManager.target);

  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  const policyNFT = await PolicyNFT.deploy(riskManager.target, owner.address);

  const PolicyManager = await ethers.getContractFactory("PolicyManager");
  const policyManager = await PolicyManager.deploy(policyNFT.target, owner.address);

  const PoolRegistry = await ethers.getContractFactory("PoolRegistry");
  const poolRegistry = await PoolRegistry.deploy(owner.address, riskManager.target);

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
  await riskManager.setCommittee(committee.address);
  await poolRegistry.setRiskManager(riskManager.target);
  await catPool.setPolicyManagerAddress(policyManager.target);

  const rate = { base: 0, slope1: 0, slope2: 0, kink: 8000 };
  await riskManager.addProtocolRiskPool(protocolToken.target, rate, 500);
  const POOL_ID = 0;

  const TOTAL_PLEDGE = ethers.parseUnits("100000", 6);
  await usdc.mint(underwriter.address, TOTAL_PLEDGE);
  await usdc.connect(underwriter).approve(capitalPool.target, TOTAL_PLEDGE);
  await capitalPool.connect(underwriter).deposit(TOTAL_PLEDGE, PLATFORM);
  await riskManager.connect(underwriter).allocateCapital([POOL_ID]);

  await protocolToken.mint(claimant.address, ethers.parseUnits("100000", 6));
  await protocolToken.connect(claimant).approve(riskManager.target, ethers.MaxUint256);

  const COVERAGE = ethers.parseUnits("50000", 6);
  const POLICY_ID = await mintPolicy(riskManager, policyNFT, claimant, POOL_ID, COVERAGE);

  return {
    owner,
    committee,
    underwriter,
    claimant,
    secondUnderwriter,
    nonParty,
    usdc,
    protocolToken,
    capitalPool,
    adapter,
    riskManager,
    poolRegistry,
    policyNFT,
    policyManager,
    catPool,
    rewardDistributor,
    lossDistributor,
    POOL_ID,
    POLICY_ID,
    COVERAGE,
    TOTAL_PLEDGE,
  };
}

describe("LossDistributor Integration", function () {
  it("updates pool tracker when claim processed", async function () {
    const { riskManager, lossDistributor, POLICY_ID, POOL_ID, COVERAGE, TOTAL_PLEDGE, nonParty } =
      await loadFixture(deployFixture);

    await expect(riskManager.connect(nonParty).processClaim(POLICY_ID)).to.not.be.reverted;

    const expected = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
    expect(await lossDistributor.poolLossTrackers(POOL_ID)).to.equal(expected);
  });

  it("realizes losses on withdrawal", async function () {
    const { riskManager, capitalPool, underwriter, POLICY_ID, COVERAGE, nonParty } =
      await loadFixture(deployFixture);

    await riskManager.connect(nonParty).processClaim(POLICY_ID);
    const account = await capitalPool.getUnderwriterAccount(underwriter.address);
    await capitalPool.connect(underwriter).requestWithdrawal(account.masterShares);
    await time.increase(1);
    await expect(capitalPool.connect(underwriter).executeWithdrawal(0))
      .to.emit(capitalPool, "LossesApplied")
      .withArgs(underwriter.address, COVERAGE, true);
    expect(await riskManager.underwriterTotalPledge(underwriter.address)).to.equal(0);
  });

  it("accumulates loss for multiple claims", async function () {
    const { riskManager, lossDistributor, policyNFT, claimant, POOL_ID, COVERAGE, TOTAL_PLEDGE, nonParty } =
      await loadFixture(deployFixture);

    await riskManager.connect(nonParty).processClaim(1);

    const COVERAGE_2 = ethers.parseUnits("20000", 6);
    const policy2 = await mintPolicy(riskManager, policyNFT, claimant, POOL_ID, COVERAGE_2);
    await riskManager.connect(nonParty).processClaim(policy2);

    const expected = ((COVERAGE + COVERAGE_2) * PRECISION) / TOTAL_PLEDGE;
    expect(await lossDistributor.poolLossTrackers(POOL_ID)).to.equal(expected);
  });

  it("realizes proportional losses on partial withdrawal", async function () {
    const { riskManager, capitalPool, underwriter, POLICY_ID, COVERAGE, TOTAL_PLEDGE, nonParty } =
      await loadFixture(deployFixture);

    await riskManager.connect(nonParty).processClaim(POLICY_ID);
    const account = await capitalPool.getUnderwriterAccount(underwriter.address);
    const half = account.masterShares / 2n;
    await capitalPool.connect(underwriter).requestWithdrawal(half);
    await time.increase(1);
    await expect(capitalPool.connect(underwriter).executeWithdrawal(0))
      .to.emit(capitalPool, "LossesApplied")
      .withArgs(underwriter.address, COVERAGE, true);
    expect(await riskManager.underwriterTotalPledge(underwriter.address)).to.equal(0);
    expect(await riskManager.isAllocatedToPool(underwriter.address, POOL_ID)).to.equal(false);
  });

  async function deployTwoPoolFixture() {
    const base = await deployFixture();
    const rate = { base: 0, slope1: 0, slope2: 0, kink: 8000 };
    await base.riskManager.addProtocolRiskPool(base.protocolToken.target, rate, 500);
    const SECOND_POOL_ID = 1;
    await base.riskManager.connect(base.underwriter).allocateCapital([SECOND_POOL_ID]);

    const COVERAGE_2 = ethers.parseUnits("30000", 6);
    const POLICY_ID_2 = await mintPolicy(base.riskManager, base.policyNFT, base.claimant, SECOND_POOL_ID, COVERAGE_2);

    return { ...base, SECOND_POOL_ID, POLICY_ID_2, COVERAGE_2 };
  }

  it("tracks losses independently per pool", async function () {
    const {
      riskManager,
      lossDistributor,
      nonParty,
      POOL_ID,
      POLICY_ID,
      COVERAGE,
      TOTAL_PLEDGE,
      SECOND_POOL_ID,
      POLICY_ID_2,
      COVERAGE_2,
    } = await loadFixture(deployTwoPoolFixture);

    await riskManager.connect(nonParty).processClaim(POLICY_ID);
    await riskManager.connect(nonParty).processClaim(POLICY_ID_2);

    const expected1 = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
    const expected2 = (COVERAGE_2 * PRECISION) / TOTAL_PLEDGE;

    expect(await lossDistributor.poolLossTrackers(POOL_ID)).to.equal(expected1);
    expect(await lossDistributor.poolLossTrackers(SECOND_POOL_ID)).to.equal(expected2);
  });

  async function deployTwoUnderwriterFixture() {
    const base = await deployFixture();
    const SECOND_PLEDGE = ethers.parseUnits("50000", 6);
    await base.usdc.mint(base.secondUnderwriter.address, SECOND_PLEDGE);
    await base.usdc.connect(base.secondUnderwriter).approve(base.capitalPool.target, SECOND_PLEDGE);
    await base.capitalPool.connect(base.secondUnderwriter).deposit(SECOND_PLEDGE, PLATFORM);
    await base.riskManager.connect(base.secondUnderwriter).allocateCapital([base.POOL_ID]);
    const total = base.TOTAL_PLEDGE + SECOND_PLEDGE;
    return { ...base, SECOND_PLEDGE, total };
  }

  it("applies losses proportionally across multiple underwriters", async function () {
    const {
      riskManager,
      capitalPool,
      underwriter,
      secondUnderwriter,
      nonParty,
      POOL_ID,
      POLICY_ID,
      COVERAGE,
      TOTAL_PLEDGE,
      SECOND_PLEDGE,
      total,
    } = await loadFixture(deployTwoUnderwriterFixture);

    await riskManager.connect(nonParty).processClaim(POLICY_ID);

    const expectedLoss1 = (TOTAL_PLEDGE * COVERAGE) / total;
    const expectedLoss2 = (SECOND_PLEDGE * COVERAGE) / total;

    const acc1 = await capitalPool.getUnderwriterAccount(underwriter.address);
    await capitalPool.connect(underwriter).requestWithdrawal(acc1.masterShares);
    await time.increase(1);
    await expect(capitalPool.connect(underwriter).executeWithdrawal(0))
      .to.emit(capitalPool, "LossesApplied")
      .withArgs(underwriter.address, expectedLoss1, true);

    const acc2 = await capitalPool.getUnderwriterAccount(secondUnderwriter.address);
    await capitalPool.connect(secondUnderwriter).requestWithdrawal(acc2.masterShares);
    await time.increase(1);
    await expect(capitalPool.connect(secondUnderwriter).executeWithdrawal(0))
      .to.emit(capitalPool, "LossesApplied")
      .withArgs(secondUnderwriter.address, expectedLoss2, true);

    expect(await riskManager.underwriterTotalPledge(underwriter.address)).to.equal(0);
    expect(await riskManager.underwriterTotalPledge(secondUnderwriter.address)).to.equal(0);
  });

  async function deployUnderwriterAfterClaimFixture() {
    const base = await deployFixture();
    await base.riskManager.connect(base.nonParty).processClaim(base.POLICY_ID);
    const NEW_PLEDGE = ethers.parseUnits("50000", 6);
    await base.usdc.mint(base.secondUnderwriter.address, NEW_PLEDGE);
    await base.usdc.connect(base.secondUnderwriter).approve(base.capitalPool.target, NEW_PLEDGE);
    await base.capitalPool.connect(base.secondUnderwriter).deposit(NEW_PLEDGE, PLATFORM);
    await base.riskManager.connect(base.secondUnderwriter).allocateCapital([base.POOL_ID]);
    return { ...base, NEW_PLEDGE };
  }

  it("new underwriters joining after a claim inherit existing loss tracker", async function () {
    const { riskManager, lossDistributor, capitalPool, secondUnderwriter, POOL_ID, COVERAGE, TOTAL_PLEDGE, NEW_PLEDGE } =
      await loadFixture(deployUnderwriterAfterClaimFixture);

    const expectedTracker = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
    expect(await lossDistributor.poolLossTrackers(POOL_ID)).to.equal(expectedTracker);
    const expectedLoss = (NEW_PLEDGE * COVERAGE) / TOTAL_PLEDGE;
    expect(await lossDistributor.getPendingLosses(secondUnderwriter.address, POOL_ID, NEW_PLEDGE)).to.equal(
      expectedLoss
    );

    const acc = await capitalPool.getUnderwriterAccount(secondUnderwriter.address);
    await capitalPool.connect(secondUnderwriter).requestWithdrawal(acc.masterShares);
    await time.increase(1);
    await expect(capitalPool.connect(secondUnderwriter).executeWithdrawal(0))
      .to.emit(capitalPool, "LossesApplied")
      .withArgs(secondUnderwriter.address, expectedLoss, true);
  });

  async function deployZeroCapitalFixture() {
    const base = await deployFixture();
    const acc = await base.capitalPool.getUnderwriterAccount(base.underwriter.address);
    await base.capitalPool.connect(base.underwriter).requestWithdrawal(acc.masterShares);
    await time.increase(1);
    await base.capitalPool.connect(base.underwriter).executeWithdrawal(0);
    return base;
  }

  it("does not track losses when pool has no capital", async function () {
    const { riskManager, lossDistributor, nonParty, POLICY_ID, POOL_ID } = await loadFixture(deployZeroCapitalFixture);
    await expect(riskManager.connect(nonParty).processClaim(POLICY_ID)).to.not.be.reverted;
    expect(await lossDistributor.poolLossTrackers(POOL_ID)).to.equal(0n);
  });

  it("handles claim exceeding pool pledge", async function () {
    const { riskManager, capitalPool, policyNFT, protocolToken, claimant, underwriter, nonParty, POOL_ID, TOTAL_PLEDGE } =
      await loadFixture(deployFixture);

    const BIG = ethers.parseUnits("150000", 6);
    const policyBig = await mintPolicy(riskManager, policyNFT, claimant, POOL_ID, BIG);
    await protocolToken.mint(claimant.address, BIG);
    // Reset approval to satisfy the ResetApproveERC20 requirement
    await protocolToken.connect(claimant).approve(riskManager.target, 0);
    await protocolToken.connect(claimant).approve(riskManager.target, BIG);
    await riskManager.connect(nonParty).processClaim(policyBig);

    const expectedTracker = (BIG * PRECISION) / TOTAL_PLEDGE;
    expect(await lossDistributor.poolLossTrackers(POOL_ID)).to.equal(expectedTracker);

    const acc = await capitalPool.getUnderwriterAccount(underwriter.address);
    await capitalPool.connect(underwriter).requestWithdrawal(acc.masterShares);
    await time.increase(1);
    await expect(capitalPool.connect(underwriter).executeWithdrawal(0))
      .to.emit(capitalPool, "LossesApplied")
      .withArgs(underwriter.address, TOTAL_PLEDGE, true);
    expect(await riskManager.underwriterTotalPledge(underwriter.address)).to.equal(0);
  });
});
