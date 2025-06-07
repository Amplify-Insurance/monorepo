const { expect } = require("chai");
const { ethers: hardhatEthers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { MaxUint256, ZeroAddress, parseUnits } = require("ethers");

const toWei = (num, decimals = 18) => parseUnits(num.toString(), decimals);

async function deployAdapterFixture() {
  const [owner, depositor, other] = await hardhatEthers.getSigners();
  const MockERC20Factory = await hardhatEthers.getContractFactory("MockERC20");
  const token = await MockERC20Factory.deploy("Mock Token", "MTK", 6);

  const MockYieldAdapterFactory = await hardhatEthers.getContractFactory("MockYieldAdapter");
  const adapter = await MockYieldAdapterFactory.deploy(token.target, depositor.address, owner.address);

  const initialBalance = toWei(1000, 6);
  await token.connect(owner).mint(depositor.address, initialBalance);
  await token.connect(owner).mint(owner.address, initialBalance);

  await token.connect(depositor).approve(adapter.target, MaxUint256);
  await token.connect(owner).approve(adapter.target, MaxUint256);

  return { adapter, token, owner, depositor, other, initialBalance };
}

describe("MockYieldAdapter", function () {
  describe("Deployment", function () {
    it("sets underlying token, depositor and owner", async function () {
      const { adapter, token, owner, depositor } = await loadFixture(deployAdapterFixture);
      expect(await adapter.underlyingToken()).to.equal(token.target);
      expect(await adapter.asset()).to.equal(token.target);
      expect(await adapter.depositorContract()).to.equal(depositor.address);
      expect(await adapter.owner()).to.equal(owner.address);
    });
  });

  describe("Deposits and withdrawals", function () {
    it("allows depositor to deposit and withdraw", async function () {
      const { adapter, token, depositor } = await loadFixture(deployAdapterFixture);
      const amount = toWei(100, 6);

      await expect(adapter.connect(depositor).deposit(amount))
        .to.emit(adapter, "Deposited")
        .withArgs(depositor.address, amount);

      expect(await adapter.totalValueHeld()).to.equal(amount);
      expect(await token.balanceOf(adapter.target)).to.equal(amount);

      const withdrawAmount = toWei(60, 6);
      const beforeWithdrawBalance = await token.balanceOf(depositor.address);

      await expect(adapter.connect(depositor).withdraw(withdrawAmount, depositor.address))
        .to.emit(adapter, "Withdrawn")
        .withArgs(depositor.address, depositor.address, withdrawAmount, withdrawAmount);

      expect(await adapter.totalValueHeld()).to.equal(amount - withdrawAmount);
      expect(await token.balanceOf(depositor.address)).to.equal(beforeWithdrawBalance + withdrawAmount);
    });

    it("caps withdrawal by totalValueHeld and balance", async function () {
      const { adapter, token, depositor, owner } = await loadFixture(deployAdapterFixture);
      const amount = toWei(100, 6);
      await adapter.connect(depositor).deposit(amount);

      await adapter.connect(owner).simulateYieldOrLoss(toWei(50, 6)); // tvh = 150, balance = 100

      const withdrawn = await adapter.connect(depositor).withdraw(toWei(150, 6), depositor.address);
      const receipt = await withdrawn.wait();
      const event = receipt.logs.map(log => {
        try { return adapter.interface.parseLog(log); } catch (e) { return null; }
      }).find(e => e && e.name === "Withdrawn");

      expect(event.args.amountTransferred).to.equal(amount);
      expect(await adapter.totalValueHeld()).to.equal(toWei(50, 6));
      expect(await token.balanceOf(adapter.target)).to.equal(0);
    });

    it("getCurrentValueHeld reverts when flag set", async function () {
      const { adapter, owner, depositor } = await loadFixture(deployAdapterFixture);
      await adapter.connect(owner).setRevertOnNextGetCurrentValueHeld(true);

      await expect(adapter.connect(depositor).getCurrentValueHeld()).to.be.revertedWith(
        "MockAdapter: getCurrentValueHeld deliberately reverted for test"
      );
    });
  });

  describe("Yield adjustment functions", function () {
    it("simulateYieldOrLoss adjusts total value", async function () {
      const { adapter, owner, depositor } = await loadFixture(deployAdapterFixture);
      await adapter.connect(depositor).deposit(toWei(100, 6));

      await adapter.connect(owner).simulateYieldOrLoss(toWei(50, 6));
      expect(await adapter.totalValueHeld()).to.equal(toWei(150, 6));

      await adapter.connect(owner).simulateYieldOrLoss(-toWei(20, 6));
      expect(await adapter.totalValueHeld()).to.equal(toWei(130, 6));

      await adapter.connect(owner).simulateYieldOrLoss(-toWei(200, 6));
      expect(await adapter.totalValueHeld()).to.equal(0);
    });

    it("setTotalValueHeld overrides value", async function () {
      const { adapter, owner } = await loadFixture(deployAdapterFixture);
      await adapter.connect(owner).setTotalValueHeld(toWei(123, 6));
      expect(await adapter.totalValueHeld()).to.equal(toWei(123, 6));
    });
  });

  describe("Access control and admin functions", function () {
    it("only owner can set depositor", async function () {
      const { adapter, owner, depositor, other } = await loadFixture(deployAdapterFixture);
      await expect(adapter.connect(other).setDepositor(other.address))
        .to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount")
        .withArgs(other.address);

      await expect(adapter.connect(depositor).setDepositor(other.address))
        .to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount")
        .withArgs(depositor.address);

      await expect(adapter.connect(owner).setDepositor(ZeroAddress))
        .to.be.revertedWith("MockAdapter: New depositor cannot be zero address");

      await expect(adapter.connect(owner).setDepositor(other.address))
        .to.emit(adapter, "DepositorSet")
        .withArgs(other.address);
      expect(await adapter.depositorContract()).to.equal(other.address);
    });
  });
});

