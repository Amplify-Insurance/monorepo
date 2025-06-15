const { expect } = require("chai");
const { ethers: hardhatEthers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { parseUnits, ZeroAddress } = require("ethers");

const toWei = (value, decimals = 6) => parseUnits(value.toString(), decimals);

async function deployFixture() {
  const [owner, coverPoolAcc, user1, user2, other] = await hardhatEthers.getSigners();

  const MockERC20 = await hardhatEthers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("Mock USDC", "mUSDC", 6);

  const MockYieldAdapter = await hardhatEthers.getContractFactory("MockYieldAdapter");
  const adapter = await MockYieldAdapter.deploy(usdc.target, ZeroAddress, owner.address);

  const CatInsurancePool = await hardhatEthers.getContractFactory("CatInsurancePool");
  const catPool = await CatInsurancePool.deploy(usdc.target, adapter.target, owner.address);

  await adapter.connect(owner).setDepositor(catPool.target);
  await catPool.connect(owner).setPolicyManagerAddress(coverPoolAcc.address);

  const catShare = await hardhatEthers.getContractAt("CatShare", await catPool.catShareToken());

  const initial = toWei(1000000, 6);
  for (const signer of [owner, user1, user2]) {
    await usdc.connect(owner).mint(signer.address, initial);
    await usdc.connect(signer).approve(catPool.target, initial);
  }
  await usdc.connect(owner).mint(coverPoolAcc.address, initial);
  await usdc.connect(coverPoolAcc).approve(catPool.target, initial);

  const Proto = await MockERC20.deploy("MockPROTO", "mPROTO", 18);
  const protoSupply = toWei(1000, 18);
  await Proto.connect(owner).mint(coverPoolAcc.address, protoSupply);
  await Proto.connect(coverPoolAcc).approve(catPool.target, protoSupply);

  return { owner, coverPoolAcc, user1, user2, other, usdc, Proto, adapter, catPool, catShare };
}

describe("CatInsurancePool", function () {
  it("First deposit mints shares 1:1", async function () {
    const { catPool, user1, catShare, usdc } = await loadFixture(deployFixture);
    const amount = toWei(1000, 6);
    await expect(catPool.connect(user1).depositLiquidity(amount))
      .to.emit(catPool, "CatLiquidityDeposited")
      .withArgs(user1.address, amount, amount);
    expect(await catShare.balanceOf(user1.address)).to.equal(amount);
    expect(await catPool.idleUSDC()).to.equal(amount);
    expect(await usdc.balanceOf(catPool.target)).to.equal(amount);
  });

  it("Second depositor receives shares based on NAV after yield", async function () {
    const { catPool, user1, user2, catShare, adapter, owner } = await loadFixture(deployFixture);
    const dep1 = toWei(1000, 6);
    await catPool.connect(user1).depositLiquidity(dep1);
    await catPool.connect(owner).flushToAdapter(dep1);
    await adapter.connect(owner).simulateYieldOrLoss(toWei(100, 6));
    const dep2 = toWei(550, 6);
    const expectedShares2 = dep2 * dep1 / (dep1 + toWei(100, 6));
    await expect(catPool.connect(user2).depositLiquidity(dep2))
      .to.emit(catPool, "CatLiquidityDeposited")
      .withArgs(user2.address, dep2, expectedShares2);
    expect(await catShare.balanceOf(user2.address)).to.equal(expectedShares2);
  });

  it("Withdraw uses adapter when idle funds insufficient", async function () {
    const { catPool, user1, user2, adapter, catShare, owner, usdc } = await loadFixture(deployFixture);
    const dep1 = toWei(1000, 6);
    const dep2 = toWei(550, 6);
    await catPool.connect(user1).depositLiquidity(dep1);
    await catPool.connect(owner).flushToAdapter(dep1);
    await adapter.connect(owner).simulateYieldOrLoss(toWei(100, 6));
    await catPool.connect(user2).depositLiquidity(dep2);
    await catPool.connect(owner).flushToAdapter(dep2);

    const sharesToBurn = dep1 / 2n; // 500e6
    const totalValue = dep1 + dep2 + toWei(100, 6);
    const totalShares = await catShare.totalSupply();
    const expectedUsdc = sharesToBurn * totalValue / totalShares;

    const beforeBalance = await usdc.balanceOf(user1.address);
    await expect(catPool.connect(user1).withdrawLiquidity(sharesToBurn))
      .to.emit(catPool, "CatLiquidityWithdrawn")
      .withArgs(user1.address, expectedUsdc, sharesToBurn);
    expect(await usdc.balanceOf(user1.address)).to.equal(beforeBalance + expectedUsdc);
    expect(await adapter.totalValueHeld()).to.equal(totalValue - expectedUsdc);
  });

  it("flushToAdapter deposits idle funds", async function () {
    const { catPool, user1, adapter, owner } = await loadFixture(deployFixture);
    const amount = toWei(1000, 6);
    await catPool.connect(user1).depositLiquidity(amount);
    const flushAmount = toWei(600, 6);
    await expect(catPool.connect(owner).flushToAdapter(flushAmount))
      .to.emit(catPool, "DepositToAdapter")
      .withArgs(flushAmount);
    expect(await adapter.totalValueHeld()).to.equal(flushAmount);
    expect(await catPool.idleUSDC()).to.equal(amount - flushAmount);
  });

  it("receiveUsdcPremium increases idleUSDC", async function () {
    const { catPool, coverPoolAcc } = await loadFixture(deployFixture);
    const premium = toWei(200, 6);
    await expect(catPool.connect(coverPoolAcc).receiveUsdcPremium(premium))
      .to.emit(catPool, "UsdcPremiumReceived")
      .withArgs(premium);
    expect(await catPool.idleUSDC()).to.equal(premium);
  });

  it("drawFund pulls from adapter if needed", async function () {
    const { catPool, coverPoolAcc, user1, adapter, owner, usdc } = await loadFixture(deployFixture);
    const dep = toWei(1000, 6);
    await catPool.connect(user1).depositLiquidity(dep);
    await catPool.connect(owner).flushToAdapter(dep);
    const draw = toWei(700, 6);
    const before = await usdc.balanceOf(coverPoolAcc.address);
    await expect(catPool.connect(coverPoolAcc).drawFund(draw))
      .to.emit(catPool, "DrawFromFund")
      .withArgs(draw, draw);
    expect(await usdc.balanceOf(coverPoolAcc.address)).to.equal(before + draw);
    expect(await adapter.totalValueHeld()).to.equal(dep - draw);
  });

  it("Distributes and allows claiming protocol assets", async function () {
    const { catPool, coverPoolAcc, user1, Proto, catShare } = await loadFixture(deployFixture);
    const dep = toWei(1000, 6);
    await catPool.connect(user1).depositLiquidity(dep);
    const amount = toWei(100, 18);
    await expect(catPool.connect(coverPoolAcc).receiveProtocolAssetsForDistribution(Proto.target, amount))
      .to.emit(catPool, "ProtocolAssetReceivedForDistribution")
      .withArgs(Proto.target, amount);
    const claimable = await catPool.calculateClaimableProtocolAssetRewards(user1.address, Proto.target);
    expect(claimable).to.equal(toWei(100, 18));
    const before = await Proto.balanceOf(user1.address);
    await expect(catPool.connect(user1).claimProtocolAssetRewards([Proto.target]))
      .to.emit(catPool, "ProtocolAssetRewardsClaimed")
      .withArgs(user1.address, Proto.target, amount);
    expect(await Proto.balanceOf(user1.address)).to.equal(before + amount);
    expect(await catPool.calculateClaimableProtocolAssetRewards(user1.address, Proto.target)).to.equal(0);
  });
});
