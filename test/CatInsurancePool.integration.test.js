const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/** Integration tests for CatInsurancePool using the real RewardDistributor */
describe("CatInsurancePool Integration", function () {
  let owner, riskManager, policyManager, capitalPool, lp1, lp2;
  let usdc, rewardToken;
  let catShare, adapter, rewardDistributor, catPool;
  const NOTICE_PERIOD = 30 * 24 * 60 * 60; // 30 days

  beforeEach(async () => {
    [owner, riskManager, policyManager, capitalPool, lp1, lp2] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    rewardToken = await MockERC20.deploy("Reward Token", "RWT", 18);

    const CatShare = await ethers.getContractFactory("CatShare");
    catShare = await CatShare.deploy();

    const MockYieldAdapter = await ethers.getContractFactory("MockYieldAdapter");
    adapter = await MockYieldAdapter.deploy(usdc.target, ethers.ZeroAddress, owner.address);

    const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
    rewardDistributor = await RewardDistributor.deploy(riskManager.address);

    const CatPool = await ethers.getContractFactory("CatInsurancePool");
    catPool = await CatPool.deploy(usdc.target, catShare.target, adapter.target, owner.address);

    await catShare.transferOwnership(catPool.target);
    await catPool.initialize();

    await rewardDistributor.connect(owner).setCatPool(catPool.target);
    await rewardDistributor.connect(owner).setRiskManager(catPool.target);

    await adapter.setDepositor(catPool.target);

    await catPool.setRiskManagerAddress(riskManager.address);
    await catPool.setPolicyManagerAddress(policyManager.address);
    await catPool.setCapitalPoolAddress(capitalPool.address);
    await catPool.setRewardDistributor(rewardDistributor.target);

    await usdc.mint(lp1.address, ethers.parseUnits("10000", 6));
    await usdc.connect(lp1).approve(catPool.target, ethers.MaxUint256);
    await usdc.mint(lp2.address, ethers.parseUnits("10000", 6));
    await usdc.connect(lp2).approve(catPool.target, ethers.MaxUint256);
  });

  it("distributes protocol assets via RewardDistributor and allows claiming", async function () {
    const depositAmount = ethers.parseUnits("1000", 6);
    await catPool.connect(lp1).depositLiquidity(depositAmount);

    const rewardAmount = ethers.parseEther("50");
    await rewardToken.mint(riskManager.address, rewardAmount);
    await rewardToken.connect(riskManager).approve(catPool.target, rewardAmount);

    await expect(
      catPool.connect(riskManager).receiveProtocolAssetsForDistribution(rewardToken.target, rewardAmount)
    ).to.emit(catPool, "ProtocolAssetReceivedForDistribution");

    // Transfer reward tokens to the RewardDistributor so it can pay out
    await rewardToken.mint(riskManager.address, rewardAmount);
    await rewardToken.connect(riskManager).transfer(rewardDistributor.target, rewardAmount);

    const totalSupply = await catShare.totalSupply();
    const userShares = await catShare.balanceOf(lp1.address);
    const expected = (rewardAmount * userShares) / totalSupply;

    await expect(catPool.connect(lp1).claimProtocolAssetRewards(rewardToken.target))
      .to.emit(catPool, "ProtocolAssetRewardsClaimed")
      .withArgs(lp1.address, rewardToken.target, expected);

    expect(await rewardToken.balanceOf(lp1.address)).to.equal(expected);
  });

  it("riskManager drawFund pulls from adapter when idle insufficient", async function () {
    const depositAmount = ethers.parseUnits("1000", 6);
    await catPool.connect(lp1).depositLiquidity(depositAmount);
    await catPool.connect(owner).flushToAdapter(depositAmount);

    const drawAmount = ethers.parseUnits("600", 6);
    await adapter.setTotalValueHeld(depositAmount);

    await expect(catPool.connect(riskManager).drawFund(drawAmount))
      .to.emit(catPool, "DrawFromFund").withArgs(drawAmount, drawAmount);

    expect(await usdc.balanceOf(capitalPool.address)).to.equal(drawAmount);
    expect(await adapter.totalValueHeld()).to.equal(depositAmount - drawAmount);
  });

  it("mints shares based on adapter balance after yield", async function () {
    const depositAmount = ethers.parseUnits("1000", 6);
    await catPool.connect(lp1).depositLiquidity(depositAmount);
    await catPool.connect(owner).flushToAdapter(depositAmount);
    await adapter.setTotalValueHeld(depositAmount * 110n / 100n); // 10% yield

    const totalSupply = await catShare.totalSupply();
    const totalValue = await catPool.liquidUsdc();

    await catPool.connect(lp2).depositLiquidity(depositAmount);

    const effectiveSupply = totalSupply - 1000n; // exclude locked shares
    const expectedShares = (depositAmount * effectiveSupply) / totalValue;
    expect(await catShare.balanceOf(lp2.address)).to.equal(expectedShares);
  });

  it("allows withdrawing after notice pulling from adapter", async function () {
    const depositAmount = ethers.parseUnits("1000", 6);
    await catPool.connect(lp1).depositLiquidity(depositAmount);
    await catPool.connect(owner).flushToAdapter(depositAmount);
    await adapter.setTotalValueHeld(depositAmount);

    const shares = await catShare.balanceOf(lp1.address);
    await catPool.connect(lp1).requestWithdrawal(shares);
    await time.increase(NOTICE_PERIOD);

    await expect(catPool.connect(lp1).withdrawLiquidity(shares))
      .to.emit(catPool, "CatLiquidityWithdrawn")
      .withArgs(lp1.address, depositAmount, shares);
  });

  it("distributes rewards to multiple depositors", async function () {
    const depositAmount = ethers.parseUnits("1000", 6);
    await catPool.connect(lp1).depositLiquidity(depositAmount);
    await catPool.connect(lp2).depositLiquidity(depositAmount);

    const rewardAmount = ethers.parseEther("100");
    await rewardToken.mint(riskManager.address, rewardAmount);
    await rewardToken.connect(riskManager).approve(catPool.target, rewardAmount);

    await catPool.connect(riskManager).receiveProtocolAssetsForDistribution(rewardToken.target, rewardAmount);

    await rewardToken.mint(riskManager.address, rewardAmount);
    await rewardToken.connect(riskManager).transfer(rewardDistributor.target, rewardAmount);

    const totalSupply = await catShare.totalSupply();
    const user1Shares = await catShare.balanceOf(lp1.address);
    const user2Shares = await catShare.balanceOf(lp2.address);
    const expected1 = (rewardAmount * user1Shares) / totalSupply;
    const expected2 = (rewardAmount * user2Shares) / totalSupply;

    expect(await catPool.getPendingProtocolAssetRewards(lp1.address, rewardToken.target)).to.equal(expected1);
    expect(await catPool.getPendingProtocolAssetRewards(lp2.address, rewardToken.target)).to.equal(expected2);

    await expect(catPool.connect(lp1).claimProtocolAssetRewards(rewardToken.target))
      .to.emit(catPool, "ProtocolAssetRewardsClaimed")
      .withArgs(lp1.address, rewardToken.target, expected1);
    await expect(catPool.connect(lp2).claimProtocolAssetRewards(rewardToken.target))
      .to.emit(catPool, "ProtocolAssetRewardsClaimed")
      .withArgs(lp2.address, rewardToken.target, expected2);
  });
});
