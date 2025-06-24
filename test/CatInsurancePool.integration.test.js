const { expect } = require("chai");
const { ethers } = require("hardhat");

/** Integration tests for CatInsurancePool using the real RewardDistributor */
describe("CatInsurancePool Integration", function () {
  let owner, riskManager, policyManager, capitalPool, lp1;
  let usdc, rewardToken;
  let catShare, adapter, rewardDistributor, catPool;

  beforeEach(async () => {
    [owner, riskManager, policyManager, capitalPool, lp1] = await ethers.getSigners();

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
});
