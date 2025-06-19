const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { MaxUint256, parseUnits } = require("ethers");

const toWei = (val, decimals = 6) => parseUnits(val.toString(), decimals);

async function deployAaveFixture() {
  const [owner, user, other] = await ethers.getSigners();
  const ERC20 = await ethers.getContractFactory("MockERC20");
  const token = await ERC20.deploy("Mock Token", "MTK", 6);
  const aToken = await ERC20.deploy("Mock AToken", "aMTK", 6);

  const Pool = await ethers.getContractFactory("MockAaveV3Pool");
  const pool = await Pool.deploy(token.target, aToken.target);
  await aToken.transferOwnership(pool.target);

  const Adapter = await ethers.getContractFactory("AaveV3Adapter");
  const adapter = await Adapter.deploy(token.target, pool.target, aToken.target, owner.address);
  await adapter.setCapitalPoolAddress(user.address);

  const initial = toWei(1000);
  for (const acc of [owner, user]) {
    await token.mint(acc.address, initial);
    await token.connect(acc).approve(adapter.target, MaxUint256);
  }

  return { owner, user, other, token, aToken, pool, adapter };
}

async function deployCompoundFixture() {
  const [owner, user, other] = await ethers.getSigners();
  const ERC20 = await ethers.getContractFactory("MockERC20");
  const token = await ERC20.deploy("Mock Token", "MTK", 6);

  const Comet = await ethers.getContractFactory("MockComet");
  const comet = await Comet.deploy(token.target);

  const Adapter = await ethers.getContractFactory("CompoundV3Adapter");
  const adapter = await Adapter.deploy(comet.target, owner.address);
  await adapter.setCapitalPoolAddress(user.address);

  const initial = toWei(1000);
  for (const acc of [owner, user]) {
    await token.mint(acc.address, initial);
    await token.connect(acc).approve(adapter.target, MaxUint256);
  }

  return { owner, user, other, token, comet, adapter };
}

describe("AaveV3Adapter", function () {
  it("deploys with correct parameters", async function () {
    const { adapter, token, pool, aToken, owner } = await loadFixture(deployAaveFixture);
    expect(await adapter.asset()).to.equal(token.target);
    expect(await adapter.aavePool()).to.equal(pool.target);
    expect(await adapter.aToken()).to.equal(aToken.target);
    expect(await adapter.owner()).to.equal(owner.address);
  });

  it("allows deposits and withdrawals", async function () {
    const { adapter, token, aToken, pool, owner, user } = await loadFixture(deployAaveFixture);
    const amount = toWei(100);
    await adapter.connect(user).deposit(amount);

    expect(await aToken.balanceOf(adapter.target)).to.equal(amount);
    expect(await token.balanceOf(pool.target)).to.equal(amount);
    expect(await token.balanceOf(adapter.target)).to.equal(0);

    const before = await token.balanceOf(user.address);
    await expect(adapter.connect(user).withdraw(amount / 2n, user.address))
      .to.emit(adapter, "FundsWithdrawn")
      .withArgs(user.address, amount / 2n, amount / 2n);
    expect(await aToken.balanceOf(adapter.target)).to.equal(amount / 2n);
    expect(await token.balanceOf(user.address)).to.equal(before + amount / 2n);
  });

  it("only capital pool can withdraw", async function () {
    const { adapter, owner } = await loadFixture(deployAaveFixture);
    await expect(adapter.connect(owner).withdraw(1, owner.address))
      .to.be.revertedWith("AaveV3Adapter: Caller is not CapitalPool");
  });

  it("getCurrentValueHeld totals token and aToken", async function () {
    const { adapter, user } = await loadFixture(deployAaveFixture);
    const amount = toWei(50);
    await adapter.connect(user).deposit(amount);
    expect(await adapter.getCurrentValueHeld()).to.equal(amount);
  });
});

describe("CompoundV3Adapter", function () {
  it("deploys with correct parameters", async function () {
    const { adapter, token, comet, owner } = await loadFixture(deployCompoundFixture);
    expect(await adapter.asset()).to.equal(token.target);
    expect(await adapter.comet()).to.equal(comet.target);
    expect(await adapter.owner()).to.equal(owner.address);
  });

  it("handles deposit and withdrawal", async function () {
    const { adapter, token, comet, owner, user } = await loadFixture(deployCompoundFixture);
    const amount = toWei(80);
    await adapter.connect(user).deposit(amount);
    expect(await comet.balanceOf(adapter.target)).to.equal(amount);
    expect(await token.balanceOf(adapter.target)).to.equal(0);

    const before = await token.balanceOf(user.address);
    await expect(adapter.connect(user).withdraw(amount, user.address))
      .to.emit(adapter, "FundsWithdrawn")
      .withArgs(user.address, amount, amount);
    expect(await token.balanceOf(user.address)).to.equal(before + amount);
    expect(await comet.balanceOf(adapter.target)).to.equal(0);
  });

  it("only capital pool can withdraw", async function () {
    const { adapter, owner } = await loadFixture(deployCompoundFixture);
    await expect(adapter.connect(owner).withdraw(1, owner.address))
      .to.be.revertedWith("CompoundV3Adapter: Caller is not CapitalPool");
  });

  it("getCurrentValueHeld sums balances", async function () {
    const { adapter, user } = await loadFixture(deployCompoundFixture);
    const amount = toWei(40);
    await adapter.connect(user).deposit(amount);
    expect(await adapter.getCurrentValueHeld()).to.equal(amount);
  });
});
