const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Reset approve tokens", function () {
  it("CapitalPool supports tokens requiring allowance reset", async function () {
    const [owner, user] = await ethers.getSigners();
    const ResetToken = await ethers.getContractFactory("ResetApproveERC20");
    const token = await ResetToken.deploy("Reset", "RST", 6);
    await token.mint(user.address, ethers.parseUnits("10000", 6));

    const MockAdapter = await ethers.getContractFactory("MockYieldAdapter");
    const adapter = await MockAdapter.deploy(token.target, ethers.ZeroAddress, owner.address);
    const MockRisk = await ethers.getContractFactory("MockRiskManager");
    const risk = await MockRisk.deploy();

    const CapitalPool = await ethers.getContractFactory("CapitalPool");
    const pool = await CapitalPool.deploy(owner.address, token.target);
    await pool.setRiskManager(risk.target);
    await pool.setBaseYieldAdapter(1, adapter.target);
    await adapter.setDepositor(pool.target);

    const amt = ethers.parseUnits("1000", 6);
    await token.connect(user).approve(pool.target, amt * 2n);

    await pool.connect(user).deposit(amt, 1);
    await expect(pool.connect(user).deposit(amt, 1)).to.not.be.reverted;
  });

  it("PolicyManager drains premium with reset token", async function () {
    const [owner, user] = await ethers.getSigners();
    const ResetToken = await ethers.getContractFactory("ResetApproveERC20");
    const token = await ResetToken.deploy("Reset", "RST", 6);
    await token.mint(user.address, ethers.parseUnits("10000", 6));

    const MockPoolRegistry = await ethers.getContractFactory("MockPoolRegistry");
    const MockCapitalPool = await ethers.getContractFactory("MockCapitalPool");
    const MockBackstopPool = await ethers.getContractFactory("MockBackstopPool");
    const MockPolicyNFT = await ethers.getContractFactory("MockPolicyNFT");
    const MockRewardDistributor = await ethers.getContractFactory("MockRewardDistributor");
    const MockRiskManager = await ethers.getContractFactory("MockRiskManagerHook");

    const poolRegistry = await MockPoolRegistry.deploy();
    const capitalPool = await MockCapitalPool.deploy(owner.address, token.target);
    const catPool = await MockBackstopPool.deploy(owner.address);
    const policyNFT = await MockPolicyNFT.deploy(owner.address);
    const rewards = await MockRewardDistributor.deploy();
    const risk = await MockRiskManager.deploy();

    const PolicyManager = await ethers.getContractFactory("PolicyManager");
    const pm = await PolicyManager.deploy(policyNFT.target, owner.address);
    await policyNFT.setCoverPoolAddress(pm.target);
    await pm.setAddresses(poolRegistry.target, capitalPool.target, catPool.target, rewards.target, risk.target);

    await poolRegistry.setPoolData(0, token.target, ethers.parseUnits("100000", 6), 0, 0, false, owner.address, 0);
    const rate = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
    await poolRegistry.setRateModel(0, rate);

    await token.connect(user).approve(pm.target, ethers.MaxUint256);
    await pm.connect(user).purchaseCover(0, ethers.parseUnits("10000", 6), ethers.parseUnits("100", 6));

    await time.increase(24 * 60 * 60);
    await token.connect(user).transfer(pm.target, ethers.parseUnits("100", 6));
    await pm.connect(user).addPremium(1, ethers.parseUnits("1", 6));
    await time.increase(24 * 60 * 60);
    await token.connect(user).transfer(pm.target, ethers.parseUnits("100", 6));
    await expect(
      pm.connect(user).addPremium(1, ethers.parseUnits("1", 6))
    ).to.be.revertedWith("ResetApproveERC20: must set 0 first");
  });
});
