const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { parseUnits } = require("ethers");

const toWei = (val, decimals = 18) => parseUnits(val.toString(), decimals);

async function deployFixture() {
  const [owner, user, other] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockERC20");
  const dai = await Token.deploy("DAI", "DAI", 18);
  const Sdai = await ethers.getContractFactory("MockSdai");
  const sdai = await Sdai.deploy(dai.target);
  const Adapter = await ethers.getContractFactory("SdaiAdapter");
  const adapter = await Adapter.deploy(dai.target, sdai.target, owner.address);

  const initial = toWei(1000);
  for (const acc of [owner, user]) {
    await dai.mint(acc.address, initial);
    await dai.connect(acc).approve(adapter.target, initial);
  }

  return { owner, user, other, dai, sdai, adapter };
}

describe("SdaiAdapter", function () {
  it("deploys with correct parameters", async function () {
    const { adapter, dai, sdai, owner } = await loadFixture(deployFixture);
    expect(await adapter.asset()).to.equal(dai.target);
    expect(await adapter.sDai()).to.equal(sdai.target);
    expect(await adapter.owner()).to.equal(owner.address);
  });

  it("handles deposit and withdrawal", async function () {
    const { adapter, sdai, dai, owner, user } = await loadFixture(deployFixture);
    const amount = toWei(50);
    await adapter.connect(user).deposit(amount);
    expect(await sdai.balanceOf(adapter.target)).to.equal(amount);
    expect(await dai.balanceOf(user.address)).to.equal(toWei(1000) - amount);

    const before = await dai.balanceOf(user.address);
    await expect(adapter.connect(owner).withdraw(amount / 2n, user.address))
      .to.emit(adapter, "FundsWithdrawn")
      .withArgs(user.address, amount / 2n, amount / 2n);
    expect(await dai.balanceOf(user.address)).to.equal(before + amount / 2n);
    expect(await sdai.balanceOf(adapter.target)).to.equal(amount / 2n);
  });

  it("only owner can withdraw", async function () {
    const { adapter, user } = await loadFixture(deployFixture);
    await expect(adapter.connect(user).withdraw(1, user.address))
      .to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
  });

  it("getCurrentValueHeld sums balances", async function () {
    const { adapter, user } = await loadFixture(deployFixture);
    const amount = toWei(40);
    await adapter.connect(user).deposit(amount);
    expect(await adapter.getCurrentValueHeld()).to.equal(amount);
  });
});
