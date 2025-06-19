// test/PoolRegistry.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PoolRegistry", function () {
    let PoolRegistry;
    let poolRegistry;
    let owner;
    let riskManager;
    let nonOwner;
    let adapter1, adapter2, adapter3;
    let token;

    // A sample rate model for creating pools
    const sampleRateModel = {
        base: ethers.parseUnits("0.01", 18), // 1%
        slope1: ethers.parseUnits("0.05", 18), // 5%
        slope2: ethers.parseUnits("0.1", 18), // 10%
        kink: ethers.parseUnits("0.8", 18), // 80%
    };
    const sampleClaimFee = 500; // 5%

    beforeEach(async function () {
        // Get signers
        [owner, riskManager, nonOwner, adapter1, adapter2, adapter3] = await ethers.getSigners();

        // Deploy a mock ERC20 token for testing
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        token = await MockERC20.deploy("Mock Token", "MTK", 18);
        await token.waitForDeployment();


        // Deploy the PoolRegistry contract
        PoolRegistry = await ethers.getContractFactory("PoolRegistry");
        poolRegistry = await PoolRegistry.deploy(owner.address, riskManager.address);
        await poolRegistry.waitForDeployment();
    });

    // Mock ERC20 contract for testing purposes
    const MockERC20Artifact = {
        "contractName": "MockERC20",
        "abi": [
            {"inputs":[{"internalType":"string","name":"name","type":"string"},{"internalType":"string","name":"symbol","type":"string"},{"internalType":"uint256","name":"initialSupply","type":"uint256"}],"stateMutability":"nonpayable","type":"constructor"},
            {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"owner","type":"address"},{"indexed":true,"internalType":"address","name":"spender","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Approval","type":"event"},
            {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"from","type":"address"},{"indexed":true,"internalType":"address","name":"to","type":"address"},{"indexed":false,"internalType":"uint256","name":"value","type":"uint256"}],"name":"Transfer","type":"event"},
            {"inputs":[{"internalType":"address","name":"owner","type":"address"},{"internalType":"address","name":"spender","type":"address"}],"name":"allowance","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
            {"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},
            {"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
            {"inputs":[],"name":"decimals","outputs":[{"internalType":"uint8","name":"","type":"uint8"}],"stateMutability":"view","type":"function"},
            {"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"subtractedValue","type":"uint256"}],"name":"decreaseAllowance","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},
            {"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"addedValue","type":"uint256"}],"name":"increaseAllowance","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},
            {"inputs":[],"name":"name","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},
            {"inputs":[],"name":"symbol","outputs":[{"internalType":"string","name":"","type":"string"}],"stateMutability":"view","type":"function"},
            {"inputs":[],"name":"totalSupply","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
            {"inputs":[{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},
            {"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"}
        ],
    };
    
    // We need to re-link the MockERC20 factory since we are using its artifact definition
    ethers.ContractFactory.getContractFactory = async (name, signer) => {
        if (name === "MockERC20") {
            const factory = new ethers.ContractFactory(MockERC20Artifact.abi, MockERC20Artifact.bytecode, signer);
            return factory;
        }
        return ethers.ContractFactory.getContractFactory(name, signer);
    };


    describe("Deployment", function () {
        it("Should set the correct owner", async function () {
            expect(await poolRegistry.owner()).to.equal(owner.address);
        });

        it("Should set the correct initial risk manager", async function () {
            expect(await poolRegistry.riskManager()).to.equal(riskManager.address);
        });

        it("Should start with zero pools", async function () {
            expect(await poolRegistry.getPoolCount()).to.equal(0);
        });
    });

    describe("Ownership and Role Management", function () {
        describe("setRiskManager()", function () {
            it("Should allow the owner to set a new risk manager", async function () {
                await expect(poolRegistry.connect(owner).setRiskManager(nonOwner.address))
                    .to.not.be.reverted;
                expect(await poolRegistry.riskManager()).to.equal(nonOwner.address);
            });

            it("Should prevent non-owners from setting a new risk manager", async function () {
                await expect(poolRegistry.connect(nonOwner).setRiskManager(nonOwner.address))
                    .to.be.revertedWithCustomError(PoolRegistry, "OwnableUnauthorizedAccount")
                    .withArgs(nonOwner.address);
            });

            it("Should prevent setting the risk manager to the zero address", async function () {
                await expect(poolRegistry.connect(owner).setRiskManager(ethers.ZeroAddress))
                    .to.be.revertedWith("PR: Zero address");
            });
        });
    });

    describe("Risk Manager Functions", function () {
        describe("addProtocolRiskPool()", function () {
            it("Should allow the risk manager to add a new pool", async function () {
                await expect(poolRegistry.connect(riskManager).addProtocolRiskPool(
                    token.target,
                    sampleRateModel,
                    sampleClaimFee
                )).to.not.be.reverted;

                expect(await poolRegistry.getPoolCount()).to.equal(1);
                
                const poolData = await poolRegistry.getPoolData(0);
                expect(poolData.protocolTokenToCover).to.equal(token.target);
                expect(poolData.totalCapitalPledgedToPool).to.equal(0);
                expect(poolData.totalCoverageSold).to.equal(0);
                expect(poolData.isPaused).to.be.false;
                expect(poolData.claimFeeBps).to.equal(sampleClaimFee);

                const rateModel = await poolRegistry.getPoolRateModel(0);
                expect(rateModel.base).to.equal(sampleRateModel.base);
                expect(rateModel.slope1).to.equal(sampleRateModel.slope1);
            });

            it("Should prevent non-risk managers from adding a pool", async function () {
                await expect(poolRegistry.connect(nonOwner).addProtocolRiskPool(
                    token.target,
                    sampleRateModel,
                    sampleClaimFee
                )).to.be.revertedWith("PR: Not RiskManager");
            });

             it("Should return the correct poolId on creation", async function() {
                // First pool should have ID 0
                await poolRegistry.connect(riskManager).addProtocolRiskPool(token.target, sampleRateModel, sampleClaimFee);
                
                // Second pool should have ID 1
                await poolRegistry.connect(riskManager).addProtocolRiskPool(token.target, sampleRateModel, sampleClaimFee);

                expect(await poolRegistry.getPoolCount()).to.equal(2);
                // Check if we can get data for pool 1
                const poolData = await poolRegistry.getPoolData(1);
                expect(poolData.totalCapitalPledgedToPool).to.equal(0);
            });
        });



        describe("updateCapitalAllocation()", function () {
            beforeEach(async function () {
                await poolRegistry.connect(riskManager).addProtocolRiskPool(
                    token.target,
                    sampleRateModel,
                    sampleClaimFee
                );
            });
            const pledgeAmount = ethers.parseUnits("1000", 18);

            it("Should correctly allocate capital and add a new adapter", async function () {
                await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter1.address, pledgeAmount, true);

                const poolData = await poolRegistry.getPoolData(0);
                expect(poolData.totalCapitalPledgedToPool).to.equal(pledgeAmount);

                const capitalPerAdapter = await poolRegistry.getCapitalPerAdapter(0, adapter1.address);
                expect(capitalPerAdapter).to.equal(pledgeAmount);

                const activeAdapters = await poolRegistry.getPoolActiveAdapters(0);
                expect(activeAdapters).to.have.lengthOf(1);
                expect(activeAdapters[0]).to.equal(adapter1.address);
            });

            it("Should correctly increase capital for an existing adapter", async function () {
                await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter1.address, pledgeAmount, true);
                await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter1.address, pledgeAmount, true);
                
                const poolData = await poolRegistry.getPoolData(0);
                expect(poolData.totalCapitalPledgedToPool).to.equal(pledgeAmount * 2n);

                const capitalPerAdapter = await poolRegistry.getCapitalPerAdapter(0, adapter1.address);
                expect(capitalPerAdapter).to.equal(pledgeAmount * 2n);
                
                const activeAdapters = await poolRegistry.getPoolActiveAdapters(0);
                expect(activeAdapters).to.have.lengthOf(1); // Should not add the adapter again
            });

            it("Should correctly de-allocate capital", async function () {
                const initialAmount = ethers.parseUnits("2000", 18);
                const deallocateAmount = ethers.parseUnits("500", 18);
                await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter1.address, initialAmount, true);

                await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter1.address, deallocateAmount, false);

                const poolData = await poolRegistry.getPoolData(0);
                expect(poolData.totalCapitalPledgedToPool).to.equal(initialAmount - deallocateAmount);

                const capitalPerAdapter = await poolRegistry.getCapitalPerAdapter(0, adapter1.address);
                expect(capitalPerAdapter).to.equal(initialAmount - deallocateAmount);
            });

            it("Should remove an adapter when its capital is fully de-allocated", async function () {
                // Add two adapters
                await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter1.address, pledgeAmount, true);
                await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter2.address, pledgeAmount, true);

                let activeAdapters = await poolRegistry.getPoolActiveAdapters(0);
                expect(activeAdapters).to.have.lengthOf(2);
                expect(activeAdapters).to.include(adapter1.address);
                expect(activeAdapters).to.include(adapter2.address);
                
                // Remove adapter1
                await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter1.address, pledgeAmount, false);

                activeAdapters = await poolRegistry.getPoolActiveAdapters(0);
                expect(activeAdapters).to.have.lengthOf(1);
                expect(activeAdapters[0]).to.equal(adapter2.address); // adapter2 should now be at index 0
                expect(await poolRegistry.getCapitalPerAdapter(0, adapter1.address)).to.equal(0);
            });
            
            it("Should handle removing an adapter from the middle of the array", async function() {
                // 1. Add three adapters
                await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter1.address, pledgeAmount, true);
                await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter2.address, pledgeAmount, true);
                await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter3.address, pledgeAmount, true);
                
                let activeAdapters = await poolRegistry.getPoolActiveAdapters(0);
                expect(activeAdapters).to.deep.equal([adapter1.address, adapter2.address, adapter3.address]);

                // 2. Remove the middle adapter
                await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter2.address, pledgeAmount, false);

                // 3. Assert the new state
                activeAdapters = await poolRegistry.getPoolActiveAdapters(0);
                expect(activeAdapters).to.have.lengthOf(2);
                expect(activeAdapters).to.deep.equal([adapter1.address, adapter3.address]); // adapter3 replaces adapter2
                expect(await poolRegistry.getCapitalPerAdapter(0, adapter2.address)).to.equal(0);
                
                const poolData = await poolRegistry.getPoolData(0);
                expect(poolData.totalCapitalPledgedToPool).to.equal(pledgeAmount * 2n);
            });

            it("Should prevent non-risk managers from updating capital allocation", async function () {
                 await expect(poolRegistry.connect(nonOwner).updateCapitalAllocation(0, adapter1.address, pledgeAmount, true))
                    .to.be.revertedWith("PR: Not RiskManager");
            });
        });

        describe("updateCapitalPendingWithdrawal()", function () {
            beforeEach(async function () {
                await poolRegistry.connect(riskManager).addProtocolRiskPool(
                    token.target,
                    sampleRateModel,
                    sampleClaimFee
                );
            });
            const amount = ethers.parseUnits("100", 18);

            it("Should correctly increase capital pending withdrawal on request", async function () {
                await poolRegistry.connect(riskManager).updateCapitalPendingWithdrawal(0, amount, true);
                const poolData = await poolRegistry.getPoolData(0);
                expect(poolData.capitalPendingWithdrawal).to.equal(amount);
            });

            it("Should correctly decrease capital pending withdrawal on fulfillment", async function () {
                await poolRegistry.connect(riskManager).updateCapitalPendingWithdrawal(0, amount, true);
                await poolRegistry.connect(riskManager).updateCapitalPendingWithdrawal(0, amount, false);
                const poolData = await poolRegistry.getPoolData(0);
                expect(poolData.capitalPendingWithdrawal).to.equal(0);
            });

            it("Should prevent non-risk managers from updating", async function () {
                 await expect(poolRegistry.connect(nonOwner).updateCapitalPendingWithdrawal(0, amount, true))
                    .to.be.revertedWith("PR: Not RiskManager");
            });
        });
        
        describe("updateCoverageSold()", function () {
            beforeEach(async function () {
                await poolRegistry.connect(riskManager).addProtocolRiskPool(
                    token.target,
                    sampleRateModel,
                    sampleClaimFee
                );
            });
            const amount = ethers.parseUnits("500", 18);

            it("Should correctly increase total coverage sold on sale", async function () {
                await poolRegistry.connect(riskManager).updateCoverageSold(0, amount, true);
                const poolData = await poolRegistry.getPoolData(0);
                expect(poolData.totalCoverageSold).to.equal(amount);
            });

            it("Should correctly decrease total coverage sold on expiry/claim", async function () {
                await poolRegistry.connect(riskManager).updateCoverageSold(0, amount, true);
                await poolRegistry.connect(riskManager).updateCoverageSold(0, amount, false);
                const poolData = await poolRegistry.getPoolData(0);
                expect(poolData.totalCoverageSold).to.equal(0);
            });

            it("Should prevent non-risk managers from updating", async function () {
                 await expect(poolRegistry.connect(nonOwner).updateCoverageSold(0, amount, true))
                    .to.be.revertedWith("PR: Not RiskManager");
            });
        });

        describe("setPauseState()", function () {
            beforeEach(async function () {
                await poolRegistry.connect(riskManager).addProtocolRiskPool(
                    token.target,
                    sampleRateModel,
                    sampleClaimFee
                );
            });
            it("Should correctly pause a pool", async function () {
                await poolRegistry.connect(riskManager).setPauseState(0, true);
                const poolData = await poolRegistry.getPoolData(0);
                expect(poolData.isPaused).to.be.true;
                
                // Check if timestamp is set
                const blockNum = await ethers.provider.getBlockNumber();
                const block = await ethers.provider.getBlock(blockNum);
                const pool = await poolRegistry.protocolRiskPools(0);
                expect(pool.pauseTimestamp).to.equal(block.timestamp);
            });

            it("Should correctly unpause a pool", async function () {
                // First pause it
                await poolRegistry.connect(riskManager).setPauseState(0, true);
                // Then unpause it
                await poolRegistry.connect(riskManager).setPauseState(0, false);

                const poolData = await poolRegistry.getPoolData(0);
                expect(poolData.isPaused).to.be.false;

                const pool = await poolRegistry.protocolRiskPools(0);
                expect(pool.pauseTimestamp).to.equal(0);
            });

             it("Should prevent non-risk managers from updating", async function () {
                 await expect(poolRegistry.connect(nonOwner).setPauseState(0, true))
                    .to.be.revertedWith("PR: Not RiskManager");
            });
        });

        describe("setFeeRecipient()", function () {
            beforeEach(async function () {
                await poolRegistry.connect(riskManager).addProtocolRiskPool(
                    token.target,
                    sampleRateModel,
                    sampleClaimFee
                );
            });
             it("Should allow the risk manager to set the fee recipient", async function () {
                await poolRegistry.connect(riskManager).setFeeRecipient(0, nonOwner.address);
                const poolData = await poolRegistry.getPoolData(0);
                expect(poolData.feeRecipient).to.equal(nonOwner.address);
            });
            
            it("Should prevent non-risk managers from setting the fee recipient", async function () {
                 await expect(poolRegistry.connect(nonOwner).setFeeRecipient(0, nonOwner.address))
                    .to.be.revertedWith("PR: Not RiskManager");
            });
        });
    });
    
    describe("View Functions", function() {
        beforeEach(async function () {
            // Add pool 0
            await poolRegistry.connect(riskManager).addProtocolRiskPool(
                token.target,
                sampleRateModel,
                sampleClaimFee
            );
             // Add pool 1
            await poolRegistry.connect(riskManager).addProtocolRiskPool(
                owner.address, // Using another address as a mock token
                sampleRateModel,
                sampleClaimFee
            );

            // Add capital to pool 0
            await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter1.address, ethers.parseUnits("1000", 18), true);
            await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter2.address, ethers.parseUnits("2000", 18), true);

            // Update other data for pool 0
            await poolRegistry.connect(riskManager).updateCoverageSold(0, ethers.parseUnits("500", 18), true);
            await poolRegistry.connect(riskManager).updateCapitalPendingWithdrawal(0, ethers.parseUnits("100", 18), true);
        });

        it("getPoolCount() should return the correct number of pools", async function() {
            expect(await poolRegistry.getPoolCount()).to.equal(2);
        });

        it("getPoolData() should return correct data for a specific pool", async function() {
            const poolData = await poolRegistry.getPoolData(0);
            expect(poolData.protocolTokenToCover).to.equal(token.target);
            expect(poolData.totalCapitalPledgedToPool).to.equal(ethers.parseUnits("3000", 18));
            expect(poolData.totalCoverageSold).to.equal(ethers.parseUnits("500", 18));
            expect(poolData.capitalPendingWithdrawal).to.equal(ethers.parseUnits("100", 18));
            expect(poolData.isPaused).to.be.false;
        });

        it("getPoolRateModel() should return the correct rate model", async function() {
            const rateModel = await poolRegistry.getPoolRateModel(0);
            expect(rateModel.base).to.equal(sampleRateModel.base);
            expect(rateModel.slope1).to.equal(sampleRateModel.slope1);
            expect(rateModel.slope2).to.equal(sampleRateModel.slope2);
            expect(rateModel.kink).to.equal(sampleRateModel.kink);
        });
        
        it("getPoolActiveAdapters() should return the list of active adapters", async function() {
            const adapters = await poolRegistry.getPoolActiveAdapters(0);
            expect(adapters).to.have.lengthOf(2);
            expect(adapters).to.contain(adapter1.address);
            expect(adapters).to.contain(adapter2.address);
        });

        it("getCapitalPerAdapter() should return correct capital for a specific adapter", async function() {
            expect(await poolRegistry.getCapitalPerAdapter(0, adapter1.address)).to.equal(ethers.parseUnits("1000", 18));
            expect(await poolRegistry.getCapitalPerAdapter(0, adapter2.address)).to.equal(ethers.parseUnits("2000", 18));
            expect(await poolRegistry.getCapitalPerAdapter(0, adapter3.address)).to.equal(0); // Non-existent adapter
        });
        
        it("getPoolPayoutData() should return all necessary payout data", async function() {
            const [adapters, capitalPerAdapter, totalCapital] = await poolRegistry.getPoolPayoutData(0);
            
            expect(adapters).to.have.lengthOf(2);
            expect(capitalPerAdapter).to.have.lengthOf(2);
            
            // Note: The order might not be guaranteed, so we check inclusion and values
            const adapter1Index = adapters.indexOf(adapter1.address);
            const adapter2Index = adapters.indexOf(adapter2.address);
            
            expect(adapter1Index).to.be.oneOf([0, 1]);
            expect(adapter2Index).to.be.oneOf([0, 1]);

            expect(capitalPerAdapter[adapter1Index]).to.equal(ethers.parseUnits("1000", 18));
            expect(capitalPerAdapter[adapter2Index]).to.equal(ethers.parseUnits("2000", 18));
            
            expect(totalCapital).to.equal(ethers.parseUnits("3000", 18));
        });
    });

    describe("Edge Cases and Failure Conditions", function() {
        beforeEach(async function () {
            // Add a single pool for testing
            await poolRegistry.connect(riskManager).addProtocolRiskPool(
                token.target,
                sampleRateModel,
                sampleClaimFee
            );
        });

        it("Should revert when calling functions with an out-of-bounds poolId", async function() {
            const invalidPoolId = 99;
            const amount = ethers.parseUnits("100", 18);
            
            // Note: Hardhat/Ethers may not provide a specific revert reason for array out-of-bounds access.
            // It often reverts without a message or with a generic panic code.
            await expect(poolRegistry.getPoolData(invalidPoolId)).to.be.reverted;
            await expect(poolRegistry.getPoolRateModel(invalidPoolId)).to.be.reverted;
            await expect(poolRegistry.updateCapitalAllocation(invalidPoolId, adapter1.address, amount, true)).to.be.reverted;
            await expect(poolRegistry.setPauseState(invalidPoolId, true)).to.be.reverted;
        });

        it("Should revert on arithmetic underflow when de-allocating capital", async function() {
            const amount = ethers.parseUnits("100", 18);
            await poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter1.address, amount, true);
            
            // Try to de-allocate more than available
            await expect(poolRegistry.connect(riskManager).updateCapitalAllocation(0, adapter1.address, amount + 1n, false))
                .to.be.revertedWithPanic(0x11); // Arithmetic overflow/underflow
        });

        it("Should revert on arithmetic underflow for pending withdrawals", async function() {
            const amount = ethers.parseUnits("100", 18);
            await poolRegistry.connect(riskManager).updateCapitalPendingWithdrawal(0, amount, true);

            // Try to decrease more than available
            await expect(poolRegistry.connect(riskManager).updateCapitalPendingWithdrawal(0, amount + 1n, false))
                .to.be.revertedWithPanic(0x11);
        });
        
        it("Should revert on arithmetic underflow for coverage sold", async function() {
            const amount = ethers.parseUnits("500", 18);
            await poolRegistry.connect(riskManager).updateCoverageSold(0, amount, true);
            
            // Try to decrease more than available
            await expect(poolRegistry.connect(riskManager).updateCoverageSold(0, amount + 1n, false))
                .to.be.revertedWithPanic(0x11);
        });
    });

    describe("View Functions on Initial State Pool", function() {
        beforeEach(async function () {
            // Add a single, empty pool
            await poolRegistry.connect(riskManager).addProtocolRiskPool(
                token.target,
                sampleRateModel,
                sampleClaimFee
            );
        });

        it("getPoolData should return zero/default values for a new pool", async function() {
            const poolData = await poolRegistry.getPoolData(0);
            expect(poolData.totalCapitalPledgedToPool).to.equal(0);
            expect(poolData.totalCoverageSold).to.equal(0);
            expect(poolData.capitalPendingWithdrawal).to.equal(0);
            expect(poolData.isPaused).to.be.false;
            expect(poolData.feeRecipient).to.equal(ethers.ZeroAddress);
            expect(poolData.claimFeeBps).to.equal(sampleClaimFee);
        });

        it("getPoolActiveAdapters should return an empty array for a new pool", async function() {
            const adapters = await poolRegistry.getPoolActiveAdapters(0);
            expect(adapters).to.be.an('array').that.is.empty;
        });

        it("getPoolPayoutData should return empty arrays and zero total for a new pool", async function() {
            const [adapters, capitalPerAdapter, totalCapital] = await poolRegistry.getPoolPayoutData(0);
            expect(adapters).to.be.an('array').that.is.empty;
            expect(capitalPerAdapter).to.be.an('array').that.is.empty;
            expect(totalCapital).to.equal(0);
        });
    });
});
