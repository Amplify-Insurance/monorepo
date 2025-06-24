const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const PRECISION = 10n ** 18n;

async function deployFixture() {
  const [owner, committee, underwriter, claimant, adapter, nonParty] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("ResetApproveERC20");
  const usdc = await Token.deploy("USD Coin", "USDC", 6);
  const protocolToken = await Token.deploy("Protocol", "PTKN", 6);
  await protocolToken.mint(claimant.address, ethers.parseUnits("100000", 6));

  const CapitalPool = await ethers.getContractFactory("MockCapitalPool");
  const capitalPool = await CapitalPool.deploy(owner.address, usdc.target);

  const PoolRegistry = await ethers.getContractFactory("MockPoolRegistry");
  const poolRegistry = await PoolRegistry.deploy();

  const PolicyNFT = await ethers.getContractFactory("MockPolicyNFT");
  const policyNFT = await PolicyNFT.deploy(owner.address);

  const PolicyManager = await ethers.getContractFactory("MockPolicyManager");
  const policyManager = await PolicyManager.deploy();
  await policyManager.setPolicyNFT(policyNFT.target);

  const CatPool = await ethers.getContractFactory("MockCatInsurancePool");
  const catPool = await CatPool.deploy(owner.address);

  const RewardDistributor = await ethers.getContractFactory("MockRewardDistributor");
  const rewardDistributor = await RewardDistributor.deploy();
  await rewardDistributor.setCatPool(catPool.target);

  const RiskManager = await ethers.getContractFactory("RiskManager");
  const riskManager = await RiskManager.deploy(owner.address);

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

  // setup pool
  const POOL_ID = 0;
  await poolRegistry.setPoolCount(1);
  await poolRegistry.connect(owner).setPoolData(
    POOL_ID,
    protocolToken.target,
    0,
    0,
    0,
    false,
    committee.address,
    500
  );
  await poolRegistry.setPayoutData([adapter.address], [ethers.parseUnits("100000", 6)], ethers.parseUnits("100000", 6));

  // deposit and allocate
  const TOTAL_PLEDGE = ethers.parseUnits("100000", 6);
  await capitalPool.triggerOnCapitalDeposited(riskManager.target, underwriter.address, TOTAL_PLEDGE);
  await capitalPool.setUnderwriterAdapterAddress(underwriter.address, adapter.address);
  await riskManager.connect(underwriter).allocateCapital([POOL_ID]);

  // policy
  const POLICY_ID = 1;
  const COVERAGE = ethers.parseUnits("50000", 6);
  await policyNFT.mock_setPolicy(POLICY_ID, claimant.address, POOL_ID, COVERAGE, 0, 0, 0, 0);
  await policyNFT.setRiskManagerAddress(riskManager.target);
  await protocolToken.connect(claimant).approve(riskManager.target, ethers.MaxUint256);

  return {
    owner,
    committee,
    underwriter,
    claimant,
    adapter,
    nonParty,
    capitalPool,
    poolRegistry,
    policyNFT,
    riskManager,
    lossDistributor,
    protocolToken,
    POOL_ID,
    POLICY_ID,
    COVERAGE,
    TOTAL_PLEDGE,
  };
}

describe("LossDistributor Integration", function () {
  it("updates pool tracker when claim processed", async function () {
    const {
      riskManager,
      lossDistributor,
      protocolToken,
      claimant,
      nonParty,
      POOL_ID,
      POLICY_ID,
      COVERAGE,
      TOTAL_PLEDGE,
    } = await loadFixture(deployFixture);

    await expect(riskManager.connect(nonParty).processClaim(POLICY_ID)).to.not.be.reverted;

    const expected = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
    expect(await lossDistributor.poolLossTrackers(POOL_ID)).to.equal(expected);
  });

  it("realizes losses on withdrawal", async function () {
    const {
      riskManager,
      lossDistributor,
      capitalPool,
      protocolToken,
      claimant,
      underwriter,
      adapter,
      nonParty,
      POOL_ID,
      POLICY_ID,
      COVERAGE,
      TOTAL_PLEDGE,
    } = await loadFixture(deployFixture);

    await riskManager.connect(nonParty).processClaim(POLICY_ID);

    // underwriter withdraws everything
    await capitalPool.triggerOnCapitalWithdrawn(
      riskManager.target,
      underwriter.address,
      TOTAL_PLEDGE,
      true
    );

    expect(await capitalPool.applyLossesCallCount()).to.equal(1);
    expect(await capitalPool.last_applyLosses_underwriter()).to.equal(underwriter.address);
    expect(await capitalPool.last_applyLosses_principalLossAmount()).to.equal(COVERAGE);
    expect(await riskManager.underwriterTotalPledge(underwriter.address)).to.equal(0n);
  });

  it("accumulates loss for multiple claims", async function () {
    const {
      riskManager,
      lossDistributor,
      protocolToken,
      claimant,
      nonParty,
      POOL_ID,
      POLICY_ID,
      COVERAGE,
      TOTAL_PLEDGE,
      policyNFT,
    } = await loadFixture(deployFixture);

    await riskManager.connect(nonParty).processClaim(POLICY_ID);
    const POLICY_ID_2 = 2;
    const COVERAGE_2 = ethers.parseUnits("20000", 6);
    await policyNFT.mock_setPolicy(POLICY_ID_2, claimant.address, POOL_ID, COVERAGE_2, 0, 0, 0, 0);
    await protocolToken.connect(claimant).approve(riskManager.target, 0);
    await protocolToken.connect(claimant).approve(riskManager.target, ethers.MaxUint256);
    await riskManager.connect(nonParty).processClaim(POLICY_ID_2);

    const expected = ((COVERAGE + COVERAGE_2) * PRECISION) / TOTAL_PLEDGE;
    expect(await lossDistributor.poolLossTrackers(POOL_ID)).to.equal(expected);
  });

  it("realizes proportional losses on partial withdrawal", async function () {
    const {
      riskManager,
      lossDistributor,
      capitalPool,
      underwriter,
      nonParty,
      POOL_ID,
      POLICY_ID,
      COVERAGE,
      TOTAL_PLEDGE,
    } = await loadFixture(deployFixture);

    await riskManager.connect(nonParty).processClaim(POLICY_ID);

    const PARTIAL = TOTAL_PLEDGE / 2n;
    await capitalPool.triggerOnCapitalWithdrawn(
      riskManager.target,
      underwriter.address,
      PARTIAL,
      false
    );

    expect(await capitalPool.applyLossesCallCount()).to.equal(1);
    expect(await capitalPool.last_applyLosses_principalLossAmount()).to.equal(COVERAGE);
    expect(await riskManager.underwriterTotalPledge(underwriter.address)).to.equal(TOTAL_PLEDGE - COVERAGE - PARTIAL);
    expect(await riskManager.underwriterPoolPledge(underwriter.address, POOL_ID)).to.equal(TOTAL_PLEDGE - COVERAGE - PARTIAL);
    expect(await riskManager.isAllocatedToPool(underwriter.address, POOL_ID)).to.equal(false);
  });

  async function deployTwoPoolFixture() {
    const base = await deployFixture();
    const {
      owner,
      committee,
      underwriter,
      claimant,
      adapter,
      poolRegistry,
      riskManager,
      policyNFT,
      protocolToken,
    } = base;

    const SECOND_POOL_ID = 1;
    await poolRegistry.setPoolCount(2);
    await poolRegistry.connect(owner).setPoolData(
      SECOND_POOL_ID,
      protocolToken.target,
      0,
      0,
      0,
      false,
      committee.address,
      500
    );
    await riskManager.connect(underwriter).allocateCapital([SECOND_POOL_ID]);

    const POLICY_ID_2 = 2;
    const COVERAGE_2 = ethers.parseUnits("30000", 6);
    await policyNFT.mock_setPolicy(POLICY_ID_2, claimant.address, SECOND_POOL_ID, COVERAGE_2, 0, 0, 0, 0);
    await protocolToken.connect(claimant).approve(riskManager.target, 0);
    await protocolToken.connect(claimant).approve(riskManager.target, ethers.MaxUint256);

    return {
      ...base,
      SECOND_POOL_ID,
      POLICY_ID_2,
      COVERAGE_2,
    };
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
    const signers = await ethers.getSigners();
    const secondUnderwriter = signers[6];

    const SECOND_PLEDGE = ethers.parseUnits("50000", 6);
    await base.capitalPool.triggerOnCapitalDeposited(
      base.riskManager.target,
      secondUnderwriter.address,
      SECOND_PLEDGE
    );
    await base.capitalPool.setUnderwriterAdapterAddress(
      secondUnderwriter.address,
      base.adapter.address
    );
    await base.riskManager.connect(secondUnderwriter).allocateCapital([base.POOL_ID]);

    const total = base.TOTAL_PLEDGE + SECOND_PLEDGE;
    await base.poolRegistry.setPayoutData([base.adapter.address], [total], total);

    return {
      ...base,
      secondUnderwriter,
      SECOND_PLEDGE,
      TOTAL_PLEDGE_TWO: total,
    };
  }

  it("applies losses proportionally across multiple underwriters", async function () {
    const {
      riskManager,
      lossDistributor,
      capitalPool,
      underwriter,
      secondUnderwriter,
      nonParty,
      POOL_ID,
      POLICY_ID,
      COVERAGE,
      TOTAL_PLEDGE,
      SECOND_PLEDGE,
      TOTAL_PLEDGE_TWO,
    } = await loadFixture(deployTwoUnderwriterFixture);

    await riskManager.connect(nonParty).processClaim(POLICY_ID);

    const expectedTracker = (COVERAGE * PRECISION) / TOTAL_PLEDGE_TWO;
    const expectedLoss1 = (TOTAL_PLEDGE * COVERAGE) / TOTAL_PLEDGE_TWO;
    const expectedLoss2 = (SECOND_PLEDGE * COVERAGE) / TOTAL_PLEDGE_TWO;

    expect(await lossDistributor.poolLossTrackers(POOL_ID)).to.equal(expectedTracker);

    await capitalPool.triggerOnCapitalWithdrawn(
      riskManager.target,
      underwriter.address,
      TOTAL_PLEDGE,
      true
    );
    expect(await capitalPool.applyLossesCallCount()).to.equal(1);
    expect(await capitalPool.last_applyLosses_underwriter()).to.equal(underwriter.address);
    expect(await capitalPool.last_applyLosses_principalLossAmount()).to.equal(expectedLoss1);
    expect(await riskManager.underwriterTotalPledge(underwriter.address)).to.equal(0n);

    await capitalPool.triggerOnCapitalWithdrawn(
      riskManager.target,
      secondUnderwriter.address,
      SECOND_PLEDGE,
      true
    );

    expect(await capitalPool.applyLossesCallCount()).to.equal(2);
    expect(await capitalPool.last_applyLosses_underwriter()).to.equal(secondUnderwriter.address);
    expect(await capitalPool.last_applyLosses_principalLossAmount()).to.equal(expectedLoss2);
    expect(await riskManager.underwriterTotalPledge(secondUnderwriter.address)).to.equal(0n);
  });

  async function deployUnderwriterAfterClaimFixture() {
    const base = await deployFixture();
    const signers = await ethers.getSigners();
    const newUnderwriter = signers[6];

    await base.riskManager.connect(base.nonParty).processClaim(base.POLICY_ID);

    const NEW_PLEDGE = ethers.parseUnits("50000", 6);
    await base.capitalPool.triggerOnCapitalDeposited(
      base.riskManager.target,
      newUnderwriter.address,
      NEW_PLEDGE
    );
    await base.capitalPool.setUnderwriterAdapterAddress(newUnderwriter.address, base.adapter.address);
    await base.riskManager.connect(newUnderwriter).allocateCapital([base.POOL_ID]);

    return { ...base, newUnderwriter, NEW_PLEDGE };
  }

  it("new underwriters joining after a claim inherit existing loss tracker", async function () {
    const {
      riskManager,
      lossDistributor,
      capitalPool,
      newUnderwriter,
      nonParty,
      POOL_ID,
      POLICY_ID,
      COVERAGE,
      TOTAL_PLEDGE,
      NEW_PLEDGE,
    } = await loadFixture(deployUnderwriterAfterClaimFixture);

    const expectedTracker = (COVERAGE * PRECISION) / TOTAL_PLEDGE;
    expect(await lossDistributor.poolLossTrackers(POOL_ID)).to.equal(expectedTracker);
    const expectedLoss = (NEW_PLEDGE * COVERAGE) / TOTAL_PLEDGE;
    expect(
      await lossDistributor.getPendingLosses(newUnderwriter.address, POOL_ID, NEW_PLEDGE)
    ).to.equal(expectedLoss);

    await capitalPool.triggerOnCapitalWithdrawn(
      riskManager.target,
      newUnderwriter.address,
      NEW_PLEDGE,
      true
    );
    expect(await capitalPool.applyLossesCallCount()).to.equal(1);
    expect(await capitalPool.last_applyLosses_principalLossAmount()).to.equal(expectedLoss);
    expect(await riskManager.underwriterTotalPledge(newUnderwriter.address)).to.equal(0n);
  });

  async function deployZeroCapitalFixture() {
    const base = await deployFixture();
    await base.capitalPool.triggerOnCapitalWithdrawn(
      base.riskManager.target,
      base.underwriter.address,
      base.TOTAL_PLEDGE,
      true
    );
    await base.poolRegistry.setPayoutData([base.adapter.address], [0], 0);
    return base;
  }

  it("does not track losses when pool has no capital", async function () {
    const { riskManager, lossDistributor, nonParty, POLICY_ID, POOL_ID } = await loadFixture(
      deployZeroCapitalFixture
    );

    await expect(riskManager.connect(nonParty).processClaim(POLICY_ID)).to.not.be.reverted;
    expect(await lossDistributor.poolLossTrackers(POOL_ID)).to.equal(0n);
  });

  it("handles claim exceeding pool pledge", async function () {
    const {
      riskManager,
      lossDistributor,
      capitalPool,
      policyNFT,
      protocolToken,
      claimant,
      underwriter,
      adapter,
      nonParty,
      POOL_ID,
      TOTAL_PLEDGE,
    } = await loadFixture(deployFixture);

    const BIG_COVERAGE = ethers.parseUnits("150000", 6);
    await policyNFT.mock_setPolicy(1, claimant.address, POOL_ID, BIG_COVERAGE, 0, 0, 0, 0);
    await protocolToken.mint(claimant.address, BIG_COVERAGE);
    await protocolToken.connect(claimant).approve(riskManager.target, 0);
    await protocolToken.connect(claimant).approve(riskManager.target, ethers.MaxUint256);

    await riskManager.connect(nonParty).processClaim(1);

    const expectedTracker = (BIG_COVERAGE * PRECISION) / TOTAL_PLEDGE;
    expect(await lossDistributor.poolLossTrackers(POOL_ID)).to.equal(expectedTracker);

    await capitalPool.triggerOnCapitalWithdrawn(
      riskManager.target,
      underwriter.address,
      TOTAL_PLEDGE,
      true
    );

    expect(await capitalPool.applyLossesCallCount()).to.equal(1);
    expect(await capitalPool.last_applyLosses_principalLossAmount()).to.equal(BIG_COVERAGE);
    expect(await riskManager.underwriterTotalPledge(underwriter.address)).to.equal(0n);
  });
});
