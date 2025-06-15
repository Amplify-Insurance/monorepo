const { expect } = require("chai");
const { ethers } = require("hardhat");
const hre = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

// To make a direct comparison with the Solidity test, we map the enum values.
const ProtocolRiskIdentifier = {
    NONE: 0,
    PROTOCOL_A: 1,
    PROTOCOL_B: 2,
    LIDO_STETH: 3,
    ROCKET_RETH: 4,
};

// Fixture used across multiple describe blocks
async function deployRiskManagerFixture() {
    const [owner, nonOwner] = await ethers.getSigners();

    // Get contract factories
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const MockCapitalPoolFactory = await ethers.getContractFactory("MockCapitalPool");
    const MockPolicyNFTFactory = await ethers.getContractFactory("MockPolicyNFT");
    const MockCatPoolFactory = await ethers.getContractFactory("MockCatInsurancePool");
    const RiskManagerFactory = await ethers.getContractFactory("RiskManager", owner);

    // Deploy mock tokens
    const usdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
    const stEth = await MockERC20Factory.deploy("Lido Staked Ether", "stETH", 18);
    const wbtc = await MockERC20Factory.deploy("Wrapped BTC", "WBTC", 8);

    // Deploy mock dependency contracts
    const mockCapitalPool = await MockCapitalPoolFactory.deploy(owner.address, usdc.target);
    const mockPolicyNFT = await MockPolicyNFTFactory.deploy(owner.address);
    const mockCatPool = await MockCatPoolFactory.deploy(owner.address);

    // Deploy the main contract-under-test
    const riskManager = await RiskManagerFactory.deploy(
        mockCapitalPool.target,
        mockPolicyNFT.target,
        mockCatPool.target
    );


    return {
        riskManager,
        owner,
        nonOwner,
        usdc,
        stEth,
        wbtc,
    };
}

describe("RiskManager - addProtocolRiskPool", function () {

    it("should revert if the caller is not the owner", async function () {
        const { riskManager, nonOwner, stEth } = await loadFixture(deployRiskManagerFixture);

        const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
        const protocolId = ProtocolRiskIdentifier.LIDO_STETH;

        await expect(
            riskManager.connect(nonOwner).addProtocolRiskPool(stEth.target, rateModel, protocolId)
        ).to.be.revertedWithCustomError(riskManager, "OwnableUnauthorizedAccount").withArgs(nonOwner.address);
    });

    it("should revert if the protocol token address is the zero address", async function () {
        const { riskManager } = await loadFixture(deployRiskManagerFixture);
        const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
        const protocolId = ProtocolRiskIdentifier.PROTOCOL_A;

        await expect(
            riskManager.addProtocolRiskPool(ethers.ZeroAddress, rateModel, protocolId)
        ).to.be.revertedWithCustomError(riskManager, "ZeroAddress");
    });

    it("should allow the owner to add a pool with correct state changes", async function () {
        const { riskManager, usdc, stEth } = await loadFixture(deployRiskManagerFixture);

        const rateModel = { base: 150, slope1: 300, slope2: 600, kink: 7500 };
        const protocolId = ProtocolRiskIdentifier.LIDO_STETH;
        const usdcDecimals = await usdc.decimals();
        const stEthDecimals = await stEth.decimals();
        const expectedScale = 10n ** (stEthDecimals - usdcDecimals);

        await riskManager.addProtocolRiskPool(stEth.target, rateModel, protocolId);

        const newPool = await riskManager.getPoolInfo(0);

        expect(newPool.protocolTokenToCover).to.equal(stEth.target);
        expect(newPool.rateModel.base).to.equal(rateModel.base);
        expect(newPool.rateModel.slope1).to.equal(rateModel.slope1);
        expect(newPool.rateModel.slope2).to.equal(rateModel.slope2);
        expect(newPool.rateModel.kink).to.equal(rateModel.kink);
        expect(newPool.protocolCovered).to.equal(protocolId);
        expect(newPool.protocolTokenDecimals).to.equal(stEthDecimals);
        expect(newPool.scaleToProtocolToken).to.equal(expectedScale);
    });

    it("should emit a PoolAdded event on successful creation", async function () {
        const { riskManager, stEth } = await loadFixture(deployRiskManagerFixture);
        const rateModel = { base: 100, slope1: 200, slope2: 500, kink: 8000 };
        const protocolId = ProtocolRiskIdentifier.ROCKET_RETH;

        await expect(riskManager.addProtocolRiskPool(stEth.target, rateModel, protocolId))
            .to.emit(riskManager, "PoolAdded")
            .withArgs(0, stEth.target, protocolId);
    });

    describe("Scale Calculation", function () {
        it("should correctly calculate scale when protocol decimals > underlying decimals", async function () {
            const { riskManager, usdc, stEth } = await loadFixture(deployRiskManagerFixture);
            const rateModel = { base: 0, slope1: 0, slope2: 0, kink: 0 };
            const expectedScale = 10n ** (await stEth.decimals() - (await usdc.decimals()));

            await riskManager.addProtocolRiskPool(stEth.target, rateModel, ProtocolRiskIdentifier.LIDO_STETH);
            const pool = await riskManager.getPoolInfo(0);

            expect(pool.scaleToProtocolToken).to.equal(expectedScale);
        });

        it("should correctly calculate scale when protocol decimals < underlying decimals", async function () {
            const { owner, wbtc } = await loadFixture(deployRiskManagerFixture);

            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const dai = await MockERC20Factory.deploy("DAI", "DAI", 18);
            const MockCapitalPoolFactory = await ethers.getContractFactory("MockCapitalPool");
            const newCapitalPool = await MockCapitalPoolFactory.deploy(owner.address, dai.target);
            const MockPolicyNFTFactory = await ethers.getContractFactory("PolicyNFT");
            const mockPolicyNFT = await MockPolicyNFTFactory.deploy(owner.address);
            const MockCatPoolFactory = await ethers.getContractFactory("MockCatInsurancePool");
            const mockCatPool = await MockCatPoolFactory.deploy(owner.address);
            const RiskManagerFactory = await ethers.getContractFactory("RiskManager", owner);
            const newRiskManager = await RiskManagerFactory.deploy(
                newCapitalPool.target,
                mockPolicyNFT.target,
                mockCatPool.target
            );

            const rateModel = { base: 0, slope1: 0, slope2: 0, kink: 0 };
            const expectedScale = 1n; // 10^(8-18) becomes 10^0 = 1 in the contract

            await newRiskManager.addProtocolRiskPool(wbtc.target, rateModel, ProtocolRiskIdentifier.PROTOCOL_A);
            const pool = await newRiskManager.getPoolInfo(0);

            expect(pool.scaleToProtocolToken).to.equal(expectedScale);
        });

        it("should correctly calculate scale when protocol decimals are equal", async function () {
            const { riskManager } = await loadFixture(deployRiskManagerFixture);
            const MockERC20Factory = await ethers.getContractFactory("MockERC20");
            const customToken = await MockERC20Factory.deploy("Custom", "CSTM", 6);

            const rateModel = { base: 0, slope1: 0, slope2: 0, kink: 0 };
            const expectedScale = 1n; // 10^(6-6) = 1

            await riskManager.addProtocolRiskPool(customToken.target, rateModel, ProtocolRiskIdentifier.PROTOCOL_A);
            const pool = await riskManager.getPoolInfo(0);

            expect(pool.scaleToProtocolToken).to.equal(expectedScale);
        });
    });

    it("should allow adding multiple pools sequentially", async function () {
        const { riskManager, stEth, wbtc } = await loadFixture(deployRiskManagerFixture);

        await riskManager.addProtocolRiskPool(stEth.target, { base: 150, slope1: 300, slope2: 600, kink: 7500 }, ProtocolRiskIdentifier.LIDO_STETH);
        await riskManager.addProtocolRiskPool(wbtc.target, { base: 200, slope1: 400, slope2: 800, kink: 8000 }, ProtocolRiskIdentifier.PROTOCOL_A);

        const poolOne = await riskManager.getPoolInfo(0);
        expect(poolOne.protocolTokenToCover).to.equal(stEth.target);

        const poolTwo = await riskManager.getPoolInfo(1);
        expect(poolTwo.protocolTokenToCover).to.equal(wbtc.target);
    });
});

async function getRiskManagerFactory(signer) {
    return ethers.getContractFactory("RiskManager", signer);
}


describe("RiskManager - purchaseCover", function () {
    async function deployAndFundFixture() {
        const [owner, underwriter, policyHolder] = await ethers.getSigners();

        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const usdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);

        const MockCapitalPoolFactory = await ethers.getContractFactory("MockCapitalPool");
        const mockCapitalPool = await MockCapitalPoolFactory.deploy(owner.address, await usdc.getAddress());

        const MockPolicyNFTFactory = await ethers.getContractFactory("PolicyNFT");
        const mockPolicyNFT = await MockPolicyNFTFactory.deploy(owner.address);

        const MockCatPoolFactory = await ethers.getContractFactory("MockCatInsurancePool");
        const mockCatPool = await MockCatPoolFactory.deploy(owner.address);

        const RiskManagerFactory = await getRiskManagerFactory(owner);
        const riskManager = await RiskManagerFactory.deploy(
            await mockCapitalPool.getAddress(),
            await mockPolicyNFT.getAddress(),
            await mockCatPool.getAddress()
        );

        await mockPolicyNFT.setRiskManagerAddress(riskManager.target);

        const capitalAmount = ethers.parseUnits("100000", 6);
        const cpAddress = await mockCapitalPool.getAddress();
        await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [cpAddress] });
        await hre.network.provider.send("hardhat_setBalance", [cpAddress, "0x1000000000000000000"]);

        const cpSigner = await ethers.getSigner(cpAddress);
        await riskManager.connect(cpSigner).onCapitalDeposited(underwriter.address, capitalAmount);
        await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [cpAddress] });
        
        await riskManager.addProtocolRiskPool(usdc.target, { base: 1000, slope1: 0, slope2: 0, kink: 0 }, ProtocolRiskIdentifier.PROTOCOL_A);
        await riskManager.connect(underwriter).allocateCapital([0]);

        const policyHolderBalance = ethers.parseUnits("5000", 6);
        await usdc.mint(policyHolder.address, policyHolderBalance);
        await usdc.connect(policyHolder).approve(riskManager.target, ethers.MaxUint256);

        return { riskManager, owner, underwriter, policyHolder, usdc, mockPolicyNFT };
    }

    describe("Validation and Revert Scenarios", function () {
        it("should revert for an invalid pool ID", async function () {
            const { riskManager, policyHolder } = await loadFixture(deployAndFundFixture);
            const coverageAmount = ethers.parseUnits("1000", 6);
            const premiumDeposit = ethers.parseUnits("10", 6);

            await expect(riskManager.connect(policyHolder).purchaseCover(99, coverageAmount, premiumDeposit))
                .to.be.revertedWithCustomError(riskManager, "InvalidPoolId");
        });
        
        it("should revert for a zero coverage amount", async function () {
            const { riskManager, policyHolder } = await loadFixture(deployAndFundFixture);
            await expect(riskManager.connect(policyHolder).purchaseCover(0, 0, 0))
                .to.be.revertedWithCustomError(riskManager, "InvalidAmount");
        });

        // FIX: With the added check in the contract, this test now correctly expects the 'InsufficientCapacity' error.
        it("should revert if coverage exceeds pool capacity", async function () {
            const { riskManager, policyHolder } = await loadFixture(deployAndFundFixture);
            const capitalAmount = ethers.parseUnits("100000", 6);
            const excessiveCoverage = capitalAmount + 1n; 
            const premiumDeposit = ethers.parseUnits("100", 6); 

            await expect(riskManager.connect(policyHolder).purchaseCover(0, excessiveCoverage, premiumDeposit))
                .to.be.revertedWithCustomError(riskManager, "InsufficientCapacity");
        });

        it("should revert if the initial premium deposit is too low", async function () {
            const { riskManager, policyHolder } = await loadFixture(deployAndFundFixture);
            const coverageAmount = ethers.parseUnits("1000", 6);
            const premiumDeposit = 1;

            await expect(riskManager.connect(policyHolder).purchaseCover(0, coverageAmount, premiumDeposit))
                .to.be.revertedWith("RM: Deposit is less than the required minimum for 1 week");
        });
    });

    describe("Successful Purchase (Happy Path)", function () {
        it("should correctly process a valid cover purchase", async function () {
            const { riskManager, policyHolder, usdc, mockPolicyNFT } = await loadFixture(deployAndFundFixture);

            const poolId = 0;
            const coverageAmount = ethers.parseUnits("50000", 6);

            const BPS = 10000n;
            const SECS_YEAR = 365n * 24n * 60n * 60n;
            const annualRateBps = 1000n;
            const weeklyPremium = (coverageAmount * annualRateBps * (7n * 24n * 60n * 60n)) / (SECS_YEAR * BPS);

            // FIX: The transaction itself is the primary check. It should no longer revert.
            const tx = await riskManager.connect(policyHolder).purchaseCover(poolId, coverageAmount, weeklyPremium);
            await tx.wait(); // Ensure transaction is mined

            const pool = await riskManager.protocolRiskPools(poolId);
            expect(pool.totalCoverageSold).to.equal(coverageAmount);
            
            // We can check for event emission as a secondary confirmation.
            await expect(tx).to.emit(riskManager, "PolicyCreated");
            await expect(tx).to.emit(mockPolicyNFT, "PolicyMinted");
        });
        
        it("should handle premium accrual correctly when a pool has zero capital", async function () {
            const { riskManager, policyHolder, usdc } = await loadFixture(deployAndFundFixture);

            await riskManager.addProtocolRiskPool(usdc.target, { base: 1000, slope1: 0, slope2: 0, kink: 0 }, ProtocolRiskIdentifier.PROTOCOL_B);

            const coverageAmount = ethers.parseUnits("1000", 6);
            const premiumDeposit = ethers.parseUnits("10", 6);

            // FIX: With the added check in the contract, this test now correctly expects the 'InsufficientCapacity' error.
            await expect(riskManager.connect(policyHolder).purchaseCover(1, coverageAmount, premiumDeposit))
                .to.be.revertedWithCustomError(riskManager, "InsufficientCapacity");
        });
    });
});


describe("RiskManager - allocateCapital", function () {
    // A fixture to set up a state where an underwriter has deposited capital
    // but has not yet allocated it.
    async function deployAndDepositFixture() {
        const [owner, underwriter1, underwriter2, nonDepositor] = await ethers.getSigners();

        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const usdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);

        const MockCapitalPoolFactory = await ethers.getContractFactory("MockCapitalPool");
        const mockCapitalPool = await MockCapitalPoolFactory.deploy(owner.address, usdc.target);

        const MockPolicyNFTFactory = await ethers.getContractFactory("PolicyNFT");
        const mockPolicyNFT = await MockPolicyNFTFactory.deploy(owner.address);

        const MockCatPoolFactory = await ethers.getContractFactory("MockCatInsurancePool");
        const mockCatPool = await MockCatPoolFactory.deploy(owner.address);

        const RiskManagerFactory = await getRiskManagerFactory(owner);
        const riskManager = await RiskManagerFactory.deploy(
            mockCapitalPool.target,
            mockPolicyNFT.target,
            mockCatPool.target
        );

        // Add several pools to test allocation limits and choices
        const MAX_ALLOCATIONS = await riskManager.MAX_ALLOCATIONS_PER_UNDERWRITER();
        for (let i = 0; i < Number(MAX_ALLOCATIONS) + 1; i++) { // Create 6 pools
            await riskManager.addProtocolRiskPool(
                usdc.target, // Mock token
                { base: 0, slope1: 0, slope2: 0, kink: 0 },
                0 // NONE
            );
        }

        const depositAmount = ethers.parseUnits("50000", 6); // 50,000 USDC
        // Simulate the onCapitalDeposited hook call from the CapitalPool
        await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [mockCapitalPool.target] });
        await hre.network.provider.send("hardhat_setBalance", [mockCapitalPool.target, "0x1000000000000000000"]);
        const cpSigner = await ethers.getSigner(mockCapitalPool.target);
        await riskManager.connect(cpSigner).onCapitalDeposited(underwriter1.address, depositAmount);
        await riskManager.connect(cpSigner).onCapitalDeposited(underwriter2.address, depositAmount);
        await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [mockCapitalPool.target] });

        return { riskManager, owner, underwriter1, underwriter2, nonDepositor, depositAmount, MAX_ALLOCATIONS };
    }

    describe("Validation and Revert Scenarios", function () {
        it("should revert if the underwriter has no capital deposited", async function () {
            const { riskManager, nonDepositor } = await loadFixture(deployAndDepositFixture);
            await expect(riskManager.connect(nonDepositor).allocateCapital([0]))
                .to.be.revertedWithCustomError(riskManager, "NoCapitalToAllocate");
        });

        it("should revert if the poolIds array is empty", async function () {
            const { riskManager, underwriter1 } = await loadFixture(deployAndDepositFixture);
            await expect(riskManager.connect(underwriter1).allocateCapital([]))
                .to.be.revertedWithCustomError(riskManager, "ExceedsMaxAllocations");
        });

        it("should revert if the poolIds array exceeds MAX_ALLOCATIONS_PER_UNDERWRITER", async function () {
            const { riskManager, underwriter1, MAX_ALLOCATIONS } = await loadFixture(deployAndDepositFixture);
            const tooManyPools = Array.from(Array(Number(MAX_ALLOCATIONS) + 1).keys()); // [0, 1, 2, 3, 4, 5]

            await expect(riskManager.connect(underwriter1).allocateCapital(tooManyPools))
                .to.be.revertedWithCustomError(riskManager, "ExceedsMaxAllocations");
        });

        it("should revert if attempting to allocate to a non-existent pool", async function () {
            const { riskManager, underwriter1 } = await loadFixture(deployAndDepositFixture);
            await expect(riskManager.connect(underwriter1).allocateCapital([99]))
                .to.be.revertedWithCustomError(riskManager, "InvalidPoolId");
        });

        it("should revert if attempting to allocate to the same pool twice in separate transactions", async function () {
            const { riskManager, underwriter1 } = await loadFixture(deployAndDepositFixture);
            await riskManager.connect(underwriter1).allocateCapital([0]); // First allocation is fine
            await expect(riskManager.connect(underwriter1).allocateCapital([0]))
                .to.be.revertedWithCustomError(riskManager, "AlreadyAllocated");
        });

        it("should revert if a duplicate poolId is provided in the same transaction", async function () {
            const { riskManager, underwriter1 } = await loadFixture(deployAndDepositFixture);
            await expect(riskManager.connect(underwriter1).allocateCapital([1, 2, 1]))
                .to.be.revertedWithCustomError(riskManager, "AlreadyAllocated");
        });
    });

    describe("Successful Allocation", function () {
        it("should correctly update totalCapitalPledgedToPool for multiple pools", async function () {
            const { riskManager, underwriter1, depositAmount } = await loadFixture(deployAndDepositFixture);
            const poolsToAllocate = [0, 2, 4];
            
            const pool0_before = await riskManager.protocolRiskPools(0);
            const pool1_before = await riskManager.protocolRiskPools(1);

            await riskManager.connect(underwriter1).allocateCapital(poolsToAllocate);
            
            const pool0_after = await riskManager.protocolRiskPools(0);
            const pool1_after = await riskManager.protocolRiskPools(1); // Unaffected pool
            const pool2_after = await riskManager.protocolRiskPools(2);
            
            // Check that each allocated pool's capital increased by the full deposit amount
            expect(pool0_after.totalCapitalPledgedToPool).to.equal(pool0_before.totalCapitalPledgedToPool + depositAmount);
            expect(pool2_after.totalCapitalPledgedToPool).to.equal(depositAmount);
            
            // Check that an unallocated pool remains unchanged
            expect(pool1_after.totalCapitalPledgedToPool).to.equal(pool1_before.totalCapitalPledgedToPool);
        });

        it("should update all underwriter and pool tracking data structures correctly", async function() {
            const { riskManager, underwriter1, underwriter2, depositAmount } = await loadFixture(deployAndDepositFixture);
            
            // U1 allocates to pool 1
            await riskManager.connect(underwriter1).allocateCapital([1]);
            
            // Check U1 state
            expect(await riskManager.isAllocatedToPool(underwriter1.address, 1)).to.be.true;
            expect(await riskManager.underwriterIndexInPoolArray(1, underwriter1.address)).to.equal(0);
            // NOTE: Testing arrays requires a getter in the contract. Assuming one exists for this test.
            // expect(await riskManager.getUnderwriterAllocations(underwriter1.address)).to.deep.equal([1]);
            // expect(await riskManager.getPoolSpecificUnderwriters(1)).to.deep.equal([underwriter1.address]);

            // U2 allocates to the same pool 1
            await riskManager.connect(underwriter2).allocateCapital([1]);

            // Check U2 state
            expect(await riskManager.isAllocatedToPool(underwriter2.address, 1)).to.be.true;
            expect(await riskManager.underwriterIndexInPoolArray(1, underwriter2.address)).to.equal(1); // Second in array
            
            // Check final pool state
            const pool1_final = await riskManager.protocolRiskPools(1);
            expect(pool1_final.totalCapitalPledgedToPool).to.equal(depositAmount * 2n);
            // expect(await riskManager.getPoolSpecificUnderwriters(1)).to.deep.equal([underwriter1.address, underwriter2.address]);
        });

        it("should emit a CapitalAllocated event for each pool", async function () {
            const { riskManager, underwriter1, depositAmount } = await loadFixture(deployAndDepositFixture);
            const poolsToAllocate = [0, 1];
            const tx = await riskManager.connect(underwriter1).allocateCapital(poolsToAllocate);
            
            // Check for each event individually
            await expect(tx).to.emit(riskManager, "CapitalAllocated").withArgs(underwriter1.address, poolsToAllocate[0], depositAmount);
            await expect(tx).to.emit(riskManager, "CapitalAllocated").withArgs(underwriter1.address, poolsToAllocate[1], depositAmount);
        });
    });

    describe("Security", function() {
        it("should prevent reentrancy attacks", async function() {
            const { riskManager, owner } = await loadFixture(deployAndDepositFixture);
            const ReentrancyAttackerFactory = await ethers.getContractFactory("ReentrancyAttacker");
            const attacker = await ReentrancyAttackerFactory.deploy(riskManager.target);

            // Attacker needs capital to allocate
            const depositAmount = ethers.parseUnits("1000", 6);
            const cpAddress = await riskManager.capitalPool();
            await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [cpAddress] });
            await hre.network.provider.send("hardhat_setBalance", [cpAddress, "0x1000000000000000000"]);
            const cpSigner = await ethers.getSigner(cpAddress);
            await riskManager.connect(cpSigner).onCapitalDeposited(attacker.target, depositAmount);
            await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [cpAddress] });

            // The second allocation attempt should revert since the attacker is already allocated
            await expect(attacker["beginAttack(uint256[])"]([0, 1]))
                .to.be.revertedWithCustomError(riskManager, "AlreadyAllocated");
        });
    });
});



describe("RiskManager - processClaim", function () {
    // A comprehensive fixture to set up a valid, active, and fully paid policy ready for a claim.
    async function deployAndClaimFixture() {
        const [owner, underwriter1, underwriter2, policyHolder, otherPerson] = await ethers.getSigners();
        const policyId = 1;

        // --- Deploy all contracts and mocks ---
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const usdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
        const protocolToken = await MockERC20Factory.deploy("Protocol Token", "pTKN", 18);

        // const MockCapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
        const MockCapitalPoolFactory = await ethers.getContractFactory("MockCapitalPool");
        const mockCapitalPool = await MockCapitalPoolFactory.deploy(owner.address, await usdc.getAddress());

        const MockPolicyNFTFactory = await ethers.getContractFactory("MockPolicyNFT");
        const mockPolicyNFT = await MockPolicyNFTFactory.deploy(owner.address);

        const MockCatPoolFactory = await ethers.getContractFactory("MockCatInsurancePool");
        const mockCatPool = await MockCatPoolFactory.deploy(owner.address);
        
        const RiskManagerFactory = await getRiskManagerFactory(owner);
        const riskManager = await RiskManagerFactory.deploy(
            await mockCapitalPool.getAddress(),
            await mockPolicyNFT.getAddress(),
            await mockCatPool.getAddress()
        );

        // --- Setup Pool with Protocol Token ---
        const rateModel = { base: 1000, slope1: 0, slope2: 0, kink: 0 };
        await riskManager.addProtocolRiskPool(protocolToken.target, rateModel, 1 /* PROTOCOL_A */); // Pool ID 0

        // --- Setup Underwriters: U1 deposits 10k, U2 deposits 30k (1:3 ratio) ---
        const u1Deposit = ethers.parseUnits("10000", 6);
        const u2Deposit = ethers.parseUnits("30000", 6);
        await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [mockCapitalPool.target] });
        await hre.network.provider.send("hardhat_setBalance", [mockCapitalPool.target, "0x1000000000000000000"]);
        const cpSigner = await ethers.getSigner(mockCapitalPool.target);
        await riskManager.connect(cpSigner).onCapitalDeposited(underwriter1.address, u1Deposit);
        await riskManager.connect(cpSigner).onCapitalDeposited(underwriter2.address, u2Deposit);
        await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [mockCapitalPool.target] });
        await riskManager.connect(underwriter1).allocateCapital([0]);
        await riskManager.connect(underwriter2).allocateCapital([0]);

        // --- Setup Policy in MockNFT ---
        const coverageAmount = ethers.parseUnits("20000", 6); // 20k coverage
        const now = await time.latest();
        await mockPolicyNFT.mock_setPolicy(
            policyId,
            policyHolder.address,
            0, // poolId
            coverageAmount,
            now - 86400, // Activated yesterday
            now + 864000, // Paid up for a while
            0,
            0
        );

        // --- Fund PolicyHolder with underlying (for payout) and protocol token (for distressed asset transfer) ---
        await usdc.mint(riskManager.target, ethers.parseUnits("100000", 6)); // Pre-fund RM for payouts
        await protocolToken.mint(policyHolder.address, ethers.parseUnits("20000", 18));
        await protocolToken.connect(policyHolder).approve(riskManager.target, ethers.MaxUint256);
        
        return {
            riskManager, owner, underwriter1, underwriter2, policyHolder, otherPerson,
            mockCapitalPool, mockPolicyNFT, mockCatPool, usdc, protocolToken,
            policyId, coverageAmount, u1Deposit, u2Deposit
        };
    }

    describe("Validation and Rejection Scenarios", function() {
        it("should revert if the caller is not the policy owner", async function() {
            const { riskManager, otherPerson, policyId } = await loadFixture(deployAndClaimFixture);
            await expect(riskManager.connect(otherPerson).processClaim(policyId, "0x"))
                .to.be.revertedWith("RM: Not policy owner");
        });

        it("should revert if premiums are outstanding", async function() {
            const { riskManager, policyHolder, mockPolicyNFT, policyId } = await loadFixture(deployAndClaimFixture);
            // Set lastPaidUntil to the past to make premium owed > 0
            await mockPolicyNFT.mock_setLastPaid(policyId, (await time.latest()) - 86400 * 10);
            
            await expect(riskManager.connect(policyHolder).processClaim(policyId, "0x"))
                .to.be.revertedWith("RM: Premiums outstanding");
        });

        // Add other validation tests for paused pool, inactive policy, etc.
    });

    describe("Successful Claim - Full Coverage by LPs", function() {
        it("should calculate correct net payout and apply losses proportionally to underwriters", async function() {
            const { riskManager, policyHolder, mockCapitalPool, coverageAmount, u1Deposit, u2Deposit, policyId } = await loadFixture(deployAndClaimFixture);
            
            const totalCapital = u1Deposit + u2Deposit;
            const claimFeeBps = await riskManager.CLAIM_FEE_BPS();
            const netPayout = coverageAmount - (coverageAmount * claimFeeBps) / 10000n;

            const expectedU1Loss = (netPayout * u1Deposit) / totalCapital;
            const expectedU2Loss = (netPayout * u2Deposit) / totalCapital;

            const tx = await riskManager.connect(policyHolder).processClaim(policyId, "0x");

            // Check for precise loss application events from our mock
            await expect(tx).to.emit(mockCapitalPool, "LossesAppliedCalled").withArgs(ethers.ZeroAddress, expectedU1Loss); // Underwriter 1
            await expect(tx).to.emit(mockCapitalPool, "LossesAppliedCalled").withArgs(ethers.ZeroAddress, expectedU2Loss); // Underwriter 2
        });

        it("should transfer assets, burn the NFT, update pool state, and emit event", async function() {
            const { riskManager, policyHolder, usdc, protocolToken, mockPolicyNFT, coverageAmount, policyId } = await loadFixture(deployAndClaimFixture);

            const initialPoolState = await riskManager.protocolRiskPools(0);
            const netPayout = (coverageAmount * 9500n) / 10000n; // 95% payout
            
            // Check asset transfers, state changes, and events
            await expect(() => riskManager.connect(policyHolder).processClaim(policyId, "0x"))
                .to.changeTokenBalance(usdc, policyHolder, netPayout); // Claimant gets paid

            const tx = await riskManager.connect(policyHolder).processClaim(policyId, "0x");
            
            await expect(tx).to.emit(protocolToken, "Transfer"); // Distressed asset transfer
            await expect(tx).to.emit(mockPolicyNFT, "PolicyBurned").withArgs(policyId);
            await expect(tx).to.emit(riskManager, "ClaimProcessed").withArgs(policyId, 0, policyHolder.address, netPayout);

            const finalPoolState = await riskManager.protocolRiskPools(0);
            expect(finalPoolState.totalCoverageSold).to.equal(initialPoolState.totalCoverageSold - coverageAmount);
            expect(finalPoolState.totalCapitalPledgedToPool).to.equal(initialPoolState.totalCapitalPledgedToPool - netPayout);
        });
    });

    describe("Successful Claim - With CAT Pool Shortfall", function() {
        it("should draw the exact shortfall from the CAT pool if LPs cannot cover the full claim", async function() {
            const { riskManager, policyHolder, mockCatPool, coverageAmount, u1Deposit, u2Deposit, policyId, mockPolicyNFT, protocolToken } = await loadFixture(deployAndClaimFixture);

            // Create a new policy with coverage greater than the total pool capital
            const largeCoverage = u1Deposit + u2Deposit + ethers.parseUnits("10000", 6);
            await mockPolicyNFT.mock_setCoverage(policyId, largeCoverage);
            await protocolToken.mint(policyHolder.address, ethers.parseUnits("30000", 18)); // Mint extra for transfer
            
            const netPayout = (largeCoverage * 9500n) / 10000n;
            const totalCapital = u1Deposit + u2Deposit;
            const expectedShortfall = netPayout - totalCapital;
            
            const tx = await riskManager.connect(policyHolder).processClaim(policyId, "0x");

            // The key check: was the CAT pool draw function called with the correct shortfall?
            await expect(tx).to.emit(mockCatPool, "FundDrawn").withArgs(expectedShortfall);

            // The pool's capital should be completely wiped out
            const finalPoolState = await riskManager.protocolRiskPools(0);
            expect(finalPoolState.totalCapitalPledgedToPool).to.equal(0);
        });
    });
});


describe("RiskManager - Admin Functions", function () {
    // A basic fixture is sufficient for admin functions.
    async function deployFixture() {
        const [owner, nonOwner, newCommittee] = await ethers.getSigners();
        const RiskManagerFactory = await getRiskManagerFactory(owner);
        const riskManager = await RiskManagerFactory.deploy(
            owner.address,
            owner.address,
            owner.address
        );
        return { riskManager, owner, nonOwner, newCommittee };
    }

    describe("setCommittee", function () {
        it("should allow the owner to set a new committee", async function () {
            const { riskManager, owner, newCommittee } = await loadFixture(deployFixture);
            await riskManager.connect(owner).setCommittee(newCommittee.address);
            expect(await riskManager.committee()).to.equal(newCommittee.address);
        });

        it("should revert if a non-owner tries to set the committee", async function () {
            const { riskManager, nonOwner, newCommittee } = await loadFixture(deployFixture);
            await expect(riskManager.connect(nonOwner).setCommittee(newCommittee.address))
                .to.be.revertedWithCustomError(riskManager, "OwnableUnauthorizedAccount").withArgs(nonOwner.address);
        });

        it("should revert if setting the committee to the zero address", async function () {
            const { riskManager, owner } = await loadFixture(deployFixture);
            await expect(riskManager.connect(owner).setCommittee(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(riskManager, "ZeroAddress");
        });
    });

    describe("setCatPremiumShareBps", function () {
        it("should allow the owner to set a valid new CAT premium share", async function () {
            const { riskManager, owner } = await loadFixture(deployFixture);
            const newBps = 3000; // 30%
            await riskManager.connect(owner).setCatPremiumShareBps(newBps);
            expect(await riskManager.catPremiumBps()).to.equal(newBps);
        });

        it("should revert if a non-owner tries to set the CAT premium share", async function () {
            const { riskManager, nonOwner } = await loadFixture(deployFixture);
            await expect(riskManager.connect(nonOwner).setCatPremiumShareBps(3000))
                .to.be.revertedWithCustomError(riskManager, "OwnableUnauthorizedAccount").withArgs(nonOwner.address);
        });

        it("should revert if the new share exceeds the maximum (5000 BPS)", async function () {
            const { riskManager, owner } = await loadFixture(deployFixture);
            await expect(riskManager.connect(owner).setCatPremiumShareBps(5001))
                .to.be.revertedWith("RM: Max share is 50%");
        });
    });
});


describe("RiskManager - Capital Hooks", function () {
    // A fixture to set up pools and underwriters is needed here.
    async function deployAndAllocateFixture() {
        const [owner, underwriter1, underwriter2, nonCapitalPool] = await ethers.getSigners();
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const usdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
        const MockCapitalPoolFactory = await ethers.getContractFactory("MockCapitalPool");
        const mockCapitalPool = await MockCapitalPoolFactory.deploy(owner.address, usdc.target);
        
        const RiskManagerFactory = await getRiskManagerFactory(owner);
        const riskManager = await RiskManagerFactory.deploy(
            await mockCapitalPool.getAddress(),
            owner.address,
            owner.address
        );
        
        await riskManager.addProtocolRiskPool(usdc.target, { base:0, slope1:0, slope2:0, kink:0 }, 1);
        await riskManager.addProtocolRiskPool(usdc.target, { base:0, slope1:0, slope2:0, kink:0 }, 2);

        // Helper for impersonating the CapitalPool
        async function asCapitalPool(fn) {
            await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [mockCapitalPool.target] });
            await hre.network.provider.send("hardhat_setBalance", [mockCapitalPool.target, "0x1000000000000000000"]);
            const signer = await ethers.getSigner(mockCapitalPool.target);
            const result = await fn(signer);
            await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [mockCapitalPool.target] });
            return result;
        }
        
        return { riskManager, owner, underwriter1, underwriter2, nonCapitalPool, asCapitalPool };
    }

    describe("onCapitalDeposited", function() {
        it("should correctly increase an underwriter's total pledge", async function () {
            const { riskManager, underwriter1, asCapitalPool } = await loadFixture(deployAndAllocateFixture);
            const depositAmount = ethers.parseEther("100");
            
            await asCapitalPool(signer => riskManager.connect(signer).onCapitalDeposited(underwriter1.address, depositAmount));

            expect(await riskManager.underwriterTotalPledge(underwriter1.address)).to.equal(depositAmount);
        });

        it("should revert if called by any address other than the CapitalPool", async function () {
            const { riskManager, underwriter1, nonCapitalPool } = await loadFixture(deployAndAllocateFixture);
            await expect(riskManager.connect(nonCapitalPool).onCapitalDeposited(underwriter1.address, 100))
                .to.be.revertedWith("RM: Not CapitalPool");
        });
    });

    describe("onCapitalWithdrawn", function() {
        it("should handle a partial withdrawal correctly", async function() {
            const { riskManager, underwriter1, asCapitalPool } = await loadFixture(deployAndAllocateFixture);
            const initialDeposit = ethers.parseEther("1000");
            const withdrawalAmount = ethers.parseEther("400");
            
            await asCapitalPool(signer => riskManager.connect(signer).onCapitalDeposited(underwriter1.address, initialDeposit));
            await riskManager.connect(underwriter1).allocateCapital([0, 1]); // Allocate to two pools

            const pool0_before = await riskManager.protocolRiskPools(0);
            const pool1_before = await riskManager.protocolRiskPools(1);

            await asCapitalPool(signer => riskManager.connect(signer).onCapitalWithdrawn(underwriter1.address, withdrawalAmount, false));

            // Check total pledge is reduced
            expect(await riskManager.underwriterTotalPledge(underwriter1.address)).to.equal(initialDeposit - withdrawalAmount);
            
            // Check capital in each allocated pool is reduced
            const pool0_after = await riskManager.protocolRiskPools(0);
            const pool1_after = await riskManager.protocolRiskPools(1);
            expect(pool0_after.totalCapitalPledgedToPool).to.equal(pool0_before.totalCapitalPledgedToPool - withdrawalAmount);
            expect(pool1_after.totalCapitalPledgedToPool).to.equal(pool1_before.totalCapitalPledgedToPool - withdrawalAmount);
        });

        it("should handle a full withdrawal using 'swap and pop'", async function() {
            const { riskManager, underwriter1, underwriter2, asCapitalPool } = await loadFixture(deployAndAllocateFixture);
            const u1Deposit = ethers.parseEther("100");
            const u2Deposit = ethers.parseEther("500");

            // U1 and U2 deposit and both allocate to pool 0
            await asCapitalPool(signer => riskManager.connect(signer).onCapitalDeposited(underwriter1.address, u1Deposit));
            await asCapitalPool(signer => riskManager.connect(signer).onCapitalDeposited(underwriter2.address, u2Deposit));
            await riskManager.connect(underwriter1).allocateCapital([0]);
            await riskManager.connect(underwriter2).allocateCapital([0]);

            // Before withdrawal: U1 is at index 0, U2 is at index 1
            expect(await riskManager.underwriterIndexInPoolArray(0, underwriter1.address)).to.equal(0);
            expect(await riskManager.underwriterIndexInPoolArray(0, underwriter2.address)).to.equal(1);
            
            // U1 performs a full withdrawal
            await asCapitalPool(signer => riskManager.connect(signer).onCapitalWithdrawn(underwriter1.address, u1Deposit, true));

            // After withdrawal: U2 (last element) should be moved to index 0
            expect(await riskManager.underwriterIndexInPoolArray(0, underwriter2.address)).to.equal(0);
            // U1's index should be cleared
            expect(await riskManager.underwriterIndexInPoolArray(0, underwriter1.address)).to.equal(0); // cleared to default value
            
            // Check array state (requires getter on contract for direct test)
            // const underwriters = await riskManager.getPoolSpecificUnderwriters(0);
            // expect(underwriters.length).to.equal(1);
            // expect(underwriters[0]).to.equal(underwriter2.address);
        });

        it("should revert if called by any address other than the CapitalPool", async function () {
            const { riskManager, underwriter1, nonCapitalPool } = await loadFixture(deployAndAllocateFixture);
            await expect(riskManager.connect(nonCapitalPool).onCapitalWithdrawn(underwriter1.address, 100, false))
                .to.be.revertedWith("RM: Not CapitalPool");
        });
    });
});


describe("RiskManager - claimPremiumRewards", function () {
    // Fixture to set up a state where premiums have been paid and accrued to an underwriter.
    async function deployAndAccruePremiumsFixture() {
        const [owner, underwriter, policyHolder, otherUnderwriter] = await ethers.getSigners();
        const poolId = 0;

        // Deploy mocks and core contracts
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const usdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
        const MockCapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
        const mockCapitalPool = await MockCapitalPoolFactory.deploy(owner.address, await usdc.getAddress());
        const MockPolicyNFTFactory = await ethers.getContractFactory("MockPolicyNFT");
        const mockPolicyNFT = await MockPolicyNFTFactory.deploy(owner.address);
        const MockCatPoolFactory = await ethers.getContractFactory("MockCatInsurancePool");
        const mockCatPool = await MockCatPoolFactory.deploy(owner.address);
        const RiskManagerFactory = await getRiskManagerFactory(owner);
        const riskManager = await RiskManagerFactory.deploy(
            await mockCapitalPool.getAddress(),
            await mockPolicyNFT.getAddress(),
            await mockCatPool.getAddress()
        );

        await mockPolicyNFT.setRiskManagerAddress(riskManager.target);

        // Setup Pool and Underwriter
        const capitalAmount = ethers.parseUnits("100000", 6);
        const cpAddress3 = await mockCapitalPool.getAddress();
        await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [cpAddress3] });
        await hre.network.provider.send("hardhat_setBalance", [cpAddress3, "0x1000000000000000000"]);
        const cpSigner = await ethers.getSigner(cpAddress3);
        await riskManager.connect(cpSigner).onCapitalDeposited(underwriter.address, capitalAmount);
        await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [cpAddress3] });
        await riskManager.addProtocolRiskPool(usdc.target, { base: 1000, slope1: 0, slope2: 0, kink: 0 }, 1);
        await riskManager.connect(underwriter).allocateCapital([poolId]);

        // Purchase cover to generate premium income
        const coverageAmount = ethers.parseUnits("50000", 6);
        const SECS_YEAR = 365 * 24 * 60 * 60;
        const BPS = 10000;
        const annualRateBps = 1000;
        const weeklyPremium = (BigInt(coverageAmount) * BigInt(annualRateBps) * BigInt(7 * 24 * 60 * 60)) / (BigInt(SECS_YEAR) * BigInt(BPS));
        await usdc.mint(policyHolder.address, weeklyPremium);
        await usdc.connect(policyHolder).approve(riskManager.target, weeklyPremium);
        await riskManager.connect(policyHolder).purchaseCover(poolId, coverageAmount);

        // Calculate the accrued rewards
        const catBps = await riskManager.catPremiumBps();
        const accruedAmount = weeklyPremium - (weeklyPremium * BigInt(catBps)) / 10000n;

        return { riskManager, underwriter, otherUnderwriter, usdc, poolId, accruedAmount };
    }

    describe("Validation", function () {
        it("should revert if the underwriter has no rewards to claim", async function () {
            const { riskManager, otherUnderwriter, poolId } = await loadFixture(deployAndAccruePremiumsFixture);
            // 'otherUnderwriter' has no rewards
            await expect(riskManager.connect(otherUnderwriter).claimPremiumRewards(poolId))
                .to.be.revertedWithCustomError(riskManager, "NoRewardsToClaim");
        });

        it("should revert if an underwriter tries to claim from a pool they have no rewards in", async function () {
            const { riskManager, underwriter, usdc } = await loadFixture(deployAndAccruePremiumsFixture);
            // Rewards were accrued in pool 0, so claiming from pool 1 should fail
            const nonExistentPoolId = 1;
            await riskManager.addProtocolRiskPool(usdc.target, { base:0, slope1:0, slope2:0, kink:0 }, 1);
            
            await expect(riskManager.connect(underwriter).claimPremiumRewards(nonExistentPoolId))
                .to.be.revertedWithCustomError(riskManager, "NoRewardsToClaim");
        });
    });

    describe("Successful Claim", function () {
        it("should transfer the correct amount of underlying tokens to the underwriter", async function () {
            const { riskManager, underwriter, usdc, poolId, accruedAmount } = await loadFixture(deployAndAccruePremiumsFixture);

            await expect(async () => 
                riskManager.connect(underwriter).claimPremiumRewards(poolId)
            ).to.changeTokenBalance(usdc, underwriter, accruedAmount);
        });

        it("should reset the pending premiums for the underwriter in that pool to zero", async function () {
            const { riskManager, underwriter, poolId } = await loadFixture(deployAndAccruePremiumsFixture);
            
            await riskManager.connect(underwriter).claimPremiumRewards(poolId);
            
            const rewards = await riskManager.underwriterPoolRewards(poolId, underwriter.address);
            expect(rewards.pendingPremiums).to.equal(0);
        });

        it("should emit a PremiumRewardsClaimed event with correct arguments", async function () {
            const { riskManager, underwriter, poolId, accruedAmount } = await loadFixture(deployAndAccruePremiumsFixture);

            await expect(riskManager.connect(underwriter).claimPremiumRewards(poolId))
                .to.emit(riskManager, "PremiumRewardsClaimed")
                .withArgs(underwriter.address, poolId, accruedAmount);
        });

        it("should not affect rewards in other pools or for other underwriters", async function() {
            const { riskManager, underwriter, otherUnderwriter, poolId, accruedAmount } = await loadFixture(deployAndAccruePremiumsFixture);
            
            // Accrue some rewards for another underwriter in the same pool
            const cpAddr = await riskManager.capitalPool();
            await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [cpAddr] });
            await hre.network.provider.send("hardhat_setBalance", [cpAddr, "0x1000000000000000000"]);
            const cpSig = await ethers.getSigner(cpAddr);
            await riskManager.connect(cpSig).onCapitalDeposited(otherUnderwriter.address, ethers.parseUnits("100000", 6));
            await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [cpAddr] });
            await riskManager.connect(otherUnderwriter).allocateCapital([poolId]);
            // For simplicity, we manually credit rewards
            await riskManager.mock_setPendingPremiums(poolId, otherUnderwriter.address, 500);

            // U1 claims their rewards from pool 0
            await riskManager.connect(underwriter).claimPremiumRewards(poolId);

            // Check that U2's rewards are untouched
            const otherUnderwriterRewards = await riskManager.underwriterPoolRewards(poolId, otherUnderwriter.address);
            expect(otherUnderwriterRewards.pendingPremiums).to.equal(500);
        });
    });

    describe("Security", function () {
        it("should prevent reentrancy attacks", async function () {
            const { riskManager, usdc, poolId } = await loadFixture(deployAndAccruePremiumsFixture);
            
            const AttackerFactory = await ethers.getContractFactory("ReentrancyAttacker");
            const attacker = await AttackerFactory.deploy(riskManager.target);

            // Setup attacker to be an underwriter with rewards
            const capitalAmount = ethers.parseUnits("100000", 6);
            const cpA = await riskManager.capitalPool();
            await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [cpA] });
            await hre.network.provider.send("hardhat_setBalance", [cpA, "0x1000000000000000000"]);
            const cpS = await ethers.getSigner(cpA);
            await riskManager.connect(cpS).onCapitalDeposited(attacker.target, capitalAmount);
            await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [cpA] });
            await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [attacker.target] });
            const attackerSigner = await ethers.getSigner(attacker.target);
            await hre.network.provider.send("hardhat_setBalance", [attacker.target, "0x1000000000000000000"]);
            await riskManager.connect(attackerSigner).allocateCapital([poolId]);
            await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [attacker.target] });
            await usdc.mint(riskManager.target, ethers.parseUnits("100", 6)); // Ensure contract has funds
            await riskManager.mock_setPendingPremiums(poolId, attacker.target, ethers.parseUnits("10", 6));
            
            // After the first call the attacker has no rewards left so the second call reverts
            await expect(attacker["beginAttack(uint256)"](poolId))
                .to.be.revertedWithCustomError(riskManager, "NoRewardsToClaim");
        });
    });
});




describe("RiskManager - claimDistressedAssets", function () {
    // A comprehensive fixture that simulates a full claim, resulting in distressed assets
    // being accrued to underwriters.
    async function deployAndAccrueDistressedAssetsFixture() {
        const [owner, underwriter, policyHolder] = await ethers.getSigners();
        const poolId = 0;
        const policyId = 1;

        // --- Deploy all necessary contracts and mocks ---
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const usdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
        const distressedToken = await MockERC20Factory.deploy("Distressed Token", "d_TKN", 18);

        const MockCapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
        const mockCapitalPool = await MockCapitalPoolFactory.deploy(owner.address, await usdc.getAddress());
        const MockPolicyNFTFactory = await ethers.getContractFactory("MockPolicyNFT");
        const mockPolicyNFT = await MockPolicyNFTFactory.deploy(owner.address);
        const MockCatPoolFactory = await ethers.getContractFactory("MockCatInsurancePool");
        const mockCatPool = await MockCatPoolFactory.deploy(owner.address);
        const RiskManagerFactory = await getRiskManagerFactory(owner);
        const riskManager = await RiskManagerFactory.deploy(
            await mockCapitalPool.getAddress(),
            await mockPolicyNFT.getAddress(),
            await mockCatPool.getAddress()
        );
        // Configure the CapitalPool so that the RiskManager is authorized to
        // apply losses. Without this setup, any claim processing in the fixture
        // would revert when `applyLosses` is called.
        await mockCapitalPool.connect(owner).setRiskManager(riskManager.target);
        await mockPolicyNFT.setRiskManagerAddress(riskManager.target);

        // --- Setup Pool, Underwriter, and Policy ---
        await riskManager.addProtocolRiskPool(distressedToken.target, { base:0, slope1:0, slope2:0, kink:0 }, 1); // Pool 0
        const capitalAmount = ethers.parseUnits("100000", 6);
        const cpAddr2 = await riskManager.capitalPool();
        await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [cpAddr2] });
        await hre.network.provider.send("hardhat_setBalance", [cpAddr2, "0x1000000000000000000"]);
        const cpSigner2 = await ethers.getSigner(cpAddr2);
        await riskManager.connect(cpSigner2).onCapitalDeposited(underwriter.address, capitalAmount);
        await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [cpAddr2] });
        await riskManager.connect(underwriter).allocateCapital([poolId]);

        const coverageAmount = ethers.parseUnits("50000", 6);
        await mockPolicyNFT.mock_setPolicy(policyId, policyHolder.address, poolId, coverageAmount, 0, ethers.MaxUint256, 0, 0);

        // --- Execute a Claim to Accrue Distressed Assets ---
        await usdc.mint(riskManager.target, coverageAmount); // Pre-fund RM for payout
        await distressedToken.mint(policyHolder.address, coverageAmount); // Fund policyholder with the asset they'll give up
        await distressedToken.connect(policyHolder).approve(riskManager.target, ethers.MaxUint256);
        
        await riskManager.connect(policyHolder).processClaim(policyId, "0x");

        // The distressed assets are now held by the RiskManager, and pending for the underwriter
        const accruedAmount = coverageAmount; // In a single-underwriter pool, they get all of it.

        return { riskManager, underwriter, distressedToken, poolId, accruedAmount };
    }

    describe("Validation", function () {
        it("should revert if claiming from an invalid pool ID", async function () {
            const { riskManager, underwriter } = await loadFixture(deployAndAccrueDistressedAssetsFixture);
            await expect(riskManager.connect(underwriter).claimDistressedAssets(99))
                .to.be.revertedWithCustomError(riskManager, "InvalidPoolId");
        });

        it("should revert if the underwriter has no distressed assets to claim", async function () {
            const { riskManager, underwriter, poolId } = await loadFixture(deployAndAccrueDistressedAssetsFixture);
            // First claim is successful
            await riskManager.connect(underwriter).claimDistressedAssets(poolId);
            // Second claim should fail
            await expect(riskManager.connect(underwriter).claimDistressedAssets(poolId))
                .to.be.revertedWithCustomError(riskManager, "NoRewardsToClaim");
        });
    });

    describe("Successful Claim", function () {
        it("should transfer the correct amount of the correct distressed token", async function () {
            const { riskManager, underwriter, distressedToken, poolId, accruedAmount } = await loadFixture(deployAndAccrueDistressedAssetsFixture);

            await expect(async () =>
                riskManager.connect(underwriter).claimDistressedAssets(poolId)
            ).to.changeTokenBalances(distressedToken, [riskManager, underwriter], [-accruedAmount, accruedAmount]);
        });

        it("should reset the pending distressed assets for the underwriter in that pool to zero", async function () {
            const { riskManager, underwriter, poolId } = await loadFixture(deployAndAccrueDistressedAssetsFixture);
            await riskManager.connect(underwriter).claimDistressedAssets(poolId);
            const rewards = await riskManager.underwriterPoolRewards(poolId, underwriter.address);
            expect(rewards.pendingDistressedAssets).to.equal(0);
        });

        it("should emit a DistressedAssetRewardsClaimed event with correct arguments", async function () {
            const { riskManager, underwriter, distressedToken, poolId, accruedAmount } = await loadFixture(deployAndAccrueDistressedAssetsFixture);
            
            await expect(riskManager.connect(underwriter).claimDistressedAssets(poolId))
                .to.emit(riskManager, "DistressedAssetRewardsClaimed")
                .withArgs(underwriter.address, poolId, distressedToken.target, accruedAmount);
        });

        it("should not affect other pending rewards (e.g., premiums)", async function () {
            const { riskManager, underwriter, poolId } = await loadFixture(deployAndAccrueDistressedAssetsFixture);
            
            // Manually credit some premium rewards for the test
            const premiumRewardAmount = ethers.parseUnits("100", 6);
            await riskManager.mock_setPendingPremiums(poolId, underwriter.address, premiumRewardAmount);
            
            // Claim the distressed assets
            await riskManager.connect(underwriter).claimDistressedAssets(poolId);

            // Check that the premium rewards are untouched
            const rewards = await riskManager.underwriterPoolRewards(poolId, underwriter.address);
            expect(rewards.pendingPremiums).to.equal(premiumRewardAmount);
            expect(rewards.pendingDistressedAssets).to.equal(0); // This should be zero
        });
    });

    describe("Security", function () {
        it("should prevent reentrancy attacks", async function () {
            const { riskManager, distressedToken, poolId } = await loadFixture(deployAndAccrueDistressedAssetsFixture);
            
            // Deploy a malicious contract that will act as the underwriter
            const AttackerFactory = await ethers.getContractFactory("ReentrancyAttacker");
            // NOTE: We would need a custom malicious ERC20 to trigger reentrancy on `safeTransfer`.
            // For this test, we assume a standard setup and test the guard's presence.
            // A more advanced test would use a bespoke ERC777-like token.
            const attacker = await AttackerFactory.deploy(riskManager.target);

            // Setup attacker to be an underwriter with distressed asset rewards
            const cpAddr3 = await riskManager.capitalPool();
            await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [cpAddr3] });
            await hre.network.provider.send("hardhat_setBalance", [cpAddr3, "0x1000000000000000000"]);
            const cpSigner3 = await ethers.getSigner(cpAddr3);
            await riskManager.connect(cpSigner3).onCapitalDeposited(attacker.target, ethers.parseUnits("1000", 6));
            await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [cpAddr3] });
            await riskManager.connect(attacker).allocateCapital([poolId]);
            await distressedToken.mint(riskManager.target, ethers.parseUnits("100", 18));
            await riskManager.mock_setPendingDistressedAssets(poolId, attacker.target, ethers.parseUnits("10", 18));

            // Second call should revert as the rewards are claimed on the first call
            await expect(attacker.beginDistressedAssetAttack(poolId))
                .to.be.revertedWithCustomError(riskManager, "NoRewardsToClaim");
        });
    });
});


describe("RiskManager - View Functions", function() {
    it("getPoolInfo should return the correct data for a created pool", async function() {
        const { riskManager, owner, usdc, stEth } = await loadFixture(deployRiskManagerFixture);

        const rateModel = { base: 150, slope1: 300, slope2: 600, kink: 7500 };
        const protocolId = ProtocolRiskIdentifier.LIDO_STETH;
        const poolId = 0;
        
        await riskManager.addProtocolRiskPool(stEth.target, rateModel, protocolId);
        
        const poolInfo = await riskManager.getPoolInfo(poolId);

        expect(poolInfo.protocolTokenToCover).to.equal(stEth.target);
        expect(poolInfo.rateModel.base).to.equal(rateModel.base);
        expect(poolInfo.rateModel.slope1).to.equal(rateModel.slope1);
        expect(poolInfo.rateModel.slope2).to.equal(rateModel.slope2);
        expect(poolInfo.rateModel.kink).to.equal(rateModel.kink);
        expect(poolInfo.totalCapitalPledgedToPool).to.equal(0);
        expect(poolInfo.totalCoverageSold).to.equal(0);
        expect(poolInfo.protocolCovered).to.equal(protocolId);
        expect(poolInfo.isPaused).to.be.false;
    });
});

describe("RiskManager - Loss Realization", function() {
    async function deployLossFixture() {
        const [owner, underwriter] = await ethers.getSigners();

        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const usdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);

        const MockCapitalPoolFactory = await ethers.getContractFactory("MockCapitalPool");
        const capitalPool = await MockCapitalPoolFactory.deploy(owner.address, usdc.target);

        const PoolRegistryFactory = await ethers.getContractFactory("PoolRegistry");
        const poolRegistry = await PoolRegistryFactory.deploy(owner.address, owner.address);

        const LossDistributorFactory = await ethers.getContractFactory("LossDistributor");
        const lossDistributor = await LossDistributorFactory.deploy(owner.address);

        const MockPolicyNFTFactory = await ethers.getContractFactory("MockPolicyNFT");
        const policyNFT = await MockPolicyNFTFactory.deploy(owner.address);

        const MockCatPoolFactory = await ethers.getContractFactory("MockCatInsurancePool");
        const catPool = await MockCatPoolFactory.deploy(owner.address);

        const RiskManagerFactory = await ethers.getContractFactory("RiskManager", owner);
        const riskManager = await RiskManagerFactory.deploy(owner.address);

        await riskManager.setAddresses(capitalPool.target, poolRegistry.target, policyNFT.target, catPool.target, lossDistributor.target);
        await poolRegistry.setRiskManager(riskManager.target);
        await lossDistributor.setRiskManager(riskManager.target);

        return { riskManager, capitalPool, poolRegistry, lossDistributor, usdc, owner, underwriter };
    }

    it("realizes pending losses from multiple pools", async function() {
        const { riskManager, capitalPool, poolRegistry, lossDistributor, usdc, owner, underwriter } = await loadFixture(deployLossFixture);

        await riskManager.addProtocolRiskPool(usdc.target, { base:0, slope1:0, slope2:0, kink:0 }, 1);
        await riskManager.addProtocolRiskPool(usdc.target, { base:0, slope1:0, slope2:0, kink:0 }, 2);

        const depositAmount = ethers.parseUnits("100", 6);
        await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [capitalPool.target] });
        await hre.network.provider.send("hardhat_setBalance", [capitalPool.target, "0x1000000000000000000"]);
        const cpSigner = await ethers.getSigner(capitalPool.target);
        await riskManager.connect(cpSigner).onCapitalDeposited(underwriter.address, depositAmount);
        await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [capitalPool.target] });

        await riskManager.connect(underwriter).allocateCapital([0,1]);

        await lossDistributor.distributeLoss(0, ethers.parseUnits("20", 6), depositAmount);
        await lossDistributor.distributeLoss(1, ethers.parseUnits("30", 6), depositAmount);

        await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [capitalPool.target] });
        await hre.network.provider.send("hardhat_setBalance", [capitalPool.target, "0x1000000000000000000"]);
        const cpSigner2 = await ethers.getSigner(capitalPool.target);
        const tx = await riskManager.connect(cpSigner2).onCapitalWithdrawn(underwriter.address, 0, false);
        await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [capitalPool.target] });

        await expect(tx).to.emit(capitalPool, "LossesAppliedCalled").withArgs(underwriter.address, ethers.parseUnits("20", 6));
        await expect(tx).to.emit(capitalPool, "LossesAppliedCalled").withArgs(underwriter.address, ethers.parseUnits("30", 6));

        expect(await riskManager.underwriterTotalPledge(underwriter.address)).to.equal(ethers.parseUnits("50", 6));
    });
});
