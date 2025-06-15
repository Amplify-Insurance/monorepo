// test/PolicyManager.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Helper function to create mock contracts from an ABI
async function deployMock(contractName, abi, signer) {
    const factory = new ethers.ContractFactory(abi, `0x${'6080604052348015600f57600080fd5b50600080fdfe'}`, signer);
    return await factory.deploy();
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

    // --- Mock ABIs ---
    const iPoolRegistryAbi = require("../artifacts/contracts/PolicyManager.sol/IPoolRegistry.json").abi;
    const iCapitalPoolAbi = require("../artifacts/contracts/PolicyManager.sol/ICapitalPool.json").abi;
    const iCatInsurancePoolAbi = require("../artifacts/contracts/PolicyManager.sol/ICatInsurancePool.json").abi;
    const iPolicyNFTAbi = require("../artifacts/contracts/PolicyManager.sol/IPolicyNFT.json").abi;
    const iRewardDistributorAbi = require("../artifacts/contracts/PolicyManager.sol/IRewardDistributor.json").abi;
    const iRiskManagerHookAbi = require("../artifacts/contracts/PolicyManager.sol/IRiskManager_PM_Hook.json").abi;
    const erc20Abi = require("@openzeppelin/contracts/build/contracts/ERC20.json").abi;


    beforeEach(async function () {
        // --- Get Signers ---
        [owner, user1, user2] = await ethers.getSigners();

        // --- Deploy Mocks ---
        mockPoolRegistry = await deployMock("IPoolRegistry", iPoolRegistryAbi, owner);
        mockCapitalPool = await deployMock("ICapitalPool", iCapitalPoolAbi, owner);
        mockCatPool = await deployMock("ICatInsurancePool", iCatInsurancePoolAbi, owner);
        mockPolicyNFT = await deployMock("IPolicyNFT", iPolicyNFTAbi, owner);
        mockRewardDistributor = await deployMock("IRewardDistributor", iRewardDistributorAbi, owner);
        mockRiskManager = await deployMock("IRiskManager_PM_Hook", iRiskManagerHookAbi, owner);
        
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        mockUsdc = await MockERC20Factory.deploy("USD Coin", "USDC", ethers.parseUnits("1000000", 6));
        
        // --- Deploy PolicyManager ---
        const PolicyManagerFactory = await ethers.getContractFactory("PolicyManager");
        policyManager = await PolicyManagerFactory.deploy(mockPolicyNFT.target, owner.address);

        // --- Initial Setup ---
        // Mint USDC to users
        await mockUsdc.transfer(user1.address, ethers.parseUnits("10000", 6));
        await mockUsdc.transfer(user2.address, ethers.parseUnits("10000", 6));

        // User1 approves PolicyManager to spend USDC
        await mockUsdc.connect(user1).approve(policyManager.target, ethers.MaxUint256);

        // Set mock responses
        await mockCapitalPool.mock.underlyingAsset.returns(mockUsdc.target);
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
                // Mock PoolRegistry responses
                await mockPoolRegistry.mock.getPoolData.withArgs(POOL_ID).returns(
                    mockUsdc.target, // protocolTokenToCover
                    ethers.parseUnits("100000", 6), // totalCapitalPledgedToPool
                    0, // totalCoverageSold
                    0, // capitalPendingWithdrawal
                    false, // isPaused
                    owner.address // feeRecipient
                );
                
                // Mock RateModel
                const rateModel = {
                    base: 100, // 1%
                    slope1: 200, // 2%
                    slope2: 500, // 5%
                    kink: 8000 // 80%
                };
                await mockPoolRegistry.mock.getPoolRateModel.withArgs(POOL_ID).returns(rateModel);
            });

            it("Should successfully purchase cover", async function() {
                // Mock dependencies
                await mockRiskManager.mock.updateCoverageSold.withArgs(POOL_ID, COVERAGE_AMOUNT, true).returns();
                await mockPolicyNFT.mock.mint.returns(1); // Return policyId 1

                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, INITIAL_PREMIUM_DEPOSIT))
                    .to.not.be.reverted;

                // Check USDC transfer
                expect(await mockUsdc.balanceOf(policyManager.target)).to.equal(INITIAL_PREMIUM_DEPOSIT);
            });

            it("Should revert if pool is paused", async function() {
                await mockPoolRegistry.mock.getPoolData.withArgs(POOL_ID).returns(
                    mockUsdc.target, ethers.parseUnits("100000", 6), 0, 0, true, owner.address
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
                 await mockPoolRegistry.mock.getPoolData.withArgs(POOL_ID).returns(
                    mockUsdc.target, 
                    ethers.parseUnits("10000", 6), // Pledged capital
                    ethers.parseUnits("5000", 6), // Already sold
                    0, false, owner.address
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
                await mockPolicyNFT.mock.getPolicy.withArgs(POLICY_ID).returns(policy);
                await mockPolicyNFT.mock.ownerOf.withArgs(POLICY_ID).returns(user1.address);

                // Setup mocks for the cancellation process
                await mockRiskManager.mock.updateCoverageSold.withArgs(POOL_ID, COVERAGE_AMOUNT, false).returns();
                await mockPolicyNFT.mock.burn.withArgs(POLICY_ID).returns();
            });

            it("Should successfully cancel cover after cooldown", async function() {
                // Move time forward past the activation time
                await time.increase(COOLDOWN_PERIOD + 1);

                // Mock premium drain logic (assume no time passed since activation, so no drain)
                const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
                await mockPoolRegistry.mock.getPoolRateModel.withArgs(POOL_ID).returns(rateModel);
                await mockPoolRegistry.mock.getPoolData.withArgs(POOL_ID).returns(
                    mockUsdc.target, ethers.parseUnits("100000", 6), COVERAGE_AMOUNT, 0, false, owner.address
                );

                // Fund the contract with premium to refund
                await mockUsdc.connect(owner).transfer(policyManager.target, INITIAL_PREMIUM_DEPOSIT);

                const initialUserBalance = await mockUsdc.balanceOf(user1.address);

                await policyManager.connect(user1).cancelCover(POLICY_ID);

                // Check refund
                const finalUserBalance = await mockUsdc.balanceOf(user1.address);
                expect(finalUserBalance - initialUserBalance).to.equal(INITIAL_PREMIUM_DEPOSIT);
            });
            
            it("Should revert if called within cooldown period", async function() {
                await expect(policyManager.connect(user1).cancelCover(POLICY_ID))
                    .to.be.revertedWithCustomError(policyManager, "CooldownActive");
            });
            
            it("Should revert if caller is not the policy owner", async function() {
                await mockPolicyNFT.mock.ownerOf.withArgs(POLICY_ID).returns(user2.address);
                await expect(policyManager.connect(user1).cancelCover(POLICY_ID))
                    .to.be.revertedWithCustomError(policyManager, "NotPolicyOwner");
            });

            it("Should revert if policy is already terminated (coverage is 0)", async function() {
                const terminatedPolicy = {
                    poolId: POOL_ID, coverage: 0, activation: 0, premiumDeposit: 0, lastDrainTime: 0
                };
                await mockPolicyNFT.mock.getPolicy.withArgs(POLICY_ID).returns(terminatedPolicy);

                await expect(policyManager.connect(user1).cancelCover(POLICY_ID))
                    .to.be.revertedWithCustomError(policyManager, "PolicyAlreadyTerminated");
            });
        });

        // --- NEW TESTS START HERE ---

        describe("addPremium()", function() {
            const POLICY_ID = 1;
            const PREMIUM_TO_ADD = ethers.parseUnits("50", 6);

            beforeEach(async function() {
                const activationTime = await time.latest();
                const policy = {
                    poolId: POOL_ID,
                    coverage: COVERAGE_AMOUNT,
                    activation: activationTime,
                    premiumDeposit: INITIAL_PREMIUM_DEPOSIT,
                    lastDrainTime: activationTime,
                };
                await mockPolicyNFT.mock.getPolicy.withArgs(POLICY_ID).returns(policy);

                // Mocks needed for _settleAndDrainPremium
                const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
                await mockPoolRegistry.mock.getPoolRateModel.withArgs(POOL_ID).returns(rateModel);
                await mockPoolRegistry.mock.getPoolData.withArgs(POOL_ID).returns(
                    mockUsdc.target, ethers.parseUnits("100000", 6), COVERAGE_AMOUNT, 0, false, owner.address
                );
                await mockCatPool.mock.receiveUsdcPremium.returns();
                await mockRewardDistributor.mock.distribute.returns();
                await mockPolicyNFT.mock.updatePremiumAccount.returns();
            });

            it("Should successfully add premium to a policy", async function() {
                await mockUsdc.connect(owner).transfer(policyManager.target, INITIAL_PREMIUM_DEPOSIT); // Pre-fund contract for drain

                const initialBalance = await mockUsdc.balanceOf(policyManager.target);
                
                await policyManager.connect(user1).addPremium(POLICY_ID, PREMIUM_TO_ADD);

                const finalBalance = await mockUsdc.balanceOf(policyManager.target);
                expect(finalBalance - initialBalance).to.equal(PREMIUM_TO_ADD);

                // Verify that the NFT was updated. The last call to updatePremiumAccount will have the added premium.
                const updateCall = mockPolicyNFT.mock.updatePremiumAccount.getCall(mockPolicyNFT.mock.updatePremiumAccount.callCount - 1);
                expect(updateCall.args[0]).to.equal(POLICY_ID); // policyId
                expect(updateCall.args[1]).to.be.gt(0); // newDeposit
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
                await mockPoolRegistry.mock.getPoolRateModel.withArgs(POOL_ID).returns(rateModel);
            });

            it("Should use slope1 when utilization is below the kink", async function() {
                // Set utilization to 50% (below 80% kink)
                const totalSold = availableCapital / 2n;
                await mockPoolRegistry.mock.getPoolData.withArgs(POOL_ID).returns(
                    mockUsdc.target, availableCapital, totalSold, 0, false, owner.address
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
                await mockPoolRegistry.mock.getPoolData.withArgs(POOL_ID).returns(
                    mockUsdc.target, availableCapital, totalSold, 0, false, owner.address
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
                await mockPoolRegistry.mock.getPoolData.withArgs(POOL_ID).returns(
                    mockUsdc.target, availableCapital, 0, availableCapital, false, owner.address
                );
                
                // This should result in a massive rate, causing any reasonable deposit to fail
                await expect(policyManager.connect(user1).purchaseCover(POOL_ID, COVERAGE_AMOUNT, INITIAL_PREMIUM_DEPOSIT))
                    .to.be.revertedWithCustomError(policyManager, "DepositTooLow");
            });
        });
        
        describe("isPolicyActive()", function() {
            const POLICY_ID = 1;

            beforeEach(async function() {
                const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
                await mockPoolRegistry.mock.getPoolRateModel.withArgs(POOL_ID).returns(rateModel);
                await mockPoolRegistry.mock.getPoolData.withArgs(POOL_ID).returns(
                    mockUsdc.target, ethers.parseUnits("100000", 6), COVERAGE_AMOUNT, 0, false, owner.address
                );
            });

            it("Should return false for a terminated policy (coverage=0)", async function() {
                const terminatedPolicy = { coverage: 0 };
                await mockPolicyNFT.mock.getPolicy.withArgs(POLICY_ID).returns(terminatedPolicy);
                expect(await policyManager.isPolicyActive(POLICY_ID)).to.be.false;
            });

            it("Should return true when premium is sufficient", async function() {
                const activationTime = await time.latest();
                const policy = { poolId: POOL_ID, coverage: COVERAGE_AMOUNT, premiumDeposit: INITIAL_PREMIUM_DEPOSIT, lastDrainTime: activationTime };
                await mockPolicyNFT.mock.getPolicy.withArgs(POLICY_ID).returns(policy);
                await time.increase(30 * 24 * 60 * 60); // 30 days
                expect(await policyManager.isPolicyActive(POLICY_ID)).to.be.true;
            });

            it("Should return false when premium has been depleted", async function() {
                const activationTime = await time.latest();
                // A very small premium that will run out quickly
                const lowPremium = ethers.parseUnits("0.01", 6);
                const policy = { poolId: POOL_ID, coverage: COVERAGE_AMOUNT, premiumDeposit: lowPremium, lastDrainTime: activationTime };
                await mockPolicyNFT.mock.getPolicy.withArgs(POLICY_ID).returns(policy);

                await time.increase(30 * 24 * 60 * 60); // 30 days should be enough to deplete it
                expect(await policyManager.isPolicyActive(POLICY_ID)).to.be.false;
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
                    maliciousDistributor.target, // Use the malicious distributor
                    mockRiskManager.target
                );

                const POLICY_ID = 1;
                const activationTime = await time.latest() + COOLDOWN_PERIOD;
                const policy = { poolId: POOL_ID, coverage: COVERAGE_AMOUNT, activation: activationTime, premiumDeposit: INITIAL_PREMIUM_DEPOSIT, lastDrainTime: activationTime };
                
                await mockPolicyNFT.mock.getPolicy.withArgs(POLICY_ID).returns(policy);
                await mockPolicyNFT.mock.ownerOf.withArgs(POLICY_ID).returns(user1.address);
                await mockPolicyNFT.mock.updatePremiumAccount.returns(); // Mock the update call
                
                const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
                await mockPoolRegistry.mock.getPoolRateModel.withArgs(POOL_ID).returns(rateModel);
                await mockPoolRegistry.mock.getPoolData.withArgs(POOL_ID).returns(
                    mockUsdc.target, ethers.parseUnits("100000", 6), COVERAGE_AMOUNT, 0, false, owner.address
                );

                // Setup the malicious contract
                await maliciousDistributor.setTargets(policyManager.target, POLICY_ID);
                await time.increase(COOLDOWN_PERIOD + 1);

                // Fund the PolicyManager so it can attempt a distribution
                await mockUsdc.connect(owner).transfer(policyManager.target, ethers.parseUnits("1", 6));

                // The cancelCover call will trigger a distribution, which will call back to cancelCover again
                await expect(policyManager.connect(user1).cancelCover(POLICY_ID))
                    .to.be.revertedWith("ReentrancyGuard: reentrant call");
            });
        });

        // --- END OF NEW TESTS ---
    });
});

// Helper contract for re-entrancy test
const MaliciousDistributorArtifact = {
    "contractName": "MaliciousDistributor",
    "abi": [
      {
        "inputs": [],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "inputs": [
          { "internalType": "uint256", "name": "poolId", "type": "uint256" },
          { "internalType": "address", "name": "rewardToken", "type": "address" },
          { "internalType": "uint256", "name": "rewardAmount", "type": "uint256" },
          { "internalType": "uint256", "name": "totalPledgeInPool", "type": "uint256" }
        ],
        "name": "distribute",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          { "internalType": "address", "name": "_pm", "type": "address" },
          { "internalType": "uint256", "name": "_policyId", "type": "uint256" }
        ],
        "name": "setTargets",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ],
    "bytecode": "0x608060405234801561001057600080fd5b50600080546001600160a01b0319166001600160a01b0392909216919091179055610196806100436000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c8063198586041461003b578063c697a7a514610078575b600080fd5b610076600480360381019061007191906100e4565b600094939291908152f45050505060405180910390f35b6100a1600480360381019061009c919061012a565b6001600160a01b0316600090815260208152604090205560005490565b6000602082840312156100f557600080fd5b81356001600160a01b038116811461010c57600080fd5b9392505050565b600080600080600060a0868803121561013e57600080fd5b8535945060208601359350610156565b92915050565b600080546001600160a01b0319166001600160a01b039290921691909117905560018154811061018557fe5b600091825260209082015260409020541780546001600160a01b031916905556fea2646970667358221220a0b27acb188f5b8971f54fd63060c2aa835e0c511d7f6c6f663f7397b91d960f64736f6c63430008140033"
};

ethers.ContractFactory.getContractFactory = async (name, signer) => {
    if (name === "MockERC20") {
        const factory = new ethers.ContractFactory(MockERC20Artifact.abi, MockERC20Artifact.bytecode, signer);
        return factory;
    }
    if (name === "MaliciousDistributor") {
        const factory = new ethers.ContractFactory(MaliciousDistributorArtifact.abi, MaliciousDistributorArtifact.bytecode, signer);
        return factory;
    }
    // This is a simplified approach. In a real project, you would have separate artifact files.
    // For this test, we fall back to the default getter.
    const hardhatEthers = require("hardhat").ethers;
    return hardhatEthers.getContractFactory(name, signer);
};
