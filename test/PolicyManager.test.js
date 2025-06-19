// test/PolicyManager.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Deploy the Solidity based mocks used in the tests
async function deployMocks(owner, usdcAddress) {
    const MockPoolRegistry = await ethers.getContractFactory("MockPoolRegistry");
    const MockCapitalPool = await ethers.getContractFactory("MockCapitalPool");
    const MockCatInsurancePool = await ethers.getContractFactory("MockCatInsurancePool");
    const MockPolicyNFT = await ethers.getContractFactory("MockPolicyNFT");
    const MockRewardDistributor = await ethers.getContractFactory("MockRewardDistributor");
    const MockRiskManager = await ethers.getContractFactory("MockRiskManagerHook");

    const poolRegistry = await MockPoolRegistry.deploy();
    const capitalPool = await MockCapitalPool.deploy(owner.address, usdcAddress);
    const catPool = await MockCatInsurancePool.deploy(owner.address);
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
        
        it("Should prevent setting CAT premium share over 50%", async function() {
            await expect(policyManager.connect(owner).setCatPremiumShareBps(5001))
                .to.be.revertedWith("PM: Max share is 50%");
        });

        it("Should set cover cooldown period", async function () {
            await expect(policyManager.connect(owner).setCoverCooldownPeriod(100))
                .to.emit(policyManager, "CoverCooldownPeriodSet").withArgs(100);
            expect(await policyManager.coverCooldownPeriod()).to.equal(100);
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
                expect(finalBalance - initialBalance).to.equal(PREMIUM_TO_ADD);

                const info = await mockPolicyNFT.policies(POLICY_ID);
                expect(info.premiumDeposit).to.be.gt(INITIAL_PREMIUM_DEPOSIT);
            });

            it("Should revert if premium amount is zero", async function() {
                await expect(policyManager.connect(user1).addPremium(POLICY_ID, 0))
                    .to.be.revertedWithCustomError(policyManager, "InvalidAmount");
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
        });

        // --- END OF NEW TESTS ---
    });
});

