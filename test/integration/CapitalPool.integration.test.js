const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CapitalPool Integration", function () {
  let owner, user;
  let token, adapter, riskManager, capitalPool;

  const PLATFORM_AAVE = 1;

  beforeEach(async () => {
    [owner, user] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    token = await Token.deploy("USD", "USD", 6);
    await token.mint(owner.address, ethers.parseUnits("1000000", 6));

    const Adapter = await ethers.getContractFactory("MockYieldAdapter");
    adapter = await Adapter.deploy(token.target, ethers.ZeroAddress, owner.address);

    const Risk = await ethers.getContractFactory("MockRiskManager");
    riskManager = await Risk.deploy();

    const Pool = await ethers.getContractFactory("CapitalPool");
    capitalPool = await Pool.deploy(owner.address, token.target);
    await capitalPool.setRiskManager(riskManager.target);
    await capitalPool.setBaseYieldAdapter(PLATFORM_AAVE, adapter.target);
    await adapter.setDepositor(capitalPool.target);

    await token.transfer(user.address, ethers.parseUnits("1000", 6));
    await token.connect(user).approve(capitalPool.target, ethers.MaxUint256);
  });

  it("notifies RiskManager on deposit", async () => {
    const amount = ethers.parseUnits("500", 6);
    await expect(capitalPool.connect(user).deposit(amount, PLATFORM_AAVE))
      .to.emit(riskManager, "CapitalDeposited")
      .withArgs(user.address, amount);
  });

  it("notifies RiskManager through withdrawal lifecycle", async () => {
    const amount = ethers.parseUnits("200", 6);
    await capitalPool.connect(user).deposit(amount, PLATFORM_AAVE);
    const shares = (await capitalPool.getUnderwriterAccount(user.address)).masterShares;
    const expectedValue = await capitalPool.sharesToValue(shares);

    await expect(capitalPool.connect(user).requestWithdrawal(shares))
      .to.emit(riskManager, "WithdrawalRequested")
      .withArgs(user.address, expectedValue);

    // zero notice period by default
    await time.increase(1);

    await expect(capitalPool.connect(user).executeWithdrawal())
      .to.emit(riskManager, "CapitalWithdrawn")
      .withArgs(user.address, amount, true);
  });

  it("reverts when RiskManager rejects withdrawal request", async () => {
    const amount = ethers.parseUnits("200", 6);
    await capitalPool.connect(user).deposit(amount, PLATFORM_AAVE);
    await riskManager.setShouldReject(true);
    const shares = (await capitalPool.getUnderwriterAccount(user.address)).masterShares;
    await expect(
      capitalPool.connect(user).requestWithdrawal(shares)
    ).to.be.revertedWith("CP: RiskManager rejected withdrawal request");
  });

  it("emits CapitalWithdrawn with partial flag on partial withdrawal", async () => {
    const amount = ethers.parseUnits("300", 6);
    await capitalPool.connect(user).deposit(amount, PLATFORM_AAVE);
    const account = await capitalPool.getUnderwriterAccount(user.address);
    const shares = account.masterShares;
    const half = shares / 2n;
    const expectedPrincipal = (account.totalDepositedAssetPrincipal * half) / shares;
    await capitalPool.connect(user).requestWithdrawal(half);
    await time.increase(1);
    await expect(capitalPool.connect(user).executeWithdrawal())
      .to.emit(riskManager, "CapitalWithdrawn")
      .withArgs(user.address, expectedPrincipal, false);
  });

  it("RiskManagerWithCat can execute payout via capital pool", async () => {
    const CatPool = await ethers.getContractFactory("MockCatInsurancePool");
    const cat = await CatPool.deploy(owner.address);
    const RM = await ethers.getContractFactory("MockRiskManagerWithCat");
    const rm = await RM.deploy(cat.target);
    await cat.setCoverPoolAddress(capitalPool.target);
    await capitalPool.setRiskManager(rm.target);

    const depositAmount = ethers.parseUnits("1000", 6);
    await capitalPool.connect(user).deposit(depositAmount, PLATFORM_AAVE);

    const payoutAmount = ethers.parseUnits("500", 6);
    const payout = {
      claimant: user.address,
      claimantAmount: payoutAmount,
      feeRecipient: ethers.ZeroAddress,
      feeAmount: 0,
      adapters: [adapter.target],
      capitalPerAdapter: [depositAmount],
      totalCapitalFromPoolLPs: depositAmount,
    };

    await token.mint(adapter.target, payoutAmount);
    await adapter.setTotalValueHeld(depositAmount + payoutAmount);

    await expect(rm.executePayout(capitalPool.target, payout)).to.not.be.reverted;
    expect(await token.balanceOf(user.address)).to.equal(payoutAmount);
  });

  it("handles multiple deposits and share accounting after yield", async () => {
    const first = ethers.parseUnits("1000", 6);
    await capitalPool.connect(user).deposit(first, PLATFORM_AAVE);

    const yieldGain = ethers.parseUnits("100", 6);
    await token.mint(adapter.target, yieldGain);
    await adapter.setTotalValueHeld(first + yieldGain);

    await capitalPool.syncYieldAndAdjustSystemValue();

    const msBefore = await capitalPool.totalMasterSharesSystem();
    const tvBefore = await capitalPool.totalSystemValue();

    const second = ethers.parseUnits("500", 6);
    await token.mint(user.address, second);
    await token.connect(user).approve(capitalPool.target, ethers.MaxUint256);
    const expectedShares = (second * msBefore) / tvBefore;
    await expect(capitalPool.connect(user).deposit(second, PLATFORM_AAVE))
      .to.emit(capitalPool, "Deposit")
      .withArgs(user.address, second, expectedShares, PLATFORM_AAVE);

    const account = await capitalPool.getUnderwriterAccount(user.address);
    expect(account.masterShares).to.equal(first + expectedShares);
  });

  it("syncs yield and updates system value", async () => {
    const amount = ethers.parseUnits("1000", 6);
    await capitalPool.connect(user).deposit(amount, PLATFORM_AAVE);

    const gain = ethers.parseUnits("50", 6);
    await token.mint(adapter.target, gain);
    await adapter.setTotalValueHeld(amount + gain);

    await expect(capitalPool.syncYieldAndAdjustSystemValue())
      .to.emit(capitalPool, "SystemValueSynced")
      .withArgs(amount + gain, amount);
    expect(await capitalPool.totalSystemValue()).to.equal(amount + gain);
  });

  it("applyLosses reduces principal and burns shares", async () => {
    const CatPool = await ethers.getContractFactory("MockCatInsurancePool");
    const cat = await CatPool.deploy(owner.address);
    const RM = await ethers.getContractFactory("MockRiskManagerWithCat");
    const rm = await RM.deploy(cat.target);
    await cat.setCoverPoolAddress(capitalPool.target);
    await capitalPool.setRiskManager(rm.target);

    const depositAmount = ethers.parseUnits("1000", 6);
    await capitalPool.connect(user).deposit(depositAmount, PLATFORM_AAVE);

    const loss = ethers.parseUnits("300", 6);
    await expect(rm.applyLossesOnPool(capitalPool.target, user.address, loss))
      .to.emit(capitalPool, "LossesApplied")
      .withArgs(user.address, loss, false);

    const account = await capitalPool.getUnderwriterAccount(user.address);
    expect(account.totalDepositedAssetPrincipal).to.equal(depositAmount - loss);
    expect(account.masterShares).to.equal(depositAmount - loss);
  });

  it("reverts on invalid deposit parameters", async () => {
    await expect(capitalPool.connect(user).deposit(0, PLATFORM_AAVE))
      .to.be.revertedWithCustomError(capitalPool, "InvalidAmount");
    await expect(capitalPool.connect(user).deposit(100, 2))
      .to.be.revertedWithCustomError(capitalPool, "AdapterNotConfigured");
  });
});
