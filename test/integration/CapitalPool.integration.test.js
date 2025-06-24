const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Integration tests for CapitalPool using the real RiskManager and supporting contracts.
 * A lightweight SimpleYieldAdapter is used instead of mocks for yield functionality.
 */
describe("CapitalPool Integration", function () {
  let owner, user, committee;
  let token, adapter, capitalPool, riskManager;
  const PLATFORM_AAVE = 1;

  beforeEach(async () => {
    [owner, user, committee] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("ResetApproveERC20");
    token = await Token.deploy("USD", "USD", 6);
    await token.mint(owner.address, ethers.parseUnits("1000000", 6));

    const Adapter = await ethers.getContractFactory("SimpleYieldAdapter");
    adapter = await Adapter.deploy(token.target, ethers.ZeroAddress, owner.address);

    const CapitalPool = await ethers.getContractFactory("CapitalPool");
    capitalPool = await CapitalPool.deploy(owner.address, token.target);
    await capitalPool.setBaseYieldAdapter(PLATFORM_AAVE, adapter.target);
    await adapter.setDepositor(capitalPool.target);

    // deploy minimal real system for RiskManager
    const PoolRegistry = await ethers.getContractFactory("PoolRegistry");
    const poolRegistry = await PoolRegistry.deploy(owner.address, owner.address);
    const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
    const policyNFT = await PolicyNFT.deploy(ethers.ZeroAddress, owner.address);
    const PolicyManager = await ethers.getContractFactory("PolicyManager");
    const policyManager = await PolicyManager.deploy(policyNFT.target, owner.address);
    await policyNFT.setPolicyManagerAddress(policyManager.target);
    const CatShare = await ethers.getContractFactory("CatShare");
    const catShare = await CatShare.deploy();
    const CatPool = await ethers.getContractFactory("CatInsurancePool");
    const catPool = await CatPool.deploy(token.target, catShare.target, adapter.target, owner.address);
    await catShare.transferOwnership(catPool.target);
    await catPool.initialize();
    const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
    const rewardDistributor = await RewardDistributor.deploy(owner.address);
    await rewardDistributor.setCatPool(catPool.target);
    const LossDistributor = await ethers.getContractFactory("LossDistributor");
    const lossDistributor = await LossDistributor.deploy(owner.address);

    const RiskManager = await ethers.getContractFactory("RiskManager");
    riskManager = await RiskManager.deploy(owner.address);
    await riskManager.setAddresses(
      capitalPool.target,
      poolRegistry.target,
      policyManager.target,
      catPool.target,
      lossDistributor.target,
      rewardDistributor.target
    );
    await riskManager.setCommittee(committee.address);
    await poolRegistry.setRiskManager(riskManager.target);

    await capitalPool.setRiskManager(riskManager.target);

    // seed the pool so share value starts at 1
    await token.approve(capitalPool.target, ethers.MaxUint256);
    await capitalPool.deposit(ethers.parseUnits("1000", 6), PLATFORM_AAVE);

    await token.transfer(user.address, ethers.parseUnits("1000", 6));
    await token.connect(user).approve(capitalPool.target, ethers.MaxUint256);
  });

  it("updates RiskManager pledge on deposit", async () => {
    const amt = ethers.parseUnits("500", 6);
    await capitalPool.connect(user).deposit(amt, PLATFORM_AAVE);
    expect(await riskManager.underwriterTotalPledge(user.address)).to.equal(amt);
  });

  it("handles deposit and full withdrawal lifecycle", async () => {
    const amt = ethers.parseUnits("200", 6);
    await capitalPool.connect(user).deposit(amt, PLATFORM_AAVE);
    const shares = (await capitalPool.getUnderwriterAccount(user.address)).masterShares;
    await capitalPool.connect(user).requestWithdrawal(shares);
    await time.increase(1);
    await capitalPool.connect(user).executeWithdrawal(0);
    expect(await token.balanceOf(user.address)).to.equal(ethers.parseUnits("1000", 6));
    expect(await riskManager.underwriterTotalPledge(user.address)).to.equal(0);
  });

  it("partial withdrawal adjusts pledge proportionally", async () => {
    const amt = ethers.parseUnits("300", 6);
    await capitalPool.connect(user).deposit(amt, PLATFORM_AAVE);
    const halfShares = (await capitalPool.getUnderwriterAccount(user.address)).masterShares / 2n;
    await capitalPool.connect(user).requestWithdrawal(halfShares);
    await time.increase(1);
    await capitalPool.connect(user).executeWithdrawal(0);
    const remaining = await riskManager.underwriterTotalPledge(user.address);
    expect(remaining).to.equal(amt / 2n);
  });

  it("risk manager address can execute payout", async () => {
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

    await ethers.provider.send("hardhat_impersonateAccount", [riskManager.target]);
    await ethers.provider.send("hardhat_setBalance", [riskManager.target, "0x1000000000000000000"]);
    const rm = await ethers.getSigner(riskManager.target);
    await capitalPool.connect(rm).executePayout(payout);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);
    expect(await token.balanceOf(user.address)).to.equal(payoutAmount);
  });

  it("handles multiple deposits and yield", async () => {
    const first = ethers.parseUnits("1000", 6);
    await capitalPool.connect(user).deposit(first, PLATFORM_AAVE);

    const yieldGain = ethers.parseUnits("100", 6);
    await token.mint(adapter.target, yieldGain);
    await adapter.setTotalValueHeld(first + yieldGain);
    await capitalPool.syncYieldAndAdjustSystemValue();

    const second = ethers.parseUnits("500", 6);
    await token.mint(user.address, second);
    await token.connect(user).approve(capitalPool.target, 0);
    await token.connect(user).approve(capitalPool.target, ethers.MaxUint256);
    await capitalPool.connect(user).deposit(second, PLATFORM_AAVE);

    const account = await capitalPool.getUnderwriterAccount(user.address);
    expect(account.masterShares).to.be.gt(first);
  });

  it("syncs yield and updates system value", async () => {
    const amount = ethers.parseUnits("1000", 6);
    await capitalPool.connect(user).deposit(amount, PLATFORM_AAVE);
    const gain = ethers.parseUnits("50", 6);
    await token.mint(adapter.target, gain);
    await adapter.setTotalValueHeld(amount + gain);
    await capitalPool.syncYieldAndAdjustSystemValue();
    expect(await capitalPool.totalSystemValue()).to.equal(amount + gain);
  });

  it("applyLosses reduces principal and burns shares", async () => {
    const depositAmount = ethers.parseUnits("1000", 6);
    await capitalPool.connect(user).deposit(depositAmount, PLATFORM_AAVE);
    const loss = ethers.parseUnits("300", 6);
    await ethers.provider.send("hardhat_impersonateAccount", [riskManager.target]);
    await ethers.provider.send("hardhat_setBalance", [riskManager.target, "0x1000000000000000000"]);
    const rm = await ethers.getSigner(riskManager.target);
    await capitalPool.connect(rm).applyLosses(user.address, loss);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);
    const account = await capitalPool.getUnderwriterAccount(user.address);
    expect(account.totalDepositedAssetPrincipal).to.equal(depositAmount - loss);
  });

  it("reverts on invalid deposit parameters", async () => {
    await expect(capitalPool.connect(user).deposit(0, PLATFORM_AAVE)).to.be.revertedWithCustomError(capitalPool, "InvalidAmount");
    await expect(capitalPool.connect(user).deposit(100, 2)).to.be.revertedWithCustomError(capitalPool, "AdapterNotConfigured");
  });

  it("reverts when RiskManager call fails on deposit", async () => {
    await capitalPool.setRiskManager(adapter.target); // adapter has no hook function
    await expect(capitalPool.connect(user).deposit(1, PLATFORM_AAVE)).to.be.revertedWith("CP: Failed to notify RiskManager of deposit");
  });

  it("reverts when RiskManager call fails on cancellation", async () => {
    const amount = ethers.parseUnits("100", 6);
    await capitalPool.connect(user).deposit(amount, PLATFORM_AAVE);
    const shares = (await capitalPool.getUnderwriterAccount(user.address)).masterShares;
    await capitalPool.connect(user).requestWithdrawal(shares);
    await capitalPool.setRiskManager(adapter.target);
    await expect(capitalPool.connect(user).cancelWithdrawalRequest(0)).to.be.revertedWith(
      "CP: RiskManager rejected withdrawal cancellation"
    );
  });
  it("prevents changing yield platform without withdrawal", async () => {
    const amt = ethers.parseUnits("100", 6);
    await capitalPool.connect(user).deposit(amt, PLATFORM_AAVE);
    const Adapter = await ethers.getContractFactory("SimpleYieldAdapter");
    const otherAdapter = await Adapter.deploy(token.target, ethers.ZeroAddress, owner.address);
    await otherAdapter.setDepositor(capitalPool.target);
    await capitalPool.setBaseYieldAdapter(2, otherAdapter.target);
    await expect(capitalPool.connect(user).deposit(amt, 2)).to.be.revertedWith(
      "CP: Cannot change yield platform; withdraw first."
    );
  });

  it("enforces notice period before withdrawal execution", async () => {
    await capitalPool.setUnderwriterNoticePeriod(10);
    await capitalPool.connect(user).deposit(1, PLATFORM_AAVE);
    const shares = (await capitalPool.getUnderwriterAccount(user.address)).masterShares;
    await capitalPool.connect(user).requestWithdrawal(shares);
    await expect(capitalPool.connect(user).executeWithdrawal(0)).to.be.revertedWithCustomError(
      capitalPool,
      "NoticePeriodActive"
    );
    await time.increase(10);
    await capitalPool.connect(user).executeWithdrawal(0);
  });

  it("reverts when RiskManager call fails on executeWithdrawal", async () => {
    await capitalPool.connect(user).deposit(1, PLATFORM_AAVE);
    const shares = (await capitalPool.getUnderwriterAccount(user.address)).masterShares;
    await capitalPool.connect(user).requestWithdrawal(shares);
    await capitalPool.setRiskManager(adapter.target);
    await time.increase(1);
    await expect(capitalPool.connect(user).executeWithdrawal(0)).to.be.revertedWith(
      "CP: Failed to notify RiskManager of withdrawal"
    );
  });

  it("setBaseYieldAdapter reverts if asset mismatched", async () => {
    const Token = await ethers.getContractFactory("ResetApproveERC20");
    const other = await Token.deploy("OTHER", "OTHER", 6);
    const Adapter = await ethers.getContractFactory("SimpleYieldAdapter");
    const otherAdapter = await Adapter.deploy(other.target, ethers.ZeroAddress, owner.address);
    await otherAdapter.setDepositor(capitalPool.target);
    await expect(capitalPool.setBaseYieldAdapter(2, otherAdapter.target)).to.be.revertedWith(
      "CP: Adapter asset mismatch"
    );
  });

  it("setBaseYieldAdapter restricted to owner", async () => {
    const Adapter = await ethers.getContractFactory("SimpleYieldAdapter");
    const newAdapter = await Adapter.deploy(token.target, ethers.ZeroAddress, owner.address);
    await newAdapter.setDepositor(capitalPool.target);
    await expect(capitalPool.connect(user).setBaseYieldAdapter(2, newAdapter.target))
      .to.be.revertedWithCustomError(capitalPool, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
  });

  it("allows cancelling a withdrawal request", async () => {
    const amt = ethers.parseUnits("150", 6);
    await capitalPool.connect(user).deposit(amt, PLATFORM_AAVE);
    const shares = (await capitalPool.getUnderwriterAccount(user.address)).masterShares;
    await capitalPool.connect(user).requestWithdrawal(shares);
    await capitalPool.connect(user).cancelWithdrawalRequest(0);
    const account = await capitalPool.getUnderwriterAccount(user.address);
    expect(account.totalPendingWithdrawalShares).to.equal(0);
    expect(await capitalPool.getWithdrawalRequestCount(user.address)).to.equal(0);
  });

  it("reverts if losses applied after withdrawal request", async () => {
    const amt = ethers.parseUnits("400", 6);
    await capitalPool.connect(user).deposit(amt, PLATFORM_AAVE);
    const shares = (await capitalPool.getUnderwriterAccount(user.address)).masterShares;
    await capitalPool.connect(user).requestWithdrawal(shares);

    const loss = ethers.parseUnits("100", 6);
    await ethers.provider.send("hardhat_impersonateAccount", [riskManager.target]);
    await ethers.provider.send("hardhat_setBalance", [riskManager.target, "0x1000000000000000"]);
    const rm = await ethers.getSigner(riskManager.target);
    await capitalPool.connect(rm).applyLosses(user.address, loss);
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);

    await time.increase(1);
    await expect(capitalPool.connect(user).executeWithdrawal(0)).to.be.revertedWithCustomError(
      capitalPool,
      "InconsistentState"
    );
  });

  it("returns correct adapter address for underwriter", async () => {
    const amt = ethers.parseUnits("50", 6);
    await capitalPool.connect(user).deposit(amt, PLATFORM_AAVE);
    expect(await capitalPool.getUnderwriterAdapterAddress(user.address)).to.equal(adapter.target);
  });
});
