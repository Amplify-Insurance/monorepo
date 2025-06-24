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

    const Token = await ethers.getContractFactory("ResetApproveERC20");
    usdc = await Token.deploy("USD Coin", "USDC", 6);
    rewardToken = await Token.deploy("Reward Token", "RWT", 18);

    const CatShare = await ethers.getContractFactory("CatShare");
    catShare = await CatShare.deploy();

    const Adapter = await ethers.getContractFactory("SimpleYieldAdapter");
    adapter = await Adapter.deploy(usdc.target, ethers.ZeroAddress, owner.address);

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

  it("initializes only once and locks initial shares", async function () {
    expect(await catShare.balanceOf(catPool.target)).to.equal(1000n);
    await expect(catPool.initialize()).to.be.revertedWith("CIP: Already initialized");
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

  it("reverts when deposit below minimum", async function () {
    await expect(catPool.connect(lp1).depositLiquidity(0)).to.be.revertedWith("CIP: Amount below minimum");
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

  it("reverts withdrawal before notice period", async function () {
    const depositAmount = ethers.parseUnits("1000", 6);
    await catPool.connect(lp1).depositLiquidity(depositAmount);
    const shares = await catShare.balanceOf(lp1.address);
    await catPool.connect(lp1).requestWithdrawal(shares);
    await expect(catPool.connect(lp1).withdrawLiquidity(shares)).to.be.revertedWith("CIP: Notice period active");
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

  it("flushes idle USDC to adapter", async function () {
    const depositAmount = ethers.parseUnits("1000", 6);
    await catPool.connect(lp1).depositLiquidity(depositAmount);

    const flushAmount = ethers.parseUnits("600", 6);
    await expect(catPool.connect(owner).flushToAdapter(flushAmount))
      .to.emit(catPool, "DepositToAdapter")
      .withArgs(flushAmount);

    expect(await catPool.idleUSDC()).to.equal(depositAmount - flushAmount);
    expect(await adapter.totalValueHeld()).to.equal(flushAmount);
  });

  it("policyManager can send premiums to CatPool", async function () {
    const premium = ethers.parseUnits("50", 6);
    await usdc.mint(policyManager.address, premium);
    await usdc.connect(policyManager).approve(catPool.target, premium);

    await expect(catPool.connect(policyManager).receiveUsdcPremium(premium))
      .to.emit(catPool, "UsdcPremiumReceived")
      .withArgs(premium);

    expect(await catPool.idleUSDC()).to.equal(premium);
  });

  it("riskManager claims rewards for user", async function () {
    const depositAmount = ethers.parseUnits("1000", 6);
    await catPool.connect(lp1).depositLiquidity(depositAmount);

    const rewardAmount = ethers.parseEther("25");
    await rewardToken.mint(riskManager.address, rewardAmount);
    await rewardToken.connect(riskManager).approve(catPool.target, rewardAmount);
    await catPool
      .connect(riskManager)
      .receiveProtocolAssetsForDistribution(rewardToken.target, rewardAmount);

    await rewardToken.mint(riskManager.address, rewardAmount);
    await rewardToken
      .connect(riskManager)
      .transfer(rewardDistributor.target, rewardAmount);

    const totalSupply = await catShare.totalSupply();
    const userShares = await catShare.balanceOf(lp1.address);
    const expected = (rewardAmount * userShares) / totalSupply;

    await expect(
      catPool
        .connect(riskManager)
        .claimProtocolAssetRewardsFor(lp1.address, rewardToken.target)
    )
      .to.emit(catPool, "ProtocolAssetRewardsClaimed")
      .withArgs(lp1.address, rewardToken.target, expected);
  });

  it("owner can update contract addresses", async function () {
    const newRM = lp1.address;
    const newPM = lp2.address;
    const newCP = riskManager.address;
    const NewRDFactory = await ethers.getContractFactory("RewardDistributor");
    const newRD = await NewRDFactory.deploy(owner.address);

    await expect(catPool.connect(owner).setRiskManagerAddress(newRM))
      .to.emit(catPool, "RiskManagerAddressSet")
      .withArgs(newRM);
    await expect(catPool.connect(owner).setPolicyManagerAddress(newPM))
      .to.emit(catPool, "PolicyManagerAddressSet")
      .withArgs(newPM);
    await expect(catPool.connect(owner).setCapitalPoolAddress(newCP))
      .to.emit(catPool, "CapitalPoolAddressSet")
      .withArgs(newCP);
    await expect(catPool.connect(owner).setRewardDistributor(newRD.target))
      .to.emit(catPool, "RewardDistributorSet")
      .withArgs(newRD.target);

    expect(await catPool.riskManagerAddress()).to.equal(newRM);
    expect(await catPool.policyManagerAddress()).to.equal(newPM);
    expect(await catPool.capitalPoolAddress()).to.equal(newCP);
    expect(await catPool.rewardDistributor()).to.equal(newRD.target);
  });

  it("owner can switch adapters and funds are moved", async function () {
    const depositAmount = ethers.parseUnits("1000", 6);
    await catPool.connect(lp1).depositLiquidity(depositAmount);
    await catPool.connect(owner).flushToAdapter(depositAmount);
    await adapter.setTotalValueHeld(depositAmount);

    const AdapterFactory = await ethers.getContractFactory("SimpleYieldAdapter");
    const newAdapter = await AdapterFactory.deploy(
      usdc.target,
      ethers.ZeroAddress,
      owner.address
    );
    await newAdapter.setDepositor(catPool.target);

    await expect(catPool.connect(owner).setAdapter(newAdapter.target))
      .to.emit(catPool, "AdapterChanged")
      .withArgs(newAdapter.target);

    expect(await catPool.idleUSDC()).to.equal(depositAmount);
    expect(await newAdapter.totalValueHeld()).to.equal(0);
  });

  it("liquidUsdc sums idle and adapter balances", async function () {
    const depositAmount = ethers.parseUnits("1000", 6);
    await catPool.connect(lp1).depositLiquidity(depositAmount);
    await catPool.connect(owner).flushToAdapter(depositAmount);
    await adapter.setTotalValueHeld(depositAmount * 2n);

    expect(await catPool.liquidUsdc()).to.equal(depositAmount * 2n);
  });
});
