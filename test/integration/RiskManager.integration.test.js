const { expect } = require("chai");
const { ethers } = require("hardhat");

// Integration test using real LossDistributor and RewardDistributor

describe("RiskManager Integration", function () {
    let owner, committee, underwriter, liquidator, nonParty;
    let riskManager, poolRegistry, capitalPool, policyNFT, catPool;
    let lossDistributor, rewardDistributor, policyManager, usdc;

    const POOL_ID = 0;
    const PLEDGE_AMOUNT = ethers.parseUnits("10000", 6);
    const LOSS_AMOUNT = ethers.parseUnits("1000", 6);

    beforeEach(async function () {
        [owner, committee, underwriter, liquidator, nonParty] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

        const MockPoolRegistry = await ethers.getContractFactory("MockPoolRegistry");
        poolRegistry = await MockPoolRegistry.deploy();
        await poolRegistry.setPoolCount(1);
        await poolRegistry.connect(owner).setPoolData(POOL_ID, usdc.target, 0, 0, 0, false, committee.address, 0);

        const MockCapitalPool = await ethers.getContractFactory("MockCapitalPool");
        capitalPool = await MockCapitalPool.deploy(owner.address, usdc.target);

        const MockPolicyNFT = await ethers.getContractFactory("MockPolicyNFT");
        policyNFT = await MockPolicyNFT.deploy(owner.address);

        const MockPolicyManager = await ethers.getContractFactory("MockPolicyManager");
        policyManager = await MockPolicyManager.deploy();
        await policyManager.setPolicyNFT(policyNFT.target);

        const MockCatPool = await ethers.getContractFactory("MockCatInsurancePool");
        catPool = await MockCatPool.deploy(owner.address);

        const RiskManager = await ethers.getContractFactory("RiskManager");
        riskManager = await RiskManager.deploy(owner.address);

        const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
        rewardDistributor = await RewardDistributor.deploy(riskManager.target);
        await rewardDistributor.setCatPool(catPool.target);

        const LossDistributor = await ethers.getContractFactory("LossDistributor");
        lossDistributor = await LossDistributor.deploy(riskManager.target);

        await riskManager.setAddresses(
            capitalPool.target,
            poolRegistry.target,
            policyManager.target,
            catPool.target,
            lossDistributor.target,
            rewardDistributor.target
        );
        await riskManager.setCommittee(committee.address);

        // allow RiskManager to interact with PolicyNFT
        await policyNFT.setRiskManagerAddress(riskManager.target);

        // Underwriter deposit and allocate
        await capitalPool.triggerOnCapitalDeposited(riskManager.target, underwriter.address, PLEDGE_AMOUNT);
        await capitalPool.setUnderwriterAdapterAddress(underwriter.address, nonParty.address);
        await riskManager.connect(underwriter).allocateCapital([POOL_ID]);
    });

    it("realizes distributed losses on withdrawal", async function () {
        // distribute loss as RiskManager
        await ethers.provider.send("hardhat_impersonateAccount", [riskManager.target]);
        const rmSigner = await ethers.getSigner(riskManager.target);
        await ethers.provider.send("hardhat_setBalance", [riskManager.target, "0x1000000000000000000"]);
        await lossDistributor.connect(rmSigner).distributeLoss(POOL_ID, LOSS_AMOUNT, PLEDGE_AMOUNT);
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);

        expect(await lossDistributor.getPendingLosses(underwriter.address, POOL_ID, PLEDGE_AMOUNT)).to.equal(LOSS_AMOUNT);

        // trigger withdrawal which realizes loss
        const withdraw = ethers.parseUnits("2000", 6);
        await capitalPool.triggerOnCapitalWithdrawn(riskManager.target, underwriter.address, withdraw, false);

        const expectedPledge = PLEDGE_AMOUNT - LOSS_AMOUNT - withdraw;
        expect(await riskManager.underwriterTotalPledge(underwriter.address)).to.equal(expectedPledge);
        expect(await capitalPool.applyLossesCallCount()).to.equal(1);
        expect(await capitalPool.last_applyLosses_principalLossAmount()).to.equal(LOSS_AMOUNT);
    });

    it("liquidates an insolvent underwriter", async function () {
        const SHARES = 1n;
        const shareValue = ethers.parseUnits("9000", 6);
        await capitalPool.setUnderwriterAccount(underwriter.address, SHARES);
        await capitalPool.setSharesToValue(SHARES, shareValue);

        // distribute loss larger than share value
        const loss = shareValue + 1n;
        await ethers.provider.send("hardhat_impersonateAccount", [riskManager.target]);
        const rm = await ethers.getSigner(riskManager.target);
        await ethers.provider.send("hardhat_setBalance", [riskManager.target, "0x1000000000000000000"]);
        await lossDistributor.connect(rm).distributeLoss(POOL_ID, loss, PLEDGE_AMOUNT);
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);

        await expect(riskManager.connect(liquidator).liquidateInsolventUnderwriter(underwriter.address))
            .to.emit(riskManager, "UnderwriterLiquidated")
            .withArgs(liquidator.address, underwriter.address);

        expect(await capitalPool.applyLossesCallCount()).to.equal(1);
        expect(await capitalPool.last_applyLosses_principalLossAmount()).to.equal(loss);
        const expectedPledge = PLEDGE_AMOUNT - loss;
        expect(await riskManager.underwriterTotalPledge(underwriter.address)).to.equal(expectedPledge);
        expect(await lossDistributor.getPendingLosses(underwriter.address, POOL_ID, PLEDGE_AMOUNT)).to.equal(0);
    });

    it("reverts liquidation when underwriter is solvent", async function () {
        const SHARES = 1n;
        const shareValue = ethers.parseUnits("9000", 6);
        await capitalPool.setUnderwriterAccount(underwriter.address, SHARES);
        await capitalPool.setSharesToValue(SHARES, shareValue);

        const loss = shareValue - 1n;
        await ethers.provider.send("hardhat_impersonateAccount", [riskManager.target]);
        const rm = await ethers.getSigner(riskManager.target);
        await ethers.provider.send("hardhat_setBalance", [riskManager.target, "0x1000000000000000000"]);
        await lossDistributor.connect(rm).distributeLoss(POOL_ID, loss, PLEDGE_AMOUNT);
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);

        await expect(
            riskManager.connect(liquidator).liquidateInsolventUnderwriter(underwriter.address)
        ).to.be.revertedWithCustomError(riskManager, "UnderwriterNotInsolvent");
    });
});
