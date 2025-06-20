// test/RiskManager.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// These tests use Solidity-based mocks located in contracts/test

describe("RiskManager", function () {
    // --- Signers ---
    let owner, committee, underwriter1, underwriter2, claimant, liquidator, nonParty;

    // --- Contracts ---
    let riskManager;
    let mockPoolRegistry, mockCapitalPool, mockPolicyNFT, mockCatPool, mockLossDistributor, mockPolicyManager, mockRewardDistributor, mockUsdc;

    // --- Constants ---
    const POOL_ID_1 = 0;
    const POOL_ID_2 = 1;
const MAX_ALLOCATIONS = 5;

    async function getAllocations(user) {
        const allocs = [];
        for (let i = 0; ; i++) {
            try {
                const val = await riskManager.underwriterAllocations(user, i);
                allocs.push(val);
            } catch (err) {
                break;
            }
        }
        return allocs;
    }

    beforeEach(async function () {
        [owner, committee, underwriter1, underwriter2, claimant, liquidator, nonParty] = await ethers.getSigners();

        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        mockUsdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);

        const PoolRegistryFactory = await ethers.getContractFactory("MockPoolRegistry");
        mockPoolRegistry = await PoolRegistryFactory.deploy();

        const CapitalPoolFactory = await ethers.getContractFactory("MockCapitalPool");
        mockCapitalPool = await CapitalPoolFactory.deploy(owner.address, mockUsdc.target);

        const PolicyNFTFactory = await ethers.getContractFactory("MockPolicyNFT");
        mockPolicyNFT = await PolicyNFTFactory.deploy(owner.address);

        const CatPoolFactory = await ethers.getContractFactory("MockCatInsurancePool");
        mockCatPool = await CatPoolFactory.deploy(owner.address);

        const LossFactory = await ethers.getContractFactory("MockLossDistributor");
        mockLossDistributor = await LossFactory.deploy();

        const PolicyManagerFactory = await ethers.getContractFactory("MockPolicyManager");
        mockPolicyManager = await PolicyManagerFactory.deploy();
        await mockPolicyManager.setPolicyNFT(mockPolicyNFT.target);

        const RewardFactory = await ethers.getContractFactory("MockRewardDistributor");
        mockRewardDistributor = await RewardFactory.deploy();
        
        // --- Deploy RiskManager ---
        const RiskManagerFactory = await ethers.getContractFactory("RiskManager");
        riskManager = await RiskManagerFactory.deploy(owner.address);

        await mockRewardDistributor.setCatPool(mockCatPool.target);
    });

    describe("Admin Functions", function () {
        it("Should set addresses correctly", async function () {
            await expect(riskManager.connect(owner).setAddresses(
                mockCapitalPool.target,
                mockPoolRegistry.target,
                mockPolicyManager.target,
                mockCatPool.target,
                mockLossDistributor.target,
                mockRewardDistributor.target
            )).to.emit(riskManager, "AddressesSet");

            expect(await riskManager.capitalPool()).to.equal(mockCapitalPool.target);
            expect(await riskManager.poolRegistry()).to.equal(mockPoolRegistry.target);
            expect(await riskManager.policyManager()).to.equal(mockPolicyManager.target);
            expect(await riskManager.policyNFT()).to.equal(mockPolicyNFT.target);
            expect(await riskManager.catPool()).to.equal(mockCatPool.target);
            expect(await riskManager.lossDistributor()).to.equal(mockLossDistributor.target);
            expect(await riskManager.rewardDistributor()).to.equal(mockRewardDistributor.target);
        });

        it("Should prevent non-owner from setting addresses", async function () {
            await expect(riskManager.connect(nonParty).setAddresses(
                mockCapitalPool.target, mockPoolRegistry.target, mockPolicyManager.target, mockCatPool.target, mockLossDistributor.target, mockRewardDistributor.target
            )).to.be.revertedWithCustomError(riskManager, "OwnableUnauthorizedAccount");
        });

        it("Should set the committee address", async function () {
            await expect(riskManager.connect(owner).setCommittee(committee.address))
                .to.emit(riskManager, "CommitteeSet").withArgs(committee.address);
            expect(await riskManager.committee()).to.equal(committee.address);
        });
        
        it("Should prevent setting committee to zero address", async function () {
            await expect(riskManager.connect(owner).setCommittee(ethers.ZeroAddress))
                .to.be.revertedWith("Zero address not allowed");
        });

        it("Should update max allocations per underwriter", async function () {
            await expect(riskManager.connect(owner).setMaxAllocationsPerUnderwriter(7))
                .to.emit(riskManager, "MaxAllocationsPerUnderwriterSet").withArgs(7);
            expect(await riskManager.maxAllocationsPerUnderwriter()).to.equal(7);
        });

        it("Should revert when setting max allocations to zero", async function () {
            await expect(riskManager.connect(owner).setMaxAllocationsPerUnderwriter(0))
                .to.be.revertedWith("Invalid max");
        });

        it("Should restrict addProtocolRiskPool to owner", async function () {
            const model = { base: 0, slope1: 0, slope2: 0, kink: 0 };
            await riskManager.connect(owner).setAddresses(
                mockCapitalPool.target,
                mockPoolRegistry.target,
                mockPolicyManager.target,
                mockCatPool.target,
                mockLossDistributor.target,
                mockRewardDistributor.target
            );
            await expect(riskManager.connect(nonParty).addProtocolRiskPool(mockUsdc.target, model, 0))
                .to.be.revertedWithCustomError(riskManager, "OwnableUnauthorizedAccount");
            await expect(riskManager.connect(owner).addProtocolRiskPool(mockUsdc.target, model, 0))
                .to.not.be.reverted;
        });
    });

    context("With Addresses Set", function () {
        beforeEach(async function() {
            await riskManager.connect(owner).setAddresses(
                mockCapitalPool.target,
                mockPoolRegistry.target,
                mockPolicyManager.target,
                mockCatPool.target,
                mockLossDistributor.target,
                mockRewardDistributor.target
            );
            await riskManager.connect(owner).setCommittee(committee.address);
        });

        describe("Capital Allocation", function() {
            const PLEDGE_AMOUNT = ethers.parseUnits("10000", 6);

            beforeEach(async function() {
                await mockCapitalPool.triggerOnCapitalDeposited(riskManager.target, underwriter1.address, PLEDGE_AMOUNT);
                await mockPoolRegistry.setPoolCount(MAX_ALLOCATIONS + 1);
                await mockCapitalPool.setUnderwriterAdapterAddress(underwriter1.address, nonParty.address);
            });

            it("Should allow an underwriter to allocate their capital to pools", async function() {
                await expect(riskManager.connect(underwriter1).allocateCapital([POOL_ID_1, POOL_ID_2]))
                    .to.emit(riskManager, "CapitalAllocated").withArgs(underwriter1.address, POOL_ID_1, PLEDGE_AMOUNT)
                    .and.to.emit(riskManager, "CapitalAllocated").withArgs(underwriter1.address, POOL_ID_2, PLEDGE_AMOUNT);
                
                const allocations = await getAllocations(underwriter1.address);
                expect(allocations.map(a => BigInt(a))).to.deep.equal([BigInt(POOL_ID_1), BigInt(POOL_ID_2)]);
            });

            it("Should revert if allocating to more than MAX_ALLOCATIONS_PER_UNDERWRITER pools", async function() {
                const tooManyPools = Array.from({ length: MAX_ALLOCATIONS + 1 }, (_, i) => i);
                await expect(riskManager.connect(underwriter1).allocateCapital(tooManyPools))
                    .to.be.revertedWith("Invalid number of allocations");
            });

            it("Should revert if allocating to an invalid poolId", async function() {
                 await expect(riskManager.connect(underwriter1).allocateCapital([99]))
                    .to.be.revertedWith("Invalid poolId");
            });

            it("Should revert if underwriter has no capital to allocate", async function() {
                await expect(riskManager.connect(underwriter2).allocateCapital([POOL_ID_1]))
                    .to.be.revertedWithCustomError(riskManager, "NoCapitalToAllocate");
            });
            
            it("Should revert if allocating to a pool they are already in", async function() {
                await riskManager.connect(underwriter1).allocateCapital([POOL_ID_1]);
                await expect(riskManager.connect(underwriter1).allocateCapital([POOL_ID_1]))
                    .to.be.revertedWith("Already allocated to this pool");
            });

            it("Should revert if no yield adapter is set", async function () {
                await mockCapitalPool.setUnderwriterAdapterAddress(underwriter1.address, ethers.ZeroAddress);
                await expect(riskManager.connect(underwriter1).allocateCapital([POOL_ID_1]))
                    .to.be.revertedWith("User has no yield adapter set in CapitalPool");
            });
        });

        describe("Capital Deallocation", function() {
            const HALF_PLEDGE = ethers.parseUnits("5000", 6);
            const PLEDGE_AMOUNT = ethers.parseUnits("10000", 6);

            beforeEach(async function() {
                await mockCapitalPool.triggerOnCapitalDeposited(riskManager.target, underwriter1.address, PLEDGE_AMOUNT);
                await mockPoolRegistry.setPoolCount(1);
                await mockPoolRegistry.connect(owner).setPoolData(POOL_ID_1, mockUsdc.target, PLEDGE_AMOUNT, 0, 0, false, ethers.ZeroAddress, 0);
                await mockCapitalPool.setUnderwriterAdapterAddress(underwriter1.address, nonParty.address);
                await riskManager.connect(underwriter1).allocateCapital([POOL_ID_1]);
                await riskManager.connect(owner).setDeallocationNoticePeriod(0);
            });

            it("Should allow an underwriter to deallocate from a pool with no losses", async function() {
                await mockLossDistributor.setPendingLoss(underwriter1.address, POOL_ID_1, 0);
                await riskManager.connect(underwriter1).requestDeallocateFromPool(POOL_ID_1, HALF_PLEDGE);
                await expect(riskManager.connect(underwriter1).deallocateFromPool(POOL_ID_1))
                    .to.emit(riskManager, "CapitalDeallocated").withArgs(underwriter1.address, POOL_ID_1, HALF_PLEDGE);

                const allocations = await getAllocations(underwriter1.address);
                expect(allocations.map(a => BigInt(a))).to.deep.equal([BigInt(POOL_ID_1)]);
            });
            
            it("Should correctly apply losses before deallocating", async function() {
                const lossAmount = ethers.parseUnits("1000", 6);
                await mockLossDistributor.setPendingLoss(underwriter1.address, POOL_ID_1, lossAmount);
                await riskManager.connect(underwriter1).requestDeallocateFromPool(POOL_ID_1, HALF_PLEDGE);
                await riskManager.connect(underwriter1).deallocateFromPool(POOL_ID_1);

                // Check that pledge was reduced before emitting the event
                expect(await riskManager.underwriterTotalPledge(underwriter1.address)).to.equal(PLEDGE_AMOUNT - lossAmount);
            });
            
            it("Should revert if trying to deallocate from a pool they are not in", async function() {
                const pledge = ethers.parseUnits("1000", 6);
                await mockCapitalPool.triggerOnCapitalDeposited(riskManager.target, underwriter2.address, pledge);
                await mockCapitalPool.setUnderwriterAdapterAddress(underwriter2.address, nonParty.address);
                await mockLossDistributor.setPendingLoss(underwriter2.address, POOL_ID_1, 0);
                await expect(riskManager.connect(underwriter2).requestDeallocateFromPool(POOL_ID_1, HALF_PLEDGE))
                    .to.be.revertedWith("Not allocated to this pool");
            });

            it("Should revert if executing without a request", async function() {
                await expect(riskManager.connect(underwriter1).deallocateFromPool(POOL_ID_1))
                    .to.be.revertedWithCustomError(riskManager, "NoDeallocationRequest");
            });

            it("Should revert if notice period not elapsed", async function() {
                await riskManager.connect(owner).setDeallocationNoticePeriod(100);
                await riskManager.connect(underwriter1).requestDeallocateFromPool(POOL_ID_1, HALF_PLEDGE);
                await expect(riskManager.connect(underwriter1).deallocateFromPool(POOL_ID_1))
                    .to.be.revertedWithCustomError(riskManager, "NoticePeriodActive");
                await riskManager.connect(owner).setDeallocationNoticePeriod(0);
            });

            it("Should revert if yield adapter address is missing", async function () {
                await mockLossDistributor.setPendingLoss(underwriter1.address, POOL_ID_1, 0);
                await riskManager.connect(underwriter1).requestDeallocateFromPool(POOL_ID_1, HALF_PLEDGE);
                await mockCapitalPool.setUnderwriterAdapterAddress(underwriter1.address, ethers.ZeroAddress);
                await expect(riskManager.connect(underwriter1).deallocateFromPool(POOL_ID_1))
                    .to.be.revertedWith("User has no yield adapter set in CapitalPool");
            });
        });

        describe("Governance Hooks", function() {
            it("Should allow the committee to report an incident (pause a pool)", async function() {
                await mockPoolRegistry.connect(owner).setPoolData(POOL_ID_1, mockUsdc.target, 0, 0, 0, false, committee.address, 0);
                await expect(riskManager.connect(committee).reportIncident(POOL_ID_1, true)).to.not.be.reverted;
                expect((await mockPoolRegistry.pools(POOL_ID_1)).isPaused).to.equal(true);
                await riskManager.connect(committee).reportIncident(POOL_ID_1, false);
                expect((await mockPoolRegistry.pools(POOL_ID_1)).isPaused).to.equal(false);
            });
            
            it("Should prevent non-committee from reporting an incident", async function() {
                await expect(riskManager.connect(nonParty).reportIncident(POOL_ID_1, true))
                    .to.be.revertedWithCustomError(riskManager, "NotCommittee");
            });

            it("Should allow the committee to set a pool's fee recipient", async function() {
                await mockPoolRegistry.connect(owner).setPoolData(POOL_ID_1, mockUsdc.target, 0, 0, 0, false, committee.address, 0);
                await expect(riskManager.connect(committee).setPoolFeeRecipient(POOL_ID_1, nonParty.address)).to.not.be.reverted;
                expect((await mockPoolRegistry.pools(POOL_ID_1)).feeRecipient).to.equal(nonParty.address);
            });
        });

        describe("Claim Processing", function() {
            const POLICY_ID = 123;
            const COVERAGE_AMOUNT = ethers.parseUnits("50000", 6);
            const TOTAL_PLEDGED = ethers.parseUnits("100000", 6);
            let mockProtocolToken;

            beforeEach(async function() {
                const MockERC20Factory = await ethers.getContractFactory("MockERC20");
                mockProtocolToken = await MockERC20Factory.deploy("aToken", "aTKN", 6);
                await mockProtocolToken.connect(owner).mint(claimant.address, COVERAGE_AMOUNT);
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    claimant.address,
                    POOL_ID_1,
                    COVERAGE_AMOUNT,
                    0,
                    0,
                    0,
                    0
                );
                await mockPoolRegistry.setPayoutData([nonParty.address], [TOTAL_PLEDGED], TOTAL_PLEDGED);
                await mockPoolRegistry.connect(owner).setPoolData(POOL_ID_1, mockProtocolToken.target, TOTAL_PLEDGED, 0, 0, false, committee.address, 500);
                await mockPolicyNFT.setRiskManagerAddress(riskManager.target);
                await mockProtocolToken.connect(claimant).approve(riskManager.target, COVERAGE_AMOUNT);
                await mockProtocolToken.connect(claimant).approve(riskManager.target, COVERAGE_AMOUNT);
            });

            it("Should process a claim fully covered by the pool", async function() {
                await expect(riskManager.connect(nonParty).processClaim(POLICY_ID)).to.not.be.reverted;
                const payoutData = await mockCapitalPool.lastPayout();
                const expectedFee = (COVERAGE_AMOUNT * 500n) / 10000n;
                expect(payoutData.claimant).to.equal(claimant.address);
                expect(payoutData.claimantAmount).to.equal(COVERAGE_AMOUNT - expectedFee);
                expect(payoutData.feeRecipient).to.equal(committee.address);
                expect(payoutData.feeAmount).to.equal(expectedFee);
                const rewardStored = await mockRewardDistributor.totalRewards(POOL_ID_1, mockProtocolToken.target);
                expect(rewardStored).to.equal(COVERAGE_AMOUNT);
            });
            
            it("Should draw from the CAT pool if there is a shortfall", async function() {
                const HIGH_COVERAGE = TOTAL_PLEDGED + 1000n;
                const SHORTFALL = HIGH_COVERAGE - TOTAL_PLEDGED;
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    claimant.address,
                    POOL_ID_1,
                    HIGH_COVERAGE,
                    0,
                    0,
                    0,
                    0
                );
                await mockCatPool.setShouldRevertOnDrawFund(false);
                await mockProtocolToken.connect(owner).mint(claimant.address, HIGH_COVERAGE);
                await mockProtocolToken.connect(claimant).approve(riskManager.target, HIGH_COVERAGE);
                await expect(riskManager.connect(nonParty).processClaim(POLICY_ID)).to.not.be.reverted;
                expect(await mockCatPool.drawFundCallCount()).to.equal(1);
                const rewardStored2 = await mockRewardDistributor.totalRewards(POOL_ID_1, mockProtocolToken.target);
                expect(rewardStored2).to.equal(HIGH_COVERAGE);
            });

            it("Should scale reward amounts to protocol token decimals", async function() {
                const MockERC20Factory = await ethers.getContractFactory("MockERC20");
                const highDecToken = await MockERC20Factory.deploy("PTKN", "PTK", 18);
                await highDecToken.connect(owner).mint(claimant.address, ethers.parseUnits("50000", 18));
                await mockPolicyNFT.mock_setPolicy(
                    POLICY_ID,
                    claimant.address,
                    POOL_ID_1,
                    COVERAGE_AMOUNT,
                    0,
                    0,
                    0,
                    0
                );
                await mockPoolRegistry.connect(owner).setPoolData(POOL_ID_1, highDecToken.target, TOTAL_PLEDGED, 0, 0, false, committee.address, 500);
                await highDecToken.connect(claimant).approve(riskManager.target, ethers.parseUnits("50000", 18));

                await expect(riskManager.connect(nonParty).processClaim(POLICY_ID)).to.not.be.reverted;
                const stored = await mockRewardDistributor.totalRewards(POOL_ID_1, highDecToken.target);
                expect(stored).to.equal(ethers.parseUnits("50000", 18));
            });

            it("Should reduce pool capital after a claim", async function () {
                const initial = (await mockPoolRegistry.pools(POOL_ID_1)).totalCapitalPledgedToPool;
                await expect(riskManager.connect(nonParty).processClaim(POLICY_ID)).to.not.be.reverted;
                const poolAfter = await mockPoolRegistry.pools(POOL_ID_1);
                expect(poolAfter.totalCapitalPledgedToPool).to.equal(initial - COVERAGE_AMOUNT);
                const capPerAdapter = await mockPoolRegistry.capitalPerAdapter(POOL_ID_1, nonParty.address);
                expect(capPerAdapter).to.equal(initial - COVERAGE_AMOUNT);
            });
        });

        describe("Liquidation", function() {
            const PLEDGE = ethers.parseUnits("10000", 6);
            const SHARES = ethers.parseUnits("10000", 18);

            beforeEach(async function() {
                await mockCapitalPool.triggerOnCapitalDeposited(riskManager.target, underwriter1.address, PLEDGE);
                await mockPoolRegistry.setPoolCount(1);
                await mockCapitalPool.setUnderwriterAdapterAddress(underwriter1.address, nonParty.address);
                await riskManager.connect(underwriter1).allocateCapital([POOL_ID_1]);

                await mockCapitalPool.setUnderwriterAccount(underwriter1.address, SHARES);
                await mockLossDistributor.setPendingLoss(underwriter1.address, POOL_ID_1, 0);
            });

            it("Should liquidate an insolvent underwriter", async function() {
                const shareValue = ethers.parseUnits("9000", 6);
                const pendingLosses = ethers.parseUnits("9001", 6);
                await mockCapitalPool.setSharesToValue(SHARES, shareValue);
                await mockLossDistributor.setPendingLoss(underwriter1.address, POOL_ID_1, pendingLosses);

                await expect(riskManager.connect(liquidator).liquidateInsolventUnderwriter(underwriter1.address))
                    .to.emit(riskManager, "UnderwriterLiquidated").withArgs(liquidator.address, underwriter1.address);
            });

            it("Should revert if underwriter is solvent", async function() {
                const shareValue = ethers.parseUnits("9000", 6);
                const pendingLosses = ethers.parseUnits("8999", 6);
                await mockCapitalPool.setSharesToValue(SHARES, shareValue);
                await mockLossDistributor.setPendingLoss(underwriter1.address, POOL_ID_1, pendingLosses);

                await expect(riskManager.connect(liquidator).liquidateInsolventUnderwriter(underwriter1.address))
                    .to.be.revertedWithCustomError(riskManager, "UnderwriterNotInsolvent");
            });
            
            it("Should revert if underwriter has no shares", async function() {
                await mockCapitalPool.setUnderwriterAccount(underwriter2.address, 0);
                 await expect(riskManager.connect(liquidator).liquidateInsolventUnderwriter(underwriter2.address))
                    .to.be.revertedWithCustomError(riskManager, "UnderwriterNotInsolvent");
            });
        });

        describe("Hooks and State Updaters", function() {
            it("onCapitalDeposited should revert if not called by CapitalPool", async function() {
                await expect(riskManager.connect(nonParty).onCapitalDeposited(underwriter1.address, 100))
                    .to.be.revertedWithCustomError(riskManager, "NotCapitalPool");
            });

            it("onWithdrawalRequested should revert if not called by CapitalPool", async function () {
                await expect(riskManager.connect(nonParty).onWithdrawalRequested(underwriter1.address, 100))
                    .to.be.revertedWithCustomError(riskManager, "NotCapitalPool");
            });

            it("onCapitalWithdrawn should revert if not called by CapitalPool", async function () {
                await expect(riskManager.connect(nonParty).onCapitalWithdrawn(underwriter1.address, 100, false))
                    .to.be.revertedWithCustomError(riskManager, "NotCapitalPool");
            });

            it("updateCoverageSold should revert if not called by PolicyManager", async function() {
                await expect(riskManager.connect(nonParty).updateCoverageSold(POOL_ID_1, 100, true))
                    .to.be.revertedWithCustomError(riskManager, "NotPolicyManager");
            });

            it("updateCoverageSold should update pool data when called by PolicyManager", async function() {
                await mockPoolRegistry.connect(owner).setPoolData(POOL_ID_1, mockUsdc.target, 0, 0, 0, false, committee.address, 0);
                await ethers.provider.send("hardhat_impersonateAccount", [mockPolicyManager.target]);
                const pmSigner = await ethers.getSigner(mockPolicyManager.target);
                await ethers.provider.send("hardhat_setBalance", [mockPolicyManager.target, "0x1000000000000000000"]);
                await riskManager.connect(pmSigner).updateCoverageSold(POOL_ID_1, 100, true);
                await ethers.provider.send("hardhat_stopImpersonatingAccount", [mockPolicyManager.target]);
                const pool = await mockPoolRegistry.pools(POOL_ID_1);
                expect(pool.totalCoverageSold).to.equal(100n);
            });
            
            it("onCapitalWithdrawn should handle partial withdrawal", async function() {
                const pledge = ethers.parseUnits("1000", 6);
                const partialWithdrawal = ethers.parseUnits("400", 6);
                await mockCapitalPool.triggerOnCapitalDeposited(riskManager.target, underwriter1.address, pledge);
                await mockPoolRegistry.setPoolCount(1);
                await mockCapitalPool.setUnderwriterAdapterAddress(underwriter1.address, nonParty.address);
                await riskManager.connect(underwriter1).allocateCapital([POOL_ID_1]);

                await mockLossDistributor.setPendingLoss(underwriter1.address, POOL_ID_1, 0);
                
                // Perform a partial withdrawal
                await mockCapitalPool.triggerOnCapitalWithdrawn(riskManager.target, underwriter1.address, partialWithdrawal, false);
                
                expect(await riskManager.underwriterTotalPledge(underwriter1.address)).to.equal(pledge - partialWithdrawal);
                expect(await riskManager.isAllocatedToPool(underwriter1.address, POOL_ID_1)).to.be.true;
            });

            it("onCapitalDeposited should increase pledge when called by CapitalPool", async function () {
                const amount = ethers.parseUnits("1000", 6);
                await mockCapitalPool.triggerOnCapitalDeposited(riskManager.target, underwriter1.address, amount);
                expect(await riskManager.underwriterTotalPledge(underwriter1.address)).to.equal(amount);
            });

            it("onWithdrawalRequested should mark pending withdrawal for each pool", async function () {
                const amount = ethers.parseUnits("500", 6);
                await mockCapitalPool.triggerOnCapitalDeposited(riskManager.target, underwriter1.address, amount);
                await mockPoolRegistry.setPoolCount(2);
                await mockCapitalPool.setUnderwriterAdapterAddress(underwriter1.address, nonParty.address);
                await riskManager.connect(underwriter1).allocateCapital([POOL_ID_1, POOL_ID_2]);

                await mockCapitalPool.triggerOnWithdrawalRequested(riskManager.target, underwriter1.address, amount);
                const pool1 = await mockPoolRegistry.pools(POOL_ID_1);
                const pool2 = await mockPoolRegistry.pools(POOL_ID_2);
                expect(pool1.capitalPendingWithdrawal).to.equal(amount);
                expect(pool2.capitalPendingWithdrawal).to.equal(amount);
            });

            it("onCapitalWithdrawn should handle full withdrawal", async function () {
                const amount = ethers.parseUnits("1000", 6);
                await mockCapitalPool.triggerOnCapitalDeposited(riskManager.target, underwriter1.address, amount);
                await mockPoolRegistry.setPoolCount(1);
                await mockCapitalPool.setUnderwriterAdapterAddress(underwriter1.address, nonParty.address);
                await riskManager.connect(underwriter1).allocateCapital([POOL_ID_1]);
                await mockLossDistributor.setPendingLoss(underwriter1.address, POOL_ID_1, 0);

                await mockCapitalPool.triggerOnCapitalWithdrawn(riskManager.target, underwriter1.address, amount, true);

                expect(await riskManager.underwriterTotalPledge(underwriter1.address)).to.equal(0);
                expect(await riskManager.isAllocatedToPool(underwriter1.address, POOL_ID_1)).to.be.false;
                const allocs = await getAllocations(underwriter1.address);
                expect(allocs).to.be.empty;
            });
        });

        describe("Reward Claims", function () {
            it("claimPremiumRewards should call the reward distributor", async function () {
                const amount = ethers.parseUnits("1000", 6);
                await mockCapitalPool.triggerOnCapitalDeposited(riskManager.target, underwriter1.address, amount);
                await mockPoolRegistry.setPoolCount(1);
                await mockPoolRegistry.connect(owner).setPoolData(POOL_ID_1, mockUsdc.target, amount, 0, 0, false, committee.address, 0);
                await mockCapitalPool.setUnderwriterAdapterAddress(underwriter1.address, nonParty.address);
                await riskManager.connect(underwriter1).allocateCapital([POOL_ID_1]);

                await riskManager.connect(underwriter1).claimPremiumRewards(POOL_ID_1);
                expect(await mockRewardDistributor.claimCallCount()).to.equal(1);
                expect(await mockRewardDistributor.lastClaimUser()).to.equal(underwriter1.address);
            });

            it("claimDistressedAssets should call the cat pool", async function () {
                await mockPoolRegistry.connect(owner).setPoolData(POOL_ID_1, mockUsdc.target, 0, 0, 0, false, committee.address, 0);
                await riskManager.connect(nonParty).claimDistressedAssets(POOL_ID_1);
                expect(await mockCatPool.claimProtocolRewardsCallCount()).to.equal(1);
                expect(await mockCatPool.last_claimProtocolToken()).to.equal(mockUsdc.target);
            });
        });

         describe("Security", function() {
            it("Should prevent re-entrancy in allocateCapital", async function() {
                const MaliciousPoolRegistryFactory = await ethers.getContractFactory("MaliciousPoolRegistry");
                const maliciousPoolRegistry = await MaliciousPoolRegistryFactory.deploy();
                await maliciousPoolRegistry.setRiskManager(riskManager.target);

                // Replace the mock with our malicious contract
                await riskManager.connect(owner).setAddresses(
                    mockCapitalPool.target,
                    maliciousPoolRegistry.target,
                    mockPolicyManager.target,
                    mockCatPool.target,
                    mockLossDistributor.target,
                    mockRewardDistributor.target
                );

                const PLEDGE_AMOUNT = ethers.parseUnits("10000", 6);
                await mockCapitalPool.triggerOnCapitalDeposited(riskManager.target, underwriter1.address, PLEDGE_AMOUNT);
                await mockCapitalPool.setUnderwriterAdapterAddress(underwriter1.address, nonParty.address);

                // The malicious contract will try to re-enter `allocateCapital`
                await expect(riskManager.connect(underwriter1).allocateCapital([POOL_ID_1]))
                    .to.be.revertedWithCustomError(riskManager, "ReentrancyGuardReentrantCall");
            });
        });
    });
});

