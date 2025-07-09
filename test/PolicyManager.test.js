// test/PolicyManager.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Deploy the Solidity based mocks used in the tests
async function deployMocks(owner, usdcAddress) {
    const MockPoolRegistry = await ethers.getContractFactory("MockPoolRegistry");
    const MockCapitalPool = await ethers.getContractFactory("MockCapitalPool");
    const MockBackstopPool = await ethers.getContractFactory("MockBackstopPool");
    const MockPolicyNFT = await ethers.getContractFactory("MockPolicyNFT");
    const MockRewardDistributor = await ethers.getContractFactory("MockRewardDistributor");
    const MockRiskManager = await ethers.getContractFactory("MockRiskManagerHook");

    const poolRegistry = await MockPoolRegistry.deploy();
    const capitalPool = await MockCapitalPool.deploy(owner.address, usdcAddress);
    const catPool = await MockBackstopPool.deploy(owner.address);
    const policyNFT = await MockPolicyNFT.deploy(owner.address);
    const rewardDistributor = await MockRewardDistributor.deploy();
    const riskManager = await MockRiskManager.deploy();

    return { poolRegistry, capitalPool, catPool, policyNFT, rewardDistributor, riskManager };
}

describe("PolicyManager", function () {
    // --- Signers ---
    let owner, user1, user2;

    // --- Contracts ---
    let policyManager;
    let mockPoolRegistry, mockCapitalPool, mockCatPool, mockPolicyNFT, mockRewardDistributor, mockRiskManager, mockUsdc;

    // --- Constants ---
    const POOL_ID = 0;
    const COVERAGE_AMOUNT = ethers.parseUnits("10000", 6); // 10,000 USDC
    const INITIAL_PREMIUM_DEPOSIT = ethers.parseUnits("100", 6); // 100 USDC
    const SECS_YEAR = 365 * 24 * 60 * 60;
    const BPS = 10000;
    const COOLDOWN_PERIOD = 5 * 24 * 60 * 60; // 5 days

    // --- Helper ABI for ERC20 ---
    const erc20Abi = require("@openzeppelin/contracts/build/contracts/ERC20.json").abi;


    beforeEach(async function () {
        // --- Get Signers ---
        [owner, user1, user2] = await ethers.getSigners();

        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        mockUsdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);

        // --- Deploy Mocks ---
        ({ poolRegistry: mockPoolRegistry, capitalPool: mockCapitalPool, catPool: mockCatPool, policyNFT: mockPolicyNFT, rewardDistributor: mockRewardDistributor, riskManager: mockRiskManager } = await deployMocks(owner, mockUsdc.target));
        
        // --- Deploy PolicyManager ---
        const PolicyManagerFactory = await ethers.getContractFactory("PolicyManager");
        policyManager = await PolicyManagerFactory.deploy(mockPolicyNFT.target, owner.address);
        await mockPolicyNFT.setCoverPoolAddress(policyManager.target);

        // --- Initial Setup ---
        await mockUsdc.mint(owner.address, ethers.parseUnits("20000", 6));
        await mockUsdc.transfer(user1.address, ethers.parseUnits("10000", 6));
        await mockUsdc.transfer(user2.address, ethers.parseUnits("10000", 6));

        // User1 approves PolicyManager to spend USDC
        await mockUsdc.connect(user1).approve(policyManager.target, ethers.MaxUint256);

    });

    describe("Admin Functions", function () {
        it("Should set addresses correctly", async function () {
            await expect(policyManager.connect(owner).setAddresses(
                mockPoolRegistry.target,
                mockCapitalPool.target,
                mockCatPool.target,
                mockRewardDistributor.target,
                mockRiskManager.target
            )).to.emit(policyManager, "AddressesSet");

            expect(await policyManager.poolRegistry()).to.equal(mockPoolRegistry.target);
            expect(await policyManager.capitalPool()).to.equal(mockCapitalPool.target);
            expect(await policyManager.catPool()).to.equal(mockCatPool.target);
            expect(await policyManager.rewardDistributor()).to.equal(mockRewardDistributor.target);
            expect(await policyManager.riskManager()).to.equal(mockRiskManager.target);
        });
        
        it("Should prevent non-owner from setting addresses", async function() {
            await expect(policyManager.connect(user1).setAddresses(
                mockPoolRegistry.target,
                mockCapitalPool.target,
                mockCatPool.target,
                mockRewardDistributor.target,
                mockRiskManager.target
            )).to.be.revertedWithCustomError(policyManager, "OwnableUnauthorizedAccount");
        });

        it("Should prevent setting zero addresses", async function() {
            await expect(policyManager.connect(owner).setAddresses(
                ethers.ZeroAddress,
                mockCapitalPool.target,
                mockCatPool.target,
                mockRewardDistributor.target,
                mockRiskManager.target
            )).to.be.revertedWith("PM: Cannot set zero address");
        });

        it("Should set CAT premium share BPS", async function () {
            await expect(policyManager.connect(owner).setCatPremiumShareBps(2500))
                .to.emit(policyManager, "CatPremiumShareSet").withArgs(2500);
            expect(await policyManager.catPremiumBps()).to.equal(2500);
        });

        it("Should prevent non-owner from setting CAT premium share BPS", async function() {
            await expect(policyManager.connect(user1).setCatPremiumShareBps(2500))
                .to.be.revertedWithCustomError(policyManager, "OwnableUnauthorizedAccount");
        });
        
        it("Should prevent setting CAT premium share over 50%", async function() {
            await expect(policyManager.connect(owner).setCatPremiumShareBps(5001))
                .to.be.revertedWith("PM: Max share is 50%");
        });

        it("Should set cover cooldown period", async function () {
            await expect(policyManager.connect(owner).setCoverCooldownPeriod(100))
                .to.emit(policyManager, "CoverCooldownPeriodSet").withArgs(100);
            expect(await policyManager.coverCooldownPeriod()).to.equal(100);
        });

        it("Should prevent non-owner from setting cover cooldown period", async function() {
            await expect(policyManager.connect(user1).setCoverCooldownPeriod(100))
                .to.be.revertedWithCustomError(policyManager, "OwnableUnauthorizedAccount");
        });
    });

    describe("Address checks", function () {
        it("purchaseCover reverts when addresses not set", async function () {
            await expect(
                policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, INITIAL_PREMIUM_DEPOSIT)
            ).to.be.revertedWithCustomError(policyManager, "AddressesNotSet");
        });

        it("cancelCover reverts when addresses not set", async function () {
            await expect(policyManager.connect(user1).cancelCover(1)).to.be.revertedWithCustomError(
                policyManager,
                "AddressesNotSet"
            );
        });

        it("addPremium reverts when addresses not set", async function () {
            await expect(policyManager.connect(user1).addPremium(1, 1)).to.be.revertedWithCustomError(
                policyManager,
                "AddressesNotSet"
            );
        });

        it("lapsePolicy reverts when addresses not set", async function () {
            await expect(policyManager.connect(user1).lapsePolicy(1)).to.be.revertedWithCustomError(
                policyManager,
                "AddressesNotSet"
            );
        });
    });
    
    context("With Addresses Set", function () {
        beforeEach(async function() {
            await policyManager.connect(owner).setAddresses(
                mockPoolRegistry.target,
                mockCapitalPool.target,
                mockCatPool.target,
                mockRewardDistributor.target,
                mockRiskManager.target
            );
        });

        describe("purchaseCover()", function() {
            beforeEach(async function() {
                // Configure PoolRegistry mock data
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("100000", 6),
                    0,
                    0,
                    false,
                    owner.address,
                    0
                );

                const rateModel = {
                    base: 100,
                    slope1: 200,
                    slope2: 500,
                    kink: 8000
                };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);
            });

            it("Should successfully purchase cover", async function() {
                // No special setup needed as mocks simply record calls

                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, INITIAL_PREMIUM_DEPOSIT))
                    .to.not.be.reverted;

                // Check USDC transfer
                expect(await mockUsdc.balanceOf(policyManager.target)).to.equal(INITIAL_PREMIUM_DEPOSIT);
            });

            it("Should revert if pool is paused", async function() {
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("100000", 6),
                    0,
                    0,
                    true,
                    owner.address,
                    0
                );
                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, INITIAL_PREMIUM_DEPOSIT))
                    .to.be.revertedWithCustomError(policyManager, "PoolPaused");
            });

            it("Should revert if coverage amount is zero", async function() {
                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, 0, INITIAL_PREMIUM_DEPOSIT))
                    .to.be.revertedWithCustomError(policyManager, "InvalidAmount");
            });
            
            it("Should revert if premium deposit is too low", async function() {
                const lowDeposit = ethers.parseUnits("0.1", 6); // Way too low
                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, lowDeposit))
                    .to.be.revertedWithCustomError(policyManager, "DepositTooLow");
            });

            it("Should revert if there is insufficient capacity", async function() {
                 await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("10000", 6),
                    ethers.parseUnits("5000", 6),
                    0,
                    false,
                    owner.address,
                    0
                );
                // Try to buy 6000 more, which exceeds capacity (5000 + 6000 > 10000)
                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, ethers.parseUnits("6000", 6), INITIAL_PREMIUM_DEPOSIT))
                    .to.be.revertedWithCustomError(policyManager, "InsufficientCapacity");
            });
            it("Should revert when pending withdrawals exceed total capital", async function () {
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("100000", 6),
                    0,
                    ethers.parseUnits("200000", 6),
                    false,
                    owner.address,
                    0
                );
                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, INITIAL_PREMIUM_DEPOSIT))
                    .to.be.revertedWithCustomError(policyManager, "InsufficientCapacity");
            });

            it("Should emit CoverageUpdated on successful purchase", async function () {
                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, INITIAL_PREMIUM_DEPOSIT))
                    .to.emit(mockRiskManager, "CoverageUpdated")
                    .withArgs(POOL_ID, COVERAGE_AMOUNT, true);
            });

            it("Should revert if premium deposit exceeds uint128 max", async function () {
                const hugeDeposit = 1n << 128n; // uint128 max + 1
                await mockUsdc.connect(owner).mint(user1.address, hugeDeposit);
                await mockUsdc.connect(user1).approve(policyManager.target, hugeDeposit);
                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, hugeDeposit))
                    .to.be.revertedWithCustomError(policyManager, "InvalidAmount");
            });

            it("Should apply updated cooldown period to activation timestamp", async function () {
                const NEW_PERIOD = 10 * 24 * 60 * 60; // 10 days
                await policyManager.connect(owner).setCoverCooldownPeriod(NEW_PERIOD);

                const nextIdBefore = await mockPolicyNFT.nextPolicyId();
                const tx = await policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, INITIAL_PREMIUM_DEPOSIT);
                const receipt = await tx.wait();
                const block = await ethers.provider.getBlock(receipt.blockNumber);
                const nextIdAfter = await mockPolicyNFT.nextPolicyId();
                expect(nextIdAfter).to.equal(nextIdBefore + 1n);
                const pol = await mockPolicyNFT.policies(nextIdAfter - 1n);
                expect(pol.activation).to.equal(block.timestamp + NEW_PERIOD);
            });
        });

        describe("cancelCover()", function() {
            const POLICY_ID = 1;

            beforeEach(async function() {
                const activationTime = await time.latest() + COOLDOWN_PERIOD;
                const policy = {
                    poolId: POOL_ID,
                    coverage: COVERAGE_AMOUNT,
                    activation: activationTime,
                    premiumDeposit: INITIAL_PREMIUM_DEPOSIT,
                    lastDrainTime: activationTime,
                };
                
                // Mock policy state
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    activationTime,
                    activationTime,
                    INITIAL_PREMIUM_DEPOSIT,
                    activationTime
                );
            });

            it("Should successfully cancel cover after cooldown", async function() {
                // Move time forward past the activation time
                await time.increase(COOLDOWN_PERIOD + 1);

                // Mock premium drain logic (assume no time passed since activation, so no drain)
                const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("100000", 6),
                    COVERAGE_AMOUNT,
                    0,
                    false,
                    owner.address,
                    0
                );

                // Fund the contract with premium to refund
                await mockUsdc.mint(policyManager.target, INITIAL_PREMIUM_DEPOSIT);

                const initialUserBalance = await mockUsdc.balanceOf(user1.address);

                await policyManager.connect(user1).cancelCover(POLICY_ID);

                // Check refund
                const finalUserBalance = await mockUsdc.balanceOf(user1.address);
                expect(finalUserBalance - initialUserBalance).to.be.closeTo(INITIAL_PREMIUM_DEPOSIT, 100000n);
            });
            
            it("Should revert if called within cooldown period", async function() {
                await expect(policyManager.connect(user1).cancelCover(POLICY_ID))
                    .to.be.revertedWithCustomError(policyManager, "CooldownActive");
            });
            
            it("Should revert if caller is not the policy owner", async function() {
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user2.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    0,
                    0,
                    INITIAL_PREMIUM_DEPOSIT,
                    0
                );
                await expect(policyManager.connect(user1).cancelCover(POLICY_ID))
                    .to.be.revertedWithCustomError(policyManager, "NotPolicyOwner");
            });

            it("Should revert if policy is already terminated (coverage is 0)", async function() {
                const terminatedPolicyId = POLICY_ID;
                await mockPolicyNFT.mock_setPolicy(
                    terminatedPolicyId,
                    user1.address,
                    POOL_ID,
                    0,
                    0,
                    0,
                    0,
                    0
                );

                await expect(policyManager.connect(user1).cancelCover(terminatedPolicyId))
                    .to.be.revertedWithCustomError(policyManager, "PolicyAlreadyTerminated");
            });

            it("Should cancel even if no premium deposit remains", async function() {
                // Drain premium by advancing time
                const rateModel = { base: 100, slope1: 0, slope2: 0, kink: 8000 };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("100000", 6),
                    COVERAGE_AMOUNT,
                    0,
                    false,
                    owner.address,
                    0
                );

                // Fund the contract with enough USDC for premium distribution
                await mockUsdc.mint(policyManager.target, INITIAL_PREMIUM_DEPOSIT);

                // Fast forward enough for premium to run out completely
                await time.increase(COOLDOWN_PERIOD + SECS_YEAR + 1);

                // Cancel should succeed without refund
                const userBalBefore = await mockUsdc.balanceOf(user1.address);
                await policyManager.connect(user1).cancelCover(POLICY_ID);
                const userBalAfter = await mockUsdc.balanceOf(user1.address);
                expect(userBalAfter).to.equal(userBalBefore);
            });

            it("Should cancel when pool has no available capital", async function() {
                await time.increase(COOLDOWN_PERIOD + 1);

                await mockPoolRegistry.setPoolData(
                    POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("1000", 6),
                    COVERAGE_AMOUNT,
                    ethers.parseUnits("1000", 6),
                    false,
                    owner.address,
                    0
                );
                const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);
                await mockUsdc.mint(policyManager.target, INITIAL_PREMIUM_DEPOSIT);

                await expect(policyManager.connect(user1).cancelCover(POLICY_ID)).to.not.be.reverted;
            });
            it("Should distribute premiums and emit event on cancel", async function () {
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("100000", 6),
                    COVERAGE_AMOUNT,
                    0,
                    false,
                    owner.address,
                    0
                );
                const rateModel = { base: 100, slope1: 0, slope2: 0, kink: 8000 };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);
                await mockUsdc.mint(policyManager.target, INITIAL_PREMIUM_DEPOSIT);
                await time.increase(COOLDOWN_PERIOD + 30 * 24 * 60 * 60 + 1);

                const polInfoBefore = await mockPolicyNFT.policies(POLICY_ID);
                await expect(policyManager.connect(user1).cancelCover(POLICY_ID))
                    .to.emit(mockRiskManager, "CoverageUpdated")
                    .withArgs(POOL_ID, COVERAGE_AMOUNT, false);

                const annualRateBps = 100n;
                const latest = BigInt(await time.latest());
                const timeElapsed = latest - BigInt(polInfoBefore.lastDrainTime);
                const accrued = (COVERAGE_AMOUNT * annualRateBps * timeElapsed) / (BigInt(SECS_YEAR) * BigInt(BPS));
                const catAmount = (accrued * BigInt(await policyManager.catPremiumBps())) / BigInt(BPS);
                const poolIncome = accrued - catAmount;

                expect(await mockCatPool.last_premiumReceived()).to.equal(catAmount);
                expect(await mockRewardDistributor.totalRewards(POOL_ID, mockUsdc.target)).to.equal(poolIncome);
            });

            it("Should respect updated cat premium share during distribution", async function () {
                await policyManager.connect(owner).setCatPremiumShareBps(3000);
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("100000", 6),
                    COVERAGE_AMOUNT,
                    0,
                    false,
                    owner.address,
                    0
                );
                const rateModel = { base: 100, slope1: 0, slope2: 0, kink: 8000 };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);
                await mockUsdc.mint(policyManager.target, INITIAL_PREMIUM_DEPOSIT);
                await time.increase(COOLDOWN_PERIOD + 30 * 24 * 60 * 60 + 1);

                const info = await mockPolicyNFT.policies(POLICY_ID);
                await policyManager.connect(user1).cancelCover(POLICY_ID);

                const latest = BigInt(await time.latest());
                const timeElapsed = latest - BigInt(info.lastDrainTime);
                const accrued = (COVERAGE_AMOUNT * 100n * timeElapsed) / (BigInt(SECS_YEAR) * BigInt(BPS));
                const expectedCat = (accrued * 3000n) / BigInt(BPS);
                const expectedPool = accrued - expectedCat;

                expect(await mockCatPool.last_premiumReceived()).to.equal(expectedCat);
                expect(await mockRewardDistributor.totalRewards(POOL_ID, mockUsdc.target)).to.equal(expectedPool);
            });

            it("Should send no premium to Cat Pool when share is zero", async function () {
                await policyManager.connect(owner).setCatPremiumShareBps(0);
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("100000", 6),
                    COVERAGE_AMOUNT,
                    0,
                    false,
                    owner.address,
                    0
                );
                const rateModel = { base: 100, slope1: 0, slope2: 0, kink: 8000 };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);
                await mockUsdc.mint(policyManager.target, INITIAL_PREMIUM_DEPOSIT);
                await time.increase(COOLDOWN_PERIOD + 30 * 24 * 60 * 60 + 1);

                const info = await mockPolicyNFT.policies(POLICY_ID);
                await policyManager.connect(user1).cancelCover(POLICY_ID);

                const latest = BigInt(await time.latest());
                const timeElapsed = latest - BigInt(info.lastDrainTime);
                const accrued = (COVERAGE_AMOUNT * 100n * timeElapsed) / (BigInt(SECS_YEAR) * BigInt(BPS));
                const expectedPool = accrued; // all to pool when cat share is 0

                expect(await mockCatPool.last_premiumReceived()).to.equal(0);
                expect(await mockRewardDistributor.totalRewards(POOL_ID, mockUsdc.target)).to.equal(expectedPool);
            });
        });

        // --- NEW TESTS START HERE ---

        describe("addPremium()", function() {
            const POLICY_ID = 1;
            const PREMIUM_TO_ADD = ethers.parseUnits("50", 6);

            beforeEach(async function() {
                const activationTime = await time.latest();
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    activationTime,
                    activationTime,
                    INITIAL_PREMIUM_DEPOSIT,
                    activationTime
                );

                // Mocks needed for _settleAndDrainPremium
                const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("100000", 6),
                    COVERAGE_AMOUNT,
                    0,
                    false,
                    owner.address,
                    0
                );
            });

            it("Should successfully add premium to a policy", async function() {
                await mockUsdc.connect(user1).transfer(policyManager.target, INITIAL_PREMIUM_DEPOSIT); // Pre-fund contract for drain

                const initialBalance = await mockUsdc.balanceOf(policyManager.target);
                
                await policyManager.connect(user1).addPremium(POLICY_ID, PREMIUM_TO_ADD);

                const finalBalance = await mockUsdc.balanceOf(policyManager.target);
                expect(finalBalance - initialBalance).to.be.closeTo(PREMIUM_TO_ADD, 100000n);

                const info = await mockPolicyNFT.policies(POLICY_ID);
                expect(info.premiumDeposit).to.be.gt(INITIAL_PREMIUM_DEPOSIT);
            });

            it("Should correctly account for accrued premium when adding", async function() {
                await time.increase(7 * 24 * 60 * 60); // 1 week to accrue costs

                await mockUsdc.connect(user1).transfer(policyManager.target, INITIAL_PREMIUM_DEPOSIT);

                const before = await mockPolicyNFT.policies(POLICY_ID);
                await policyManager.connect(user1).addPremium(POLICY_ID, PREMIUM_TO_ADD);
                const after = await mockPolicyNFT.policies(POLICY_ID);

                expect(after.premiumDeposit).to.be.below(before.premiumDeposit + PREMIUM_TO_ADD);
                expect(after.lastDrainTime).to.be.gt(before.lastDrainTime);
            });

            it("Should revert if premium amount is zero", async function() {
                await expect(policyManager.connect(user1).addPremium(POLICY_ID, 0))
                    .to.be.revertedWithCustomError(policyManager, "InvalidAmount");
            });

            it("Should distribute accrued premium when adding more", async function() {
                await mockUsdc.connect(user1).transfer(policyManager.target, INITIAL_PREMIUM_DEPOSIT);
                await time.increase(30 * 24 * 60 * 60);

                const before = await mockPolicyNFT.policies(POLICY_ID);
                await policyManager.connect(user1).addPremium(POLICY_ID, PREMIUM_TO_ADD);
                const after = await mockPolicyNFT.policies(POLICY_ID);

                const timeElapsed = BigInt(after.lastDrainTime) - BigInt(before.lastDrainTime);
                const utilizationBps = (COVERAGE_AMOUNT * BigInt(BPS)) / ethers.parseUnits("100000", 6);
                const rateBps = BigInt(100) + (BigInt(200) * utilizationBps) / BigInt(BPS);
                const accrued = (COVERAGE_AMOUNT * rateBps * timeElapsed) / (BigInt(SECS_YEAR) * BigInt(BPS));
                const expectedCat = (accrued * BigInt(await policyManager.catPremiumBps())) / BigInt(BPS);
                const expectedPool = accrued - expectedCat;

                expect(await mockCatPool.last_premiumReceived()).to.equal(expectedCat);
                expect(await mockRewardDistributor.totalRewards(POOL_ID, mockUsdc.target)).to.equal(expectedPool);
            });

            it("Should add premium when pool has no available capital", async function() {
                await mockPoolRegistry.setPoolData(
                    POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("1000", 6),
                    COVERAGE_AMOUNT,
                    ethers.parseUnits("1000", 6),
                    false,
                    owner.address,
                    0
                );

                await expect(policyManager.connect(user1).addPremium(POLICY_ID, PREMIUM_TO_ADD)).to.not.be.reverted;

                const info = await mockPolicyNFT.policies(POLICY_ID);
                expect(info.premiumDeposit).to.equal(INITIAL_PREMIUM_DEPOSIT + PREMIUM_TO_ADD);
            });

            it("Should prevent re-entrancy during addPremium", async function() {
                const MaliciousCatFactory = await ethers.getContractFactory("MaliciousBackstopReentrant");
                const maliciousCat = await MaliciousCatFactory.deploy();
                await maliciousCat.setTargets(policyManager.target, POLICY_ID);

                await policyManager.connect(owner).setAddresses(
                    mockPoolRegistry.target,
                    mockCapitalPool.target,
                    maliciousCat.target,
                    mockRewardDistributor.target,
                    mockRiskManager.target
                );

                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    await time.latest(),
                    await time.latest(),
                    INITIAL_PREMIUM_DEPOSIT,
                    await time.latest()
                );

                await mockUsdc.mint(policyManager.target, INITIAL_PREMIUM_DEPOSIT);
                const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);
                await mockPoolRegistry.setPoolData(
                    POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("100000", 6),
                    COVERAGE_AMOUNT,
                    0,
                    false,
                    owner.address,
                    0
                );

                await expect(policyManager.connect(user1).addPremium(POLICY_ID, PREMIUM_TO_ADD))
                    .to.be.revertedWithCustomError(policyManager, "ReentrancyGuardReentrantCall");
            });
        });

        describe("Premium Rate Calculation", function() {
            const rateModel = { base: 1000, slope1: 2000, slope2: 5000, kink: 8000 }; // 10%, 20%, 50%, 80% kink
            const availableCapital = ethers.parseUnits("100000", 6);

            beforeEach(async function() {
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);
            });

            it("Should use slope1 when utilization is below the kink", async function() {
                // Set utilization to 50% (below 80% kink)
                const totalSold = availableCapital / 2n;
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    availableCapital,
                    totalSold,
                    0,
                    false,
                    owner.address,
                    0
                );

                const utilizationBps = (totalSold * BigInt(BPS)) / availableCapital;
                let expectedRateBps = BigInt(rateModel.base) + (BigInt(rateModel.slope1) * utilizationBps) / BigInt(BPS);
                
                const minPremium = (COVERAGE_AMOUNT * expectedRateBps * 7n * 24n * 60n * 60n) / (BigInt(SECS_YEAR) * BigInt(BPS));
                
                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, minPremium - 1n))
                    .to.be.revertedWithCustomError(policyManager, "DepositTooLow");
            });

            it("Should use slope2 when utilization is above the kink", async function() {
                // Set utilization to 90% (above 80% kink)
                const totalSold = (availableCapital * 9n) / 10n;
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    availableCapital,
                    totalSold,
                    0,
                    false,
                    owner.address,
                    0
                );

                const utilizationBps = (totalSold * BigInt(BPS)) / availableCapital;
                let expectedRateBps = BigInt(rateModel.base) 
                    + (BigInt(rateModel.slope1) * BigInt(rateModel.kink)) / BigInt(BPS)
                    + (BigInt(rateModel.slope2) * (utilizationBps - BigInt(rateModel.kink))) / BigInt(BPS);

                const minPremium = (COVERAGE_AMOUNT * expectedRateBps * 7n * 24n * 60n * 60n) / (BigInt(SECS_YEAR) * BigInt(BPS));
                
                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, minPremium - 1n))
                    .to.be.revertedWithCustomError(policyManager, "DepositTooLow");
            });

            it("Should use slope2 when utilization equals the kink", async function() {
                const totalSold = (availableCapital * BigInt(rateModel.kink)) / BigInt(BPS);
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    availableCapital,
                    totalSold,
                    0,
                    false,
                    owner.address,
                    0
                );

                const expectedRateBps = BigInt(rateModel.base)
                    + (BigInt(rateModel.slope1) * BigInt(rateModel.kink)) / BigInt(BPS);
                const minPremium = (COVERAGE_AMOUNT * expectedRateBps * 7n * 24n * 60n * 60n) / (BigInt(SECS_YEAR) * BigInt(BPS));

                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, minPremium - 1n))
                    .to.be.revertedWithCustomError(policyManager, "DepositTooLow");
            });

            it("Should handle zero available capital gracefully", async function() {
                // Set pending withdrawals to equal total pledged capital
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    availableCapital,
                    0,
                    availableCapital,
                    false,
                    owner.address,
                    0
                );
                
                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, INITIAL_PREMIUM_DEPOSIT))
                    .to.be.revertedWithCustomError(policyManager, "InsufficientCapacity");
            });
        });
        
        describe("isPolicyActive()", function() {
            const POLICY_ID = 1;

            beforeEach(async function() {
                const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("100000", 6),
                    COVERAGE_AMOUNT,
                    0,
                    false,
                    owner.address,
                    0
                );
            });

            it("Should return false for a terminated policy (coverage=0)", async function() {
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    0,
                    0,
                    0,
                    0,
                    0
                );
                expect(await policyManager.isPolicyActive(POLICY_ID)).to.be.false;
            });

            it("Should return true when premium is sufficient", async function() {
                const activationTime = await time.latest();
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    0,
                    activationTime,
                    INITIAL_PREMIUM_DEPOSIT,
                    activationTime
                );
                await time.increase(30 * 24 * 60 * 60); // 30 days
                expect(await policyManager.isPolicyActive(POLICY_ID)).to.be.true;
            });

            it("Should return false when premium has been depleted", async function() {
                const activationTime = await time.latest();
                // A very small premium that will run out quickly
                const lowPremium = ethers.parseUnits("0.01", 6);
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    0,
                    activationTime,
                    lowPremium,
                    activationTime
                );

                await time.increase(30 * 24 * 60 * 60); // 30 days should be enough to deplete it
                expect(await policyManager.isPolicyActive(POLICY_ID)).to.be.false;
            });

            it("Should return false when addresses are unset", async function() {
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    0,
                    await time.latest(),
                    INITIAL_PREMIUM_DEPOSIT,
                    await time.latest()
                );
                // Addresses intentionally not set for PolicyManager
                const freshPMFactory = await ethers.getContractFactory("PolicyManager");
                const freshPM = await freshPMFactory.deploy(mockPolicyNFT.target, owner.address);
                expect(await freshPM.isPolicyActive(POLICY_ID)).to.be.false;
            });

            it("Should return true when lastDrainTime is in the future", async function() {
                const now = await time.latest();
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    now + 1,
                    now + 86400,
                    INITIAL_PREMIUM_DEPOSIT,
                    now + 86400
                );
                expect(await policyManager.isPolicyActive(POLICY_ID)).to.be.true;
            });

            it("Should remain active when pool has no available capital", async function() {
                const now = await time.latest();
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    0,
                    now,
                    INITIAL_PREMIUM_DEPOSIT,
                    now
                );

                await mockPoolRegistry.setPoolData(
                    POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("1000", 6),
                    0,
                    ethers.parseUnits("1000", 6),
                    false,
                    owner.address,
                    0
                );

                const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);

                expect(await policyManager.isPolicyActive(POLICY_ID)).to.be.true;
            });
        });

        describe("increaseCover()", function () {
            const POLICY_ID = 1;
            const ADDITIONAL_COVERAGE = ethers.parseUnits("5000", 6);

            beforeEach(async function () {
                const now = await time.latest();
                const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);
                await policyManager.connect(owner).setCoverCooldownPeriod(COOLDOWN_PERIOD);
                await mockPoolRegistry.setPoolData(
                    POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("100000", 6),
                    COVERAGE_AMOUNT,
                    0,
                    false,
                    owner.address,
                    0
                );

                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    0,
                    now,
                    INITIAL_PREMIUM_DEPOSIT,
                    now
                );
            });

            it("Should successfully request additional coverage", async function () {
                const tx = await policyManager.connect(user1).increaseCover(POLICY_ID, ADDITIONAL_COVERAGE);
                const receipt = await tx.wait();
                const block = await ethers.provider.getBlock(receipt.blockNumber);

                await expect(tx)
                    .to.emit(mockRiskManager, "CoverageUpdated")
                    .withArgs(POOL_ID, ADDITIONAL_COVERAGE, true);

                const info = await mockPolicyNFT.policies(POLICY_ID);
                expect(info.pendingIncrease).to.equal(ADDITIONAL_COVERAGE);
                expect(info.increaseActivationTimestamp).to.equal(block.timestamp + COOLDOWN_PERIOD);
            });

            it("Should revert when additional coverage is zero", async function () {
                await expect(
                    policyManager.connect(user1).increaseCover(POLICY_ID, 0)
                ).to.be.revertedWithCustomError(policyManager, "InvalidAmount");
            });

            it("Should revert if caller is not the policy owner", async function () {
                await expect(
                    policyManager.connect(user2).increaseCover(POLICY_ID, ADDITIONAL_COVERAGE)
                ).to.be.revertedWithCustomError(policyManager, "NotPolicyOwner");
            });

            it("Should revert when policy is not active", async function () {
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    0,
                    await time.latest(),
                    0,
                    await time.latest()
                );

                await expect(
                    policyManager.connect(user1).increaseCover(POLICY_ID, ADDITIONAL_COVERAGE)
                ).to.be.revertedWithCustomError(policyManager, "PolicyNotActive");
            });

            it("Should revert when deposit is insufficient for new coverage", async function () {
                const now = await time.latest();
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    0,
                    now,
                    ethers.parseUnits("1", 6),
                    now
                );

                await expect(
                    policyManager.connect(user1).increaseCover(POLICY_ID, ADDITIONAL_COVERAGE)
                ).to.be.revertedWithCustomError(policyManager, "DepositTooLow");
            });

            it("Should revert when pool lacks available capital", async function () {
                await mockPoolRegistry.setPoolData(
                    POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("15000", 6),
                    ethers.parseUnits("12000", 6),
                    0,
                    false,
                    owner.address,
                    0
                );

                await expect(
                    policyManager.connect(user1).increaseCover(POLICY_ID, ADDITIONAL_COVERAGE)
                ).to.be.revertedWithCustomError(policyManager, "InsufficientCapacity");
            });

            it("Should finalize matured increase before applying a new one", async function () {
                await policyManager.connect(user1).increaseCover(POLICY_ID, ADDITIONAL_COVERAGE);
                await time.increase(COOLDOWN_PERIOD + 1);

                const NEW_ADD = ethers.parseUnits("1000", 6);
                const tx = await policyManager.connect(user1).increaseCover(POLICY_ID, NEW_ADD);
                const receipt = await tx.wait();
                const block = await ethers.provider.getBlock(receipt.blockNumber);

                const info = await mockPolicyNFT.policies(POLICY_ID);
                expect(info.coverage).to.equal(COVERAGE_AMOUNT + ADDITIONAL_COVERAGE);
                expect(info.pendingIncrease).to.equal(NEW_ADD);
                expect(info.increaseActivationTimestamp).to.equal(block.timestamp + COOLDOWN_PERIOD);
            });

            it("Should revert if an increase is already pending", async function () {
                await policyManager.connect(user1).increaseCover(POLICY_ID, ADDITIONAL_COVERAGE);
                await expect(
                    policyManager.connect(user1).increaseCover(POLICY_ID, ADDITIONAL_COVERAGE)
                ).to.be.revertedWith("PM: An increase is already pending");
            });
        });

        describe("lapsePolicy()", function() {
            const POLICY_ID = 1;

            beforeEach(async function() {
                const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);
                await mockPoolRegistry.setPoolData(
                    POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("100000", 6),
                    0,
                    0,
                    false,
                    owner.address,
                    0
                );
            });

            it("Should successfully lapse an inactive policy", async function() {
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    0,
                    0,
                    0,
                    0
                );

                await expect(policyManager.connect(user1).lapsePolicy(POLICY_ID)).to.not.be.reverted;
                expect(await mockPolicyNFT.last_burn_id()).to.equal(POLICY_ID);
            });

            it("Should revert when policy is still active", async function() {
                const activationTime = await time.latest();
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    activationTime,
                    activationTime,
                    INITIAL_PREMIUM_DEPOSIT,
                    activationTime
                );

                await mockUsdc.mint(policyManager.target, INITIAL_PREMIUM_DEPOSIT);

                await expect(policyManager.connect(user1).lapsePolicy(POLICY_ID)).to.be.revertedWithCustomError(
                    policyManager,
                    "PolicyIsActive"
                );
            });

            it("Should revert if policy already terminated", async function() {
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    0,
                    0,
                    0,
                    0,
                    0
                );

                await expect(policyManager.connect(user1).lapsePolicy(POLICY_ID)).to.be.revertedWithCustomError(
                    policyManager,
                    "PolicyAlreadyTerminated"
                );
            });
            it("Should emit CoverageUpdated when lapsing policy", async function () {
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    0,
                    0,
                    0,
                    0
                );
                await expect(policyManager.connect(user1).lapsePolicy(POLICY_ID))
                    .to.emit(mockRiskManager, "CoverageUpdated")
                    .withArgs(POOL_ID, COVERAGE_AMOUNT, false);
            });
        });

        describe("Re-entrancy Guard", function() {
            it("Should prevent re-entrancy during cancellation", async function() {
                // Deploy a malicious contract that will try to re-enter
                const MaliciousDistributorFactory = await ethers.getContractFactory("MaliciousDistributor");
                const maliciousDistributor = await MaliciousDistributorFactory.deploy();
                await policyManager.connect(owner).setAddresses(
                    mockPoolRegistry.target,
                    mockCapitalPool.target,
                    mockCatPool.target,
                    await maliciousDistributor.getAddress(), // Use the malicious distributor
                    mockRiskManager.target
                );

                const POLICY_ID = 1;
                const activationTime = await time.latest() + COOLDOWN_PERIOD;
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    user1.address,
                    POOL_ID,
                    COVERAGE_AMOUNT,
                    activationTime,
                    activationTime,
                    INITIAL_PREMIUM_DEPOSIT,
                    activationTime
                );
                
                const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);
                await mockPoolRegistry.setPoolData(POOL_ID,
                    mockUsdc.target,
                    ethers.parseUnits("100000", 6),
                    COVERAGE_AMOUNT,
                    0,
                    false,
                    owner.address,
                    0
                );

                // Setup the malicious contract
                await maliciousDistributor.setTargets(policyManager.target, POLICY_ID);
                await time.increase(COOLDOWN_PERIOD + 1);

                // Fund the PolicyManager so it can attempt a distribution
                await mockUsdc.mint(policyManager.target, ethers.parseUnits("1", 6));

                // The cancelCover call will trigger a distribution, which will call back to cancelCover again
                await expect(policyManager.connect(user1).cancelCover(POLICY_ID))
                    .to.be.revertedWithCustomError(policyManager, "ReentrancyGuardReentrantCall");
            });

            it("Should prevent re-entrancy during purchaseCover", async function () {
                const MaliciousTokenFactory = await ethers.getContractFactory("MaliciousERC20Reentrant");
                const maliciousToken = await MaliciousTokenFactory.deploy("MalToken", "MAL");
                await maliciousToken.mint(user1.address, ethers.parseUnits("1000", 6));

                const MalCapPoolFactory = await ethers.getContractFactory("MockCapitalPool");
                const malCapPool = await MalCapPoolFactory.deploy(owner.address, maliciousToken.target);

                await maliciousToken.connect(user1).approve(policyManager.target, ethers.MaxUint256);
                await maliciousToken.setAttack(policyManager.target, POOL_ID, COVERAGE_AMOUNT, INITIAL_PREMIUM_DEPOSIT);

                await policyManager.connect(owner).setAddresses(
                    mockPoolRegistry.target,
                    malCapPool.target,
                    mockCatPool.target,
                    mockRewardDistributor.target,
                    mockRiskManager.target
                );

                await mockPoolRegistry.setPoolData(POOL_ID,
                    maliciousToken.target,
                    ethers.parseUnits("100000", 6),
                    0,
                    0,
                    false,
                    owner.address,
                    0
                );
                const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
                await mockPoolRegistry.setRateModel(POOL_ID, rateModel);

                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, INITIAL_PREMIUM_DEPOSIT))
                    .to.be.revertedWithCustomError(policyManager, "ReentrancyGuardReentrantCall");
            });
        });

        // --- END OF NEW TESTS ---
    });
});

