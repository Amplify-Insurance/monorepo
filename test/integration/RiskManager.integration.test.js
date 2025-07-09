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

    const SimpleAdapter = await ethers.getContractFactory("SimpleYieldAdapter");
    adapter = await SimpleAdapter.deploy(usdc.target, ethers.ZeroAddress, owner.address);

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

    const CatPool = await ethers.getContractFactory("BackstopPool");
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

    await expect(
      riskManager.connect(liquidator).liquidateInsolventUnderwriter(underwriter.address)
    ).to.be.reverted;
  });

  it("reverts liquidation when underwriter is solvent", async function () {
    const rmSigner = await impersonate(riskManager.target);
    const smallLoss = PLEDGE_AMOUNT / 2n;
    await lossDistributor.connect(rmSigner).distributeLoss(POOL_ID, smallLoss, PLEDGE_AMOUNT);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);

    await expect(
      riskManager.connect(liquidator).liquidateInsolventUnderwriter(underwriter.address)
    ).to.be.reverted;
  });

  it("committee can pause and unpause a pool", async function () {
    await riskManager.connect(committee).reportIncident(POOL_ID, true);
    let [, , , , isPaused] = await poolRegistry.getPoolData(POOL_ID);
    expect(isPaused).to.equal(true);
    await riskManager.connect(committee).reportIncident(POOL_ID, false);
    [, , , , isPaused] = await poolRegistry.getPoolData(POOL_ID);
    expect(isPaused).to.equal(false);
  });

  it("committee can update pool fee recipient", async function () {
    await riskManager.connect(committee).setPoolFeeRecipient(POOL_ID, nonParty.address);
    const [, , , , , feeRecipient] = await poolRegistry.getPoolData(POOL_ID);
    expect(feeRecipient).to.equal(nonParty.address);
  });

  it("underwriter can deallocate after requesting", async function () {
    await riskManager.connect(owner).setDeallocationNoticePeriod(0);
    await riskManager.connect(underwriter).requestDeallocateFromPool(POOL_ID, PLEDGE_AMOUNT);
    await riskManager.connect(underwriter).deallocateFromPool(POOL_ID);
    expect(await riskManager.isAllocatedToPool(underwriter.address, POOL_ID)).to.equal(false);
  });

  it("claims premium rewards after distribution", async function () {
    const reward = ethers.parseUnits("100", 6);
    const [, totalPledged] = await poolRegistry.getPoolData(POOL_ID);
    await usdc.mint(rewardDistributor.target, reward);
    const rm = await impersonate(riskManager.target);
    await rewardDistributor.connect(rm).distribute(POOL_ID, usdc.target, reward, totalPledged);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);
    const before = await usdc.balanceOf(underwriter.address);
    await riskManager.connect(underwriter).claimPremiumRewards([POOL_ID]);
    const after = await usdc.balanceOf(underwriter.address);
    expect(after).to.be.gt(before);
  });

  it("processes a claim and pays out", async function () {
    const COVERAGE = ethers.parseUnits("2000", 6);
    const PREMIUM = ethers.parseUnits("10", 6);
    await usdc.mint(nonParty.address, COVERAGE + PREMIUM);
    await usdc.connect(nonParty).approve(policyManager.target, PREMIUM);
    await policyManager.connect(nonParty).purchaseCover(POOL_ID, COVERAGE, PREMIUM);
    await policyNFT.connect(owner).setPolicyManagerAddress(riskManager.target);
    await usdc.connect(nonParty).approve(riskManager.target, COVERAGE);
    await expect(riskManager.connect(nonParty).processClaim(1)).to.not.be.reverted;
    await expect(policyNFT.ownerOf(1)).to.be.revertedWithCustomError(policyNFT, "ERC721NonexistentToken");
    const [, , sold] = await poolRegistry.getPoolData(POOL_ID);
    expect(sold).to.equal(0);
  });

  it("claims distressed assets from cat pool", async function () {
    const depositAmt = ethers.parseUnits("100", 6);
    await usdc.mint(nonParty.address, depositAmt);
    await usdc.connect(nonParty).approve(catPool.target, depositAmt);
    await catPool.connect(nonParty).depositLiquidity(depositAmt);

    const reward = ethers.parseUnits("50", 6);
    await usdc.mint(rewardDistributor.target, reward);
    const totalShares = await (await ethers.getContractAt("CatShare", await catPool.catShareToken())).totalSupply();
    const rm = await impersonate(riskManager.target);
    await rewardDistributor.connect(rm).distribute(
      await catPool.CAT_POOL_REWARD_ID(),
      usdc.target,
      reward,
      totalShares
    );
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);

    const before = await usdc.balanceOf(nonParty.address);
    await riskManager.connect(nonParty).claimDistressedAssets([POOL_ID]);
    const after = await usdc.balanceOf(nonParty.address);
    expect(after).to.be.gt(before);
  });

  it("only owner can set committee", async function () {
    await expect(
      riskManager.connect(nonParty).setCommittee(nonParty.address)
    )
      .to.be.revertedWithCustomError(riskManager, "OwnableUnauthorizedAccount")
      .withArgs(nonParty.address);
    await expect(riskManager.connect(owner).setCommittee(nonParty.address))
      .to.emit(riskManager, "CommitteeSet")
      .withArgs(nonParty.address);
  });

  it("reverts allocation when no capital pledged", async function () {
    await expect(
      riskManager.connect(nonParty).allocateCapital([POOL_ID])
    ).to.be.revertedWithCustomError(riskManager, "NoCapitalToAllocate");
  });

  it("reverts allocation for invalid pool id", async function () {
    await expect(
      riskManager.connect(underwriter).allocateCapital([1])
    ).to.be.revertedWith("Invalid poolId");
  });

  it("only policy manager can update coverage sold", async function () {
    await expect(
      riskManager.connect(nonParty).updateCoverageSold(POOL_ID, 100, true)
    ).to.be.revertedWithCustomError(riskManager, "NotPolicyManager");
    const pm = await impersonate(policyManager.target);
    await riskManager.connect(pm).updateCoverageSold(POOL_ID, 100, true);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [policyManager.target]);
    const [, , sold] = await poolRegistry.getPoolData(POOL_ID);
    expect(sold).to.equal(100);
  });

  it("tracks pending withdrawals via hooks", async function () {
    const shares =
      (await capitalPool.getUnderwriterAccount(underwriter.address)).masterShares / 2n;
    const expected = await capitalPool.sharesToValue(shares);
    await capitalPool.connect(underwriter).requestWithdrawal(shares);
    let [, , , pending] = await poolRegistry.getPoolData(POOL_ID);
    expect(pending).to.equal(expected);
    await capitalPool.connect(underwriter).cancelWithdrawalRequest(0);
    [, , , pending] = await poolRegistry.getPoolData(POOL_ID);
    expect(pending).to.equal(0);
  });
});
