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
});
