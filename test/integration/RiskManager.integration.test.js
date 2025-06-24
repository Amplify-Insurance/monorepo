const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Integration tests using real contracts

describe("RiskManager Integration", function () {
  let owner, committee, underwriter, liquidator, nonParty;
  let riskManager, poolRegistry, capitalPool, policyNFT, catPool;
  let lossDistributor, rewardDistributor, policyManager, usdc, adapter;

  const POOL_ID = 0;
  const PLATFORM = 1; // mock yield platform id
  const PLEDGE_AMOUNT = ethers.parseUnits("10000", 6);
  const LOSS_AMOUNT = ethers.parseUnits("1000", 6);

  beforeEach(async function () {
    [owner, committee, underwriter, liquidator, nonParty] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.mint(underwriter.address, PLEDGE_AMOUNT);

    const MockYieldAdapter = await ethers.getContractFactory("MockYieldAdapter");
    adapter = await MockYieldAdapter.deploy(usdc.target, ethers.ZeroAddress, owner.address);

    const RiskManager = await ethers.getContractFactory("RiskManager");
    riskManager = await RiskManager.deploy(owner.address);

    const PoolRegistry = await ethers.getContractFactory("PoolRegistry");
    poolRegistry = await PoolRegistry.deploy(owner.address, riskManager.target);

    const CapitalPool = await ethers.getContractFactory("CapitalPool");
    capitalPool = await CapitalPool.deploy(owner.address, usdc.target);
    await capitalPool.setRiskManager(riskManager.target);
    await capitalPool.setBaseYieldAdapter(PLATFORM, adapter.target);
    await adapter.setDepositor(capitalPool.target);

    const CatShare = await ethers.getContractFactory("CatShare");
    const catShare = await CatShare.deploy();

    const CatPool = await ethers.getContractFactory("CatInsurancePool");
    catPool = await CatPool.deploy(usdc.target, catShare.target, ethers.ZeroAddress, owner.address);
    await catShare.transferOwnership(catPool.target);
    await catPool.initialize();

    const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
    rewardDistributor = await RewardDistributor.deploy(riskManager.target);
    await rewardDistributor.setCatPool(catPool.target);

    const LossDistributor = await ethers.getContractFactory("LossDistributor");
    lossDistributor = await LossDistributor.deploy(riskManager.target);

    const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
    policyNFT = await PolicyNFT.deploy(ethers.ZeroAddress, owner.address);

    const PolicyManager = await ethers.getContractFactory("PolicyManager");
    policyManager = await PolicyManager.deploy(policyNFT.target, owner.address);

    await policyNFT.setPolicyManagerAddress(policyManager.target);
    await catPool.setPolicyManagerAddress(policyManager.target);
    await catPool.setCapitalPoolAddress(capitalPool.target);
    await catPool.setRiskManagerAddress(riskManager.target);
    await catPool.setRewardDistributor(rewardDistributor.target);

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

    const RATE_MODEL = { base: 100, slope1: 0, slope2: 0, kink: 8000 };
    await riskManager.addProtocolRiskPool(usdc.target, RATE_MODEL, 0);

    await usdc.connect(underwriter).approve(capitalPool.target, ethers.MaxUint256);
    await capitalPool.connect(underwriter).deposit(PLEDGE_AMOUNT, PLATFORM);
    await riskManager.connect(underwriter).allocateCapital([POOL_ID]);
  });

  async function impersonate(address) {
    await ethers.provider.send("hardhat_impersonateAccount", [address]);
    await ethers.provider.send("hardhat_setBalance", [address, "0x1000000000000000000"]);
    return await ethers.getSigner(address);
  }

  it("realizes distributed losses on withdrawal", async function () {
    const rmSigner = await impersonate(riskManager.target);
    await lossDistributor.connect(rmSigner).distributeLoss(POOL_ID, LOSS_AMOUNT, PLEDGE_AMOUNT);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);

    expect(await lossDistributor.getPendingLosses(underwriter.address, POOL_ID, PLEDGE_AMOUNT)).to.equal(LOSS_AMOUNT);

    const withdrawValue = ethers.parseUnits("2000", 6);
    await ethers.provider.send("hardhat_impersonateAccount", [capitalPool.target]);
    await ethers.provider.send("hardhat_setBalance", [capitalPool.target, "0x1000000000000000000"]);
    const cp = await ethers.getSigner(capitalPool.target);
    await riskManager.connect(cp).onCapitalWithdrawn(underwriter.address, withdrawValue, false);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [capitalPool.target]);

    const expectedPledge = PLEDGE_AMOUNT - LOSS_AMOUNT - withdrawValue;
    expect(await riskManager.underwriterTotalPledge(underwriter.address)).to.equal(expectedPledge);
    expect(await lossDistributor.getPendingLosses(underwriter.address, POOL_ID, PLEDGE_AMOUNT)).to.equal(0);
  });

  it("liquidates an insolvent underwriter", async function () {
    const rmSigner = await impersonate(riskManager.target);
    const bigLoss = PLEDGE_AMOUNT + 1n;
    await lossDistributor.connect(rmSigner).distributeLoss(POOL_ID, bigLoss, PLEDGE_AMOUNT);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);

    await expect(riskManager.connect(liquidator).liquidateInsolventUnderwriter(underwriter.address))
      .to.emit(riskManager, "UnderwriterLiquidated")
      .withArgs(liquidator.address, underwriter.address);

    const expectedPledge = 0n;
    expect(await riskManager.underwriterTotalPledge(underwriter.address)).to.equal(expectedPledge);
    expect(await lossDistributor.getPendingLosses(underwriter.address, POOL_ID, PLEDGE_AMOUNT)).to.equal(0);
  });

  it("reverts liquidation when underwriter is solvent", async function () {
    const rmSigner = await impersonate(riskManager.target);
    const smallLoss = PLEDGE_AMOUNT / 2n;
    await lossDistributor.connect(rmSigner).distributeLoss(POOL_ID, smallLoss, PLEDGE_AMOUNT);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);

    await expect(
      riskManager.connect(liquidator).liquidateInsolventUnderwriter(underwriter.address)
    ).to.be.revertedWithCustomError(riskManager, "UnderwriterNotInsolvent");
  });
});
