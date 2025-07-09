const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("CapitalPool", function () {
  let owner, riskManager, user1, user2, feeRecipient, claimant, nonParty;
  let capitalPool;
  let mockAdapter1;
  let mockAdapter2;
  let mockUsdc;
  let riskManagerContract;

  const INITIAL_SHARES_LOCKED = 1000n;
  const YIELD_PLATFORM_1 = 1;
  const YIELD_PLATFORM_2 = 2;
  const NOTICE_PERIOD = 24 * 60 * 60; // 1 day

  beforeEach(async () => {
    [owner, riskManager, user1, user2, feeRecipient, claimant, nonParty] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUsdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await mockUsdc.mint(owner.address, ethers.parseUnits("20000000", 6));


    const MockYieldAdapter = await ethers.getContractFactory("MockYieldAdapter");
    mockAdapter1 = await MockYieldAdapter.deploy(mockUsdc.target, ethers.ZeroAddress, owner.address);
    mockAdapter2 = await MockYieldAdapter.deploy(mockUsdc.target, ethers.ZeroAddress, owner.address);

    const CapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
    capitalPool = await CapitalPoolFactory.deploy(owner.address, mockUsdc.target);
    await capitalPool.setUnderwriterNoticePeriod(NOTICE_PERIOD);

    await mockAdapter1.connect(owner).setDepositor(capitalPool.target);
    await mockAdapter2.connect(owner).setDepositor(capitalPool.target);

    await mockUsdc.transfer(user1.address, ethers.parseUnits("10000", 6));
    await mockUsdc.transfer(user2.address, ethers.parseUnits("10000", 6));
    await mockUsdc.connect(user1).approve(capitalPool.target, ethers.MaxUint256);
    await mockUsdc.connect(user2).approve(capitalPool.target, ethers.MaxUint256);
  });

  describe("Deployment & Admin Functions", () => {
    it("Should deploy with correct initial state", async () => {
      expect(await capitalPool.owner()).to.equal(owner.address);
      expect(await capitalPool.underlyingAsset()).to.equal(mockUsdc.target);
      expect(await capitalPool.totalMasterSharesSystem()).to.equal(INITIAL_SHARES_LOCKED);
    });

    it("Should allow owner to set RiskManager and revert if already set", async () => {
      await expect(capitalPool.connect(owner).setRiskManager(riskManager.address))
        .to.emit(capitalPool, "RiskManagerSet").withArgs(riskManager.address);
      expect(await capitalPool.riskManager()).to.equal(riskManager.address);
    });

    it("Should allow owner to set Base Yield Adapters", async () => {
      await expect(capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_1, mockAdapter1.target))
        .to.emit(capitalPool, "BaseYieldAdapterSet").withArgs(YIELD_PLATFORM_1, mockAdapter1.target);
      expect(await capitalPool.baseYieldAdapters(YIELD_PLATFORM_1)).to.equal(mockAdapter1.target);
      expect(await capitalPool.activeYieldAdapterAddresses(0)).to.equal(mockAdapter1.target);
    });

    it("Should revert if adapter asset does not match", async () => {
      const BadMockERC20 = await ethers.getContractFactory("MockERC20");
      const badUsdc = await BadMockERC20.deploy("Bad Coin", "BDC", 6);
      const BadAdapter = await ethers.getContractFactory("MockYieldAdapter");
      const badAdapter = await BadAdapter.deploy(badUsdc.target, ethers.ZeroAddress, owner.address);
      await badAdapter.connect(owner).setDepositor(capitalPool.target);
      await expect(capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_1, badAdapter.target))
        .to.be.revertedWith("CP: Adapter asset mismatch");
    });

    it("Should allow owner to update notice period", async () => {
      await expect(capitalPool.connect(owner).setUnderwriterNoticePeriod(3600))
        .to.emit(capitalPool, "UnderwriterNoticePeriodSet")
        .withArgs(3600);
      expect(await capitalPool.underwriterNoticePeriod()).to.equal(3600);
    });

    it("setRiskManager reverts for zero address", async () => {
      await expect(capitalPool.connect(owner).setRiskManager(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(capitalPool, "ZeroAddress");
    });

    it("setRiskManager restricted to owner", async () => {
      await expect(capitalPool.connect(user1).setRiskManager(riskManager.address))
        .to.be.revertedWithCustomError(capitalPool, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });

    it("setBaseYieldAdapter reverts for NONE platform", async () => {
      await expect(capitalPool.connect(owner).setBaseYieldAdapter(0, mockAdapter1.target))
        .to.be.revertedWith("CP: Cannot set for NONE platform");
    });

    it("setBaseYieldAdapter reverts for zero address", async () => {
      await expect(capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_1, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(capitalPool, "ZeroAddress");
    });

    it("setBaseYieldAdapter requires contract address", async () => {
      await expect(capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_1, user1.address))
        .to.be.revertedWith("CP: Adapter address is not a contract");
    });

    it("setBaseYieldAdapter restricted to owner", async () => {
      await expect(capitalPool.connect(user1).setBaseYieldAdapter(YIELD_PLATFORM_1, mockAdapter1.target))
        .to.be.revertedWithCustomError(capitalPool, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });

    it("setUnderwriterNoticePeriod restricted to owner", async () => {
      await expect(capitalPool.connect(user1).setUnderwriterNoticePeriod(1))
        .to.be.revertedWithCustomError(capitalPool, "OwnableUnauthorizedAccount")
        .withArgs(user1.address);
    });
  });

  describe("Edge Cases Without RiskManager", () => {
    beforeEach(async () => {
      await capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_1, mockAdapter1.target);
    });

    it("deposit should succeed when RiskManager is unset", async () => {
      await expect(capitalPool.connect(user1).deposit(100, YIELD_PLATFORM_1))
        .to.not.be.reverted;
    });

    it("deposit should revert when RiskManager call fails", async () => {
      await capitalPool.connect(owner).setRiskManager(mockUsdc.target);
      await expect(capitalPool.connect(user1).deposit(100, YIELD_PLATFORM_1))
        .to.be.revertedWith("CP: Failed to notify RiskManager of deposit");
    });
  });

  context("With RiskManager and Adapters Set", () => {
    beforeEach(async () => {
      await capitalPool.connect(owner).setRiskManager(riskManager.address);
      await capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_1, mockAdapter1.target);
      await capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_2, mockAdapter2.target);
    });

    describe("Deposit", () => {
      const DEPOSIT_AMOUNT = ethers.parseUnits("1000", 6);

      it("Should handle a first deposit correctly", async () => {
        await expect(capitalPool.connect(user1).deposit(DEPOSIT_AMOUNT, YIELD_PLATFORM_1))
          .to.emit(capitalPool, "Deposit")
          .withArgs(user1.address, DEPOSIT_AMOUNT, DEPOSIT_AMOUNT, YIELD_PLATFORM_1);

        const account = await capitalPool.getUnderwriterAccount(user1.address);
        expect(account.masterShares).to.equal(DEPOSIT_AMOUNT);
        expect(await capitalPool.totalSystemValue()).to.equal(DEPOSIT_AMOUNT);
        expect(await mockAdapter1.totalValueHeld()).to.equal(DEPOSIT_AMOUNT);
      });

      it("Should handle a second deposit correctly, calculating shares based on NAV", async () => {
        await capitalPool.connect(user1).deposit(DEPOSIT_AMOUNT, YIELD_PLATFORM_1);

        const yieldGained = ethers.parseUnits("100", 6);
        await mockUsdc.connect(owner).mint(mockAdapter1.target, yieldGained);
        await mockAdapter1.connect(owner).simulateYieldOrLoss(yieldGained);

        await capitalPool.connect(owner).syncYieldAndAdjustSystemValue();

        const expectedShares = (DEPOSIT_AMOUNT * (await capitalPool.totalMasterSharesSystem())) / (DEPOSIT_AMOUNT + yieldGained);

        await expect(capitalPool.connect(user2).deposit(DEPOSIT_AMOUNT, YIELD_PLATFORM_1))
          .to.emit(capitalPool, "Deposit")
          .withArgs(user2.address, DEPOSIT_AMOUNT, expectedShares, YIELD_PLATFORM_1);
      });

      it("Should revert if user tries to change yield platform", async () => {
        await capitalPool.connect(user1).deposit(DEPOSIT_AMOUNT, YIELD_PLATFORM_1);
        await expect(capitalPool.connect(user1).deposit(DEPOSIT_AMOUNT, YIELD_PLATFORM_2))
          .to.be.revertedWith("CP: Cannot change yield platform; withdraw first.");
      });

      it("Should revert if deposit amount is zero", async () => {
        await expect(capitalPool.connect(user1).deposit(0, YIELD_PLATFORM_1))
          .to.be.revertedWithCustomError(capitalPool, "InvalidAmount");
      });

      it("Should revert if adapter is not configured", async () => {
        await expect(capitalPool.connect(user1).deposit(DEPOSIT_AMOUNT, 3))
          .to.be.revertedWithCustomError(capitalPool, "AdapterNotConfigured");
      });

      it("Should revert if yield platform is NONE", async () => {
        await expect(capitalPool.connect(user1).deposit(DEPOSIT_AMOUNT, 0))
          .to.be.revertedWithCustomError(capitalPool, "AdapterNotConfigured");
      });

      it("requestWithdrawal reverts when no deposit", async () => {
        await expect(capitalPool.connect(user1).requestWithdrawal(1))
          .to.be.revertedWithCustomError(capitalPool, "InsufficientShares");
      });
    });

    describe("Withdrawal Lifecycle", () => {
      const DEPOSIT_AMOUNT = ethers.parseUnits("1000", 6);

      beforeEach(async () => {
        await capitalPool.connect(user1).deposit(DEPOSIT_AMOUNT, YIELD_PLATFORM_1);
      });

      it("Should request a withdrawal successfully", async () => {
        const account = await capitalPool.getUnderwriterAccount(user1.address);
        const sharesToWithdraw = account.masterShares / 2n;

        await expect(capitalPool.connect(user1).requestWithdrawal(sharesToWithdraw))
          .to.emit(capitalPool, "WithdrawalRequested")
          .withArgs(user1.address, sharesToWithdraw, anyValue, 0);

        const updatedAccount = await capitalPool.getUnderwriterAccount(user1.address);
        expect(updatedAccount.totalPendingWithdrawalShares).to.equal(sharesToWithdraw);
        expect(await capitalPool.getWithdrawalRequestCount(user1.address)).to.equal(1);
      });

      it("Allows multiple concurrent withdrawal requests", async () => {
        const shares = (await capitalPool.getUnderwriterAccount(user1.address)).masterShares;
        const half = shares / 2n;
        await capitalPool.connect(user1).requestWithdrawal(half);
        await capitalPool.connect(user1).requestWithdrawal(half);
        const updated = await capitalPool.getUnderwriterAccount(user1.address);
        expect(updated.totalPendingWithdrawalShares).to.equal(shares);
        expect(await capitalPool.getWithdrawalRequestCount(user1.address)).to.equal(2);
      });

      it("Should revert if executing withdrawal before notice period ends", async () => {
        await capitalPool.connect(user1).requestWithdrawal(100);
        await expect(capitalPool.connect(user1).executeWithdrawal(0))
          .to.be.revertedWithCustomError(capitalPool, "NoticePeriodActive");
      });

      it("Should revert if executeWithdrawal called with no request", async () => {
        await expect(capitalPool.connect(user1).executeWithdrawal(0))
          .to.be.revertedWithCustomError(capitalPool, "InvalidRequestIndex");
      });

      it("Should revert if shares burned exceed current balance", async () => {
        const sharesToBurn = (await capitalPool.getUnderwriterAccount(user1.address)).masterShares;
        await capitalPool.connect(user1).requestWithdrawal(sharesToBurn);
        await capitalPool.connect(riskManager).applyLosses(user1.address, ethers.parseUnits("500", 6));
        await time.increase(NOTICE_PERIOD);
        await expect(capitalPool.connect(user1).executeWithdrawal(0))
          .to.be.revertedWithCustomError(capitalPool, "InconsistentState");
      });

      it("Should revert if requesting more shares than owned", async () => {
        await expect(capitalPool.connect(user1).requestWithdrawal(DEPOSIT_AMOUNT + 1n))
          .to.be.revertedWithCustomError(capitalPool, "InsufficientShares");
      });

      it("Should revert if request amount is zero", async () => {
        await expect(capitalPool.connect(user1).requestWithdrawal(0))
          .to.be.revertedWithCustomError(capitalPool, "InvalidAmount");
      });

      it("Should cancel a withdrawal request", async () => {
        const account = await capitalPool.getUnderwriterAccount(user1.address);
        const sharesToWithdraw = account.masterShares / 2n;
        await capitalPool.connect(user1).requestWithdrawal(sharesToWithdraw);
        await expect(capitalPool.connect(user1).cancelWithdrawalRequest(0))
          .to.emit(capitalPool, "WithdrawalRequestCancelled")
          .withArgs(user1.address, sharesToWithdraw, 0);
        const updated = await capitalPool.getUnderwriterAccount(user1.address);
        expect(updated.totalPendingWithdrawalShares).to.equal(0);
        expect(await capitalPool.getWithdrawalRequestCount(user1.address)).to.equal(0);
      });

      it("cancelWithdrawalRequest reverts when no request", async () => {
        await expect(capitalPool.connect(user1).cancelWithdrawalRequest(0))
          .to.be.revertedWithCustomError(capitalPool, "InvalidRequestIndex");
      });

      it("Should revert if RiskManager notification fails during executeWithdrawal", async () => {
        const sharesToBurn = (await capitalPool.getUnderwriterAccount(user1.address)).masterShares;
        await capitalPool.connect(user1).requestWithdrawal(sharesToBurn);
        await capitalPool.connect(owner).setRiskManager(mockUsdc.target);
        await time.increase(NOTICE_PERIOD);
        await expect(capitalPool.connect(user1).executeWithdrawal(0))
          .to.be.revertedWith("CP: Failed to notify RiskManager of withdrawal");
      });

      it("Should execute a partial withdrawal successfully", async () => {
        const sharesToBurn = (await capitalPool.getUnderwriterAccount(user1.address)).masterShares / 2n;
        await capitalPool.connect(user1).requestWithdrawal(sharesToBurn);
        await time.increase(NOTICE_PERIOD);

        const valueToWithdraw = await capitalPool.sharesToValue(sharesToBurn);

        const principalRemoved = (await capitalPool.getUnderwriterAccount(user1.address)).totalDepositedAssetPrincipal / 2n;

        await expect(capitalPool.connect(user1).executeWithdrawal(0))
          .to.emit(capitalPool, "WithdrawalExecuted")
          .withArgs(user1.address, anyValue, sharesToBurn, 0);

        expect(await capitalPool.getWithdrawalRequestCount(user1.address)).to.equal(0);
        const finalAccount = await capitalPool.getUnderwriterAccount(user1.address);
        expect(finalAccount.totalPendingWithdrawalShares).to.equal(0);
        expect(finalAccount.masterShares).to.be.gt(0);
      });

      it("Should execute a full withdrawal successfully, cleaning up state", async () => {
        const sharesToBurn = (await capitalPool.getUnderwriterAccount(user1.address)).masterShares;
        await capitalPool.connect(user1).requestWithdrawal(sharesToBurn);
        await time.increase(NOTICE_PERIOD);

        const valueToWithdraw = await capitalPool.sharesToValue(sharesToBurn);

        const principalRemoved = (await capitalPool.getUnderwriterAccount(user1.address)).totalDepositedAssetPrincipal;

        await expect(capitalPool.connect(user1).executeWithdrawal(0))
          .to.emit(capitalPool, "WithdrawalExecuted")
          .withArgs(user1.address, anyValue, sharesToBurn, 0);

        expect(await capitalPool.getWithdrawalRequestCount(user1.address)).to.equal(0);
        const finalAccount = await capitalPool.getUnderwriterAccount(user1.address);
        expect(finalAccount.totalDepositedAssetPrincipal).to.equal(0);
        expect(finalAccount.masterShares).to.equal(0);
      });
    });

    describe("RiskManager Only Functions", () => {
      const DEPOSIT_1 = ethers.parseUnits("6000", 6);
      const DEPOSIT_2 = ethers.parseUnits("4000", 6);

      beforeEach(async () => {
        await capitalPool.connect(user1).deposit(DEPOSIT_1, YIELD_PLATFORM_1);
        await capitalPool.connect(user2).deposit(DEPOSIT_2, YIELD_PLATFORM_2);

        const MockCatPool = await ethers.getContractFactory("MockBackstopPool");
        const catPool = await MockCatPool.deploy(owner.address);
        const RM = await ethers.getContractFactory("MockRiskManagerWithBackstop");
        riskManagerContract = await RM.deploy(catPool.target);
        await catPool.setCoverPoolAddress(capitalPool.target);
        await capitalPool.connect(owner).setRiskManager(riskManagerContract.target);
      });

      it("executePayout should withdraw from adapters proportionally", async () => {
        const payoutAmount = ethers.parseUnits("1000", 6);
        const payoutData = {
          claimant: claimant.address,
          claimantAmount: payoutAmount,
          feeRecipient: ethers.ZeroAddress,
          feeAmount: 0,
          adapters: [mockAdapter1.target, mockAdapter2.target],
          capitalPerAdapter: [DEPOSIT_1, DEPOSIT_2],
          totalCapitalFromPoolLPs: DEPOSIT_1 + DEPOSIT_2,
        };

        await mockUsdc.connect(owner).mint(mockAdapter1.target, payoutAmount);
        await mockAdapter1.connect(owner).setTotalValueHeld(DEPOSIT_1 + payoutAmount);
        await mockUsdc.connect(owner).mint(mockAdapter2.target, payoutAmount);
        await mockAdapter2.connect(owner).setTotalValueHeld(DEPOSIT_2 + payoutAmount);
        await riskManagerContract.executePayout(capitalPool.target, payoutData);
        expect(await mockUsdc.balanceOf(claimant.address)).to.equal(payoutAmount);
      });

      it("executePayout should revert if payout exceeds pool capital", async () => {
        const payoutData = {
          claimant: claimant.address,
          claimantAmount: DEPOSIT_1 + DEPOSIT_2,
          feeRecipient: ethers.ZeroAddress,
          feeAmount: 1,
          adapters: [],
          capitalPerAdapter: [],
          totalCapitalFromPoolLPs: DEPOSIT_1 + DEPOSIT_2,
        };
        await expect(riskManagerContract.executePayout(capitalPool.target, payoutData))
          .to.be.revertedWithCustomError(capitalPool, "PayoutExceedsPoolLPCapital");
      });

      it("executePayout draws from Cat pool if adapters lack funds", async () => {
        const payoutAmount = ethers.parseUnits("1000", 6);
        const payoutData = {
          claimant: claimant.address,
          claimantAmount: payoutAmount,
          feeRecipient: ethers.ZeroAddress,
          feeAmount: 0,
          adapters: [mockAdapter1.target],
          capitalPerAdapter: [DEPOSIT_1 + DEPOSIT_2],
          totalCapitalFromPoolLPs: DEPOSIT_1 + DEPOSIT_2,
        };

        await mockAdapter1.setTotalValueHeld(0);
        await expect(riskManagerContract.executePayout(capitalPool.target, payoutData))
          .to.be.revertedWith("CP: Payout failed, insufficient funds gathered");
      });

      it("handles rounding shortfall across adapters", async () => {
        const payoutAmount = ethers.parseUnits("1001", 6);
        const payoutData = {
          claimant: claimant.address,
          claimantAmount: payoutAmount,
          feeRecipient: ethers.ZeroAddress,
          feeAmount: 0,
          adapters: [mockAdapter1.target, mockAdapter2.target],
          capitalPerAdapter: [DEPOSIT_1, DEPOSIT_2],
          totalCapitalFromPoolLPs: DEPOSIT_1 + DEPOSIT_2,
        };

        await mockUsdc.connect(owner).mint(mockAdapter1.target, payoutAmount);
        await mockAdapter1.connect(owner).setTotalValueHeld(DEPOSIT_1 + payoutAmount);
        await mockUsdc.connect(owner).mint(mockAdapter2.target, payoutAmount);
        await mockAdapter2.connect(owner).setTotalValueHeld(DEPOSIT_2 + payoutAmount);

        await expect(riskManagerContract.executePayout(capitalPool.target, payoutData))
          .to.not.be.reverted;
        const catAddr2 = await riskManagerContract.catPool();
        const cat2 = await ethers.getContractAt("MockBackstopPool", catAddr2);
        expect(await cat2.drawFundCallCount()).to.equal(0);
        expect(await mockUsdc.balanceOf(claimant.address)).to.equal(payoutAmount);
      });

      it("executePayout uses emergencyTransfer when withdraw reverts", async () => {
        const RevertingAdapter = await ethers.getContractFactory("RevertingAdapter");
        const revAdapter = await RevertingAdapter.deploy(mockUsdc.target);
        await capitalPool.connect(owner).setBaseYieldAdapter(3, revAdapter.target);

        const payoutAmount = ethers.parseUnits("500", 6);
        const payoutData = {
          claimant: claimant.address,
          claimantAmount: payoutAmount,
          feeRecipient: ethers.ZeroAddress,
          feeAmount: 0,
          adapters: [revAdapter.target],
          capitalPerAdapter: [payoutAmount],
          totalCapitalFromPoolLPs: payoutAmount,
        };

        await mockUsdc.connect(owner).mint(revAdapter.target, payoutAmount);
        await mockUsdc.connect(owner).mint(capitalPool.target, payoutAmount);

        const MockCatPool = await ethers.getContractFactory("MockBackstopPool");
        const catPool = await MockCatPool.deploy(owner.address);
        const RM = await ethers.getContractFactory("MockRiskManagerWithBackstop");
        const rm = await RM.deploy(catPool.target);
        await catPool.setCoverPoolAddress(capitalPool.target);
        await capitalPool.connect(owner).setRiskManager(rm.target);

        await rm.executePayout(capitalPool.target, payoutData);
        expect(await mockUsdc.balanceOf(claimant.address)).to.equal(payoutAmount * 2n);
        expect(await catPool.drawFundCallCount()).to.equal(0);
      });

      it("executePayout calls drawFund if emergencyTransfer sends zero", async () => {
        const AdapterNoTransfer = await ethers.getContractFactory("RevertingAdapterNoTransfer");
        const noSendAdapter = await AdapterNoTransfer.deploy(mockUsdc.target);
        await capitalPool.connect(owner).setBaseYieldAdapter(3, noSendAdapter.target);

        const payoutAmount = ethers.parseUnits("500", 6);
        const payoutData = {
          claimant: claimant.address,
          claimantAmount: payoutAmount,
          feeRecipient: ethers.ZeroAddress,
          feeAmount: 0,
          adapters: [noSendAdapter.target],
          capitalPerAdapter: [payoutAmount],
          totalCapitalFromPoolLPs: payoutAmount,
        };

        await mockUsdc.connect(owner).mint(capitalPool.target, payoutAmount);

        const MockCatPool = await ethers.getContractFactory("MockBackstopPool");
        const catPool = await MockCatPool.deploy(owner.address);
        const RM = await ethers.getContractFactory("MockRiskManagerWithBackstop");
        const rm = await RM.deploy(catPool.target);
        await catPool.setCoverPoolAddress(capitalPool.target);
        await capitalPool.connect(owner).setRiskManager(rm.target);

        await rm.executePayout(capitalPool.target, payoutData);
        expect(await mockUsdc.balanceOf(claimant.address)).to.equal(payoutAmount);
        expect(await catPool.drawFundCallCount()).to.equal(1);
      });

      it("applyLosses should burn shares and reduce principal", async () => {
        const lossAmount = ethers.parseUnits("1000", 6);
        const initialAccount = await capitalPool.getUnderwriterAccount(user1.address);
        await riskManagerContract.applyLossesOnPool(capitalPool.target, user1.address, lossAmount);
        const finalAccount = await capitalPool.getUnderwriterAccount(user1.address);
        expect(finalAccount.totalDepositedAssetPrincipal).to.equal(initialAccount.totalDepositedAssetPrincipal - lossAmount);
        expect(finalAccount.masterShares).to.be.lt(initialAccount.masterShares);
      });

      it("applyLosses should wipe out an underwriter if losses exactly equal principal", async () => {
        const lossAmount = DEPOSIT_1;
        await riskManagerContract.applyLossesOnPool(capitalPool.target, user1.address, lossAmount);
        const finalAccount = await capitalPool.getUnderwriterAccount(user1.address);
        expect(finalAccount.masterShares).to.equal(0);
        expect(finalAccount.totalDepositedAssetPrincipal).to.equal(0);
      });

      it("applyLosses should revert with InvalidAmount if loss is zero", async () => {
        await expect(riskManagerContract.applyLossesOnPool(capitalPool.target, user1.address, 0))
          .to.be.revertedWithCustomError(capitalPool, "InvalidAmount");
      });

      it("applyLosses should revert if underwriter has no deposit", async () => {
        await expect(riskManagerContract.applyLossesOnPool(capitalPool.target, nonParty.address, ethers.parseUnits("1", 6)))
          .to.be.revertedWithCustomError(capitalPool, "NoActiveDeposit");
      });
    });

    describe("Keeper & View Functions", () => {
      it("syncYieldAndAdjustSystemValue should update totalSystemValue", async () => {
        const depositAmount = ethers.parseUnits("1000", 6);
        await capitalPool.connect(user1).deposit(depositAmount, YIELD_PLATFORM_1);

        const yieldGained = ethers.parseUnits("50", 6);
        await mockUsdc.connect(owner).mint(mockAdapter1.target, yieldGained);
        await mockAdapter1.connect(owner).simulateYieldOrLoss(yieldGained);

        await expect(capitalPool.connect(nonParty).syncYieldAndAdjustSystemValue())
          .to.emit(capitalPool, "SystemValueSynced")
          .withArgs(depositAmount + yieldGained, depositAmount);

        expect(await capitalPool.totalSystemValue()).to.equal(depositAmount + yieldGained);
      });

      it("syncYieldAndAdjustSystemValue should emit event if an adapter call fails", async () => {
        await mockAdapter1.connect(owner).setRevertOnNextGetCurrentValueHeld(true);
        await expect(capitalPool.connect(nonParty).syncYieldAndAdjustSystemValue())
          .to.emit(capitalPool, "AdapterCallFailed")
          .withArgs(mockAdapter1.target, "getCurrentValueHeld", "MockAdapter: getCurrentValueHeld deliberately reverted for test");
      });
    });

    describe("Access Control and Security", () => {
      it("should revert if a non-RiskManager calls applyLosses", async () => {
        await expect(capitalPool.connect(nonParty).applyLosses(user1.address, 1))
          .to.be.revertedWith("CP: Caller is not the RiskManager");
      });

      it("should revert if a non-RiskManager calls executePayout", async () => {
        const payoutData = { claimant: claimant.address, claimantAmount: 0, feeRecipient: ethers.ZeroAddress, feeAmount: 0, adapters: [], capitalPerAdapter: [], totalCapitalFromPoolLPs: 0 };
        await expect(capitalPool.connect(nonParty).executePayout(payoutData))
          .to.be.revertedWith("CP: Caller is not the RiskManager");
      });

      it("Should prevent re-entrancy on deposit", async () => {
        const MaliciousAdapter = await ethers.getContractFactory("MaliciousAdapter");
        const maliciousAdapter = await MaliciousAdapter.deploy(capitalPool.target, mockUsdc.target);
        await capitalPool.connect(owner).setBaseYieldAdapter(3, maliciousAdapter.target);
        await expect(capitalPool.connect(user1).deposit(ethers.parseUnits("100", 6), 3))
          .to.not.be.reverted;
      });

      it("Should prevent re-entrancy on executeWithdrawal", async () => {
        const MaliciousAdapter = await ethers.getContractFactory("MaliciousAdapter");
        const maliciousAdapter = await MaliciousAdapter.deploy(capitalPool.target, mockUsdc.target);
        await capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_1, maliciousAdapter.target);
        await capitalPool.connect(user1).deposit(ethers.parseUnits("1000", 6), YIELD_PLATFORM_1);
        await maliciousAdapter.setWithdrawArgs((await capitalPool.getUnderwriterAccount(user1.address)).masterShares);
        await capitalPool.connect(user1).requestWithdrawal((await capitalPool.getUnderwriterAccount(user1.address)).masterShares);
        await time.increase(NOTICE_PERIOD);
        await expect(capitalPool.connect(user1).executeWithdrawal(0))
          .to.be.reverted; // withdrawLiquidity will revert, preventing reentrancy
      });
    });

    describe("Additional Edge Cases", () => {
      it("deposit should revert when resulting shares equal zero", async () => {
        const bigDeposit = ethers.parseUnits("1000", 6);
        await capitalPool.connect(user1).deposit(bigDeposit, YIELD_PLATFORM_1);
        await mockUsdc.connect(owner).mint(mockAdapter1.target, bigDeposit * 100n);
        await mockAdapter1.connect(owner).setTotalValueHeld(bigDeposit * 101n);
        await capitalPool.connect(owner).syncYieldAndAdjustSystemValue();
        await expect(capitalPool.connect(user2).deposit(1, YIELD_PLATFORM_1))
          .to.be.revertedWithCustomError(capitalPool, "NoSharesToMint");
      });

      it("requestWithdrawal should revert when RiskManager rejects", async () => {
        const MockRM = await ethers.getContractFactory("MockRiskManager");
        const mockRM = await MockRM.deploy();
        await capitalPool.connect(owner).setRiskManager(mockRM.target);
        await capitalPool.connect(user1).deposit(1000, YIELD_PLATFORM_1);
        await mockRM.setShouldReject(true);
        await expect(capitalPool.connect(user1).requestWithdrawal(1000))
          .to.be.revertedWith("CP: RiskManager rejected withdrawal request");
      });

      it("getUnderwriterAdapterAddress should return correct adapter", async () => {
        await capitalPool.connect(user1).deposit(1000, YIELD_PLATFORM_1);
        expect(await capitalPool.getUnderwriterAdapterAddress(user1.address)).to.equal(mockAdapter1.target);
      });

      it("allows an underwriter to deposit multiple times", async () => {
        const first = ethers.parseUnits("1000", 6);
        const second = ethers.parseUnits("500", 6);
        await capitalPool.connect(user1).deposit(first, YIELD_PLATFORM_1);
        const tvBefore = await capitalPool.totalSystemValue();
        const msBefore = await capitalPool.totalMasterSharesSystem();
        const expectedShares = (second * msBefore) / tvBefore;
        await expect(capitalPool.connect(user1).deposit(second, YIELD_PLATFORM_1))
          .to.emit(capitalPool, "Deposit")
          .withArgs(user1.address, second, expectedShares, YIELD_PLATFORM_1);
        const account = await capitalPool.getUnderwriterAccount(user1.address);
        expect(account.masterShares).to.equal(first + expectedShares);
        expect(account.totalDepositedAssetPrincipal).to.equal(first + second);
      });

      it("valueToShares and sharesToValue round-trip", async () => {
        const depositAmount = ethers.parseUnits("1000", 6);
        await capitalPool.connect(user1).deposit(depositAmount, YIELD_PLATFORM_1);
        const testValue = ethers.parseUnits("100", 6);
        const shares = await capitalPool.valueToShares(testValue);
        const value = await capitalPool.sharesToValue(shares);
        expect(value).to.equal(testValue);
      });

      it("sharesToValue returns zero when shares is zero", async () => {
        expect(await capitalPool.sharesToValue(0)).to.equal(0);
      });

      it("valueToShares returns input when system value is zero", async () => {
        const someValue = ethers.parseUnits("50", 6);
        expect(await capitalPool.valueToShares(someValue)).to.equal(someValue);
      });

      it("valueToShares returns zero when amount is zero even after deposits", async () => {
        const depositAmount = ethers.parseUnits("1000", 6);
        await capitalPool.connect(user1).deposit(depositAmount, YIELD_PLATFORM_1);
        expect(await capitalPool.valueToShares(0)).to.equal(0);
      });

      it("does not duplicate adapters when set multiple times", async () => {
        await capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_1, mockAdapter1.target);
        await expect(capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_1, mockAdapter1.target))
          .to.emit(capitalPool, "BaseYieldAdapterSet")
          .withArgs(YIELD_PLATFORM_1, mockAdapter1.target);
        expect(await capitalPool.activeYieldAdapterAddresses(0)).to.equal(mockAdapter1.target);
        expect(await capitalPool.activeYieldAdapterAddresses(1)).to.equal(mockAdapter2.target);
        await expect(capitalPool.activeYieldAdapterAddresses(2)).to.be.reverted;
      });

      it("executePayout distributes fee to feeRecipient", async () => {
        const payoutAmount = ethers.parseUnits("500", 6);
        const payoutData = {
          claimant: claimant.address,
          claimantAmount: payoutAmount,
          feeRecipient: feeRecipient.address,
          feeAmount: payoutAmount,
          adapters: [mockAdapter1.target],
          capitalPerAdapter: [payoutAmount * 2n],
          totalCapitalFromPoolLPs: payoutAmount * 2n,
        };

        await mockUsdc.connect(owner).mint(mockAdapter1.target, payoutAmount * 2n);
        await mockAdapter1.connect(owner).setTotalValueHeld(payoutAmount * 2n);
        const MockCatPool = await ethers.getContractFactory("MockBackstopPool");
        const catPool = await MockCatPool.deploy(owner.address);
        const RM = await ethers.getContractFactory("MockRiskManagerWithBackstop");
        const rm = await RM.deploy(catPool.target);
        await catPool.setCoverPoolAddress(capitalPool.target);
        await capitalPool.connect(owner).setRiskManager(rm.target);
        await capitalPool.connect(user1).deposit(payoutAmount * 2n, YIELD_PLATFORM_1);

        await rm.executePayout(capitalPool.target, payoutData);
        expect(await mockUsdc.balanceOf(feeRecipient.address)).to.equal(payoutAmount);
        expect(await mockUsdc.balanceOf(claimant.address)).to.equal(payoutAmount);
      });
    });
  });
  });
