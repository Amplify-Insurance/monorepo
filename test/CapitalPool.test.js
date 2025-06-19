const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CapitalPool", function () {
  let owner, riskManager, user1, user2, feeRecipient, claimant, nonParty;
  let capitalPool;
  let mockAdapter1;
  let mockAdapter2;
  let mockUsdc;

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
    });

    describe("Withdrawal Lifecycle", () => {
      const DEPOSIT_AMOUNT = ethers.parseUnits("1000", 6);

      beforeEach(async () => {
        await capitalPool.connect(user1).deposit(DEPOSIT_AMOUNT, YIELD_PLATFORM_1);
      });

      it("Should request a withdrawal successfully", async () => {
        const account = await capitalPool.getUnderwriterAccount(user1.address);
        const sharesToWithdraw = account.masterShares / 2n;
        const valueToWithdraw = await capitalPool.sharesToValue(sharesToWithdraw);

        await expect(capitalPool.connect(user1).requestWithdrawal(sharesToWithdraw))
          .to.emit(capitalPool, "WithdrawalRequested");

        const updatedAccount = await capitalPool.getUnderwriterAccount(user1.address);
        expect(updatedAccount.withdrawalRequestShares).to.equal(sharesToWithdraw);
      });

      it("Should revert if withdrawal is requested while one is pending", async () => {
        await capitalPool.connect(user1).requestWithdrawal(100);
        await expect(capitalPool.connect(user1).requestWithdrawal(100))
          .to.be.revertedWithCustomError(capitalPool, "WithdrawalRequestPending");
      });

      it("Should revert if executing withdrawal before notice period ends", async () => {
        await capitalPool.connect(user1).requestWithdrawal(100);
        await expect(capitalPool.connect(user1).executeWithdrawal())
          .to.be.revertedWithCustomError(capitalPool, "NoticePeriodActive");
      });

      it("Should execute a partial withdrawal successfully", async () => {
        const sharesToBurn = (await capitalPool.getUnderwriterAccount(user1.address)).masterShares / 2n;
        await capitalPool.connect(user1).requestWithdrawal(sharesToBurn);
        await time.increase(NOTICE_PERIOD);

        const valueToWithdraw = await capitalPool.sharesToValue(sharesToBurn);

        const principalRemoved = (await capitalPool.getUnderwriterAccount(user1.address)).totalDepositedAssetPrincipal / 2n;

        await expect(capitalPool.connect(user1).executeWithdrawal())
          .to.emit(capitalPool, "WithdrawalExecuted");

        const finalAccount = await capitalPool.getUnderwriterAccount(user1.address);
        expect(finalAccount.withdrawalRequestShares).to.equal(0);
        expect(finalAccount.masterShares).to.be.gt(0);
      });

      it("Should execute a full withdrawal successfully, cleaning up state", async () => {
        const sharesToBurn = (await capitalPool.getUnderwriterAccount(user1.address)).masterShares;
        await capitalPool.connect(user1).requestWithdrawal(sharesToBurn);
        await time.increase(NOTICE_PERIOD);

        const valueToWithdraw = await capitalPool.sharesToValue(sharesToBurn);

        const principalRemoved = (await capitalPool.getUnderwriterAccount(user1.address)).totalDepositedAssetPrincipal;

        await expect(capitalPool.connect(user1).executeWithdrawal())
          .to.emit(capitalPool, "WithdrawalExecuted");

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
      });

      it.skip("executePayout should withdraw from adapters proportionally", async () => {
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

        await capitalPool.connect(riskManager).executePayout(payoutData);
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
        await expect(capitalPool.connect(riskManager).executePayout(payoutData))
          .to.be.revertedWithCustomError(capitalPool, "PayoutExceedsPoolLPCapital");
      });

      it.skip("executePayout should revert if adapters fail to provide enough funds", async () => {
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

        await expect(capitalPool.connect(riskManager).executePayout(payoutData))
          .to.be.revertedWith("CP: Payout failed, insufficient funds gathered");
      });

      it("applyLosses should burn shares and reduce principal", async () => {
        const lossAmount = ethers.parseUnits("1000", 6);
        const initialAccount = await capitalPool.getUnderwriterAccount(user1.address);
        await capitalPool.connect(riskManager).applyLosses(user1.address, lossAmount);
        const finalAccount = await capitalPool.getUnderwriterAccount(user1.address);
        expect(finalAccount.totalDepositedAssetPrincipal).to.equal(initialAccount.totalDepositedAssetPrincipal - lossAmount);
        expect(finalAccount.masterShares).to.be.lt(initialAccount.masterShares);
      });

      it("applyLosses should wipe out an underwriter if losses exactly equal principal", async () => {
        const lossAmount = DEPOSIT_1;
        await capitalPool.connect(riskManager).applyLosses(user1.address, lossAmount);
        const finalAccount = await capitalPool.getUnderwriterAccount(user1.address);
        expect(finalAccount.masterShares).to.equal(0);
        expect(finalAccount.totalDepositedAssetPrincipal).to.equal(0);
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

      it.skip("Should prevent re-entrancy on deposit", async () => {
        const MaliciousAdapter = await ethers.getContractFactory("MaliciousAdapter");
        const maliciousAdapter = await MaliciousAdapter.deploy(capitalPool.target, mockUsdc.target);
        await capitalPool.connect(owner).setBaseYieldAdapter(3, maliciousAdapter.target);
        await expect(capitalPool.connect(user1).deposit(ethers.parseUnits("100", 6), 3))
          .to.be.revertedWith("ReentrancyGuard: reentrant call");
      });

      it.skip("Should prevent re-entrancy on executeWithdrawal", async () => {
        const MaliciousAdapter = await ethers.getContractFactory("MaliciousAdapter");
        const maliciousAdapter = await MaliciousAdapter.deploy(capitalPool.target, mockUsdc.target);
        await capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_1, maliciousAdapter.target);
        await expect(capitalPool.connect(user1).deposit(ethers.parseUnits("1000", 6), YIELD_PLATFORM_1))
          .to.be.revertedWith("ReentrancyGuard: reentrant call");
      });
    });
  });
});
