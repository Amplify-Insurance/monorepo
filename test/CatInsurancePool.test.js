// test/CatInsurancePool.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Instead of using waffle style mocks (which are incompatible with
// the current hardhat/ethers setup) we deploy simple Solidity based
// mock contracts from the `contracts/test` directory.

describe("CatInsurancePool", function () {
    // --- Signers ---
    let owner, riskManager, policyManager, capitalPool, lp1, lp2, nonParty;

    // --- Contracts ---
    let catPool;
    let mockAdapter, mockRewardDistributor, mockUsdc, mockRewardToken, catShareToken;

    // --- Constants ---
    const MIN_USDC_AMOUNT = 1000n; // matches CatInsurancePool.MIN_USDC_AMOUNT
    const CAT_POOL_REWARD_ID = ethers.MaxUint256;


    beforeEach(async function () {
        // --- Get Signers ---
        [owner, riskManager, policyManager, capitalPool, lp1, lp2, nonParty] = await ethers.getSigners();

        // --- Deploy Mocks ---
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        mockUsdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
        await mockUsdc.mint(owner.address, ethers.parseUnits("1000000", 6));
        mockRewardToken = await MockERC20Factory.deploy("Reward Token", "RWT", 18);
        await mockRewardToken.mint(owner.address, ethers.parseUnits("1000000", 18));
        
        const MockYieldAdapter = await ethers.getContractFactory("MockYieldAdapter");
        mockAdapter = await MockYieldAdapter.deploy(mockUsdc.target, ethers.ZeroAddress, owner.address);

        const MockRewardDistributor = await ethers.getContractFactory("MockRewardDistributor");
        mockRewardDistributor = await MockRewardDistributor.deploy();
        
        // --- Deploy CatInsurancePool ---
        const CatShareFactory = await ethers.getContractFactory("CatShare");
        catShareToken = await CatShareFactory.deploy();

        const CatPoolFactory = await ethers.getContractFactory("CatInsurancePool");
        catPool = await CatPoolFactory.deploy(mockUsdc.target, catShareToken.target, mockAdapter.target, owner.address);

        await catShareToken.transferOwnership(catPool.target);
        await catPool.initialize();

        // --- Initial Setup ---
        // Mint tokens to LPs and approve the CatPool
        await mockUsdc.transfer(lp1.address, ethers.parseUnits("10000", 6));
        await mockUsdc.transfer(lp2.address, ethers.parseUnits("10000", 6));
        await mockUsdc.connect(lp1).approve(catPool.target, ethers.MaxUint256);
        await mockUsdc.connect(lp2).approve(catPool.target, ethers.MaxUint256);

        // Set up initial addresses
        await catPool.connect(owner).setRiskManagerAddress(riskManager.address);
        await catPool.connect(owner).setPolicyManagerAddress(policyManager.address);
        await catPool.connect(owner).setCapitalPoolAddress(capitalPool.address);
        await catPool.connect(owner).setRewardDistributor(mockRewardDistributor.target);

        // Configure mocks
        await mockRewardDistributor.setCatPool(catPool.target);
        await mockAdapter.setDepositor(catPool.target);
        await mockAdapter.setTotalValueHeld(0);
    });

    describe("Initialization", function () {
        it("Should emit Initialized and prevent re-initialization", async function () {
            const CatShareFactory = await ethers.getContractFactory("CatShare");
            const share = await CatShareFactory.deploy();
            const CatPoolFactory = await ethers.getContractFactory("CatInsurancePool");
            const pool = await CatPoolFactory.deploy(mockUsdc.target, share.target, ethers.ZeroAddress, owner.address);

            await share.transferOwnership(pool.target);
            await expect(pool.initialize()).to.emit(pool, "Initialized");

            await expect(pool.initialize()).to.be.revertedWith("CIP: Already initialized");
        });

        it("Should revert initialize when pool does not own CatShare", async function () {
            const CatShareFactory = await ethers.getContractFactory("CatShare");
            const share = await CatShareFactory.deploy();
            const CatPoolFactory = await ethers.getContractFactory("CatInsurancePool");
            const pool = await CatPoolFactory.deploy(mockUsdc.target, share.target, ethers.ZeroAddress, owner.address);

            await expect(pool.initialize()).to.be.revertedWith("CIP: Pool must be owner of share token");
        });

        it("Should revert constructor when USDC address is zero", async function () {
            const CatShareFactory = await ethers.getContractFactory("CatShare");
            const share = await CatShareFactory.deploy();
            const CatPoolFactory = await ethers.getContractFactory("CatInsurancePool");
            await expect(CatPoolFactory.deploy(ethers.ZeroAddress, share.target, ethers.ZeroAddress, owner.address))
                .to.be.revertedWith("CIP: Invalid USDC token address");
        });

        it("Should revert constructor when CatShare address is zero", async function () {
            const CatPoolFactory = await ethers.getContractFactory("CatInsurancePool");
            await expect(CatPoolFactory.deploy(mockUsdc.target, ethers.ZeroAddress, ethers.ZeroAddress, owner.address))
                .to.be.revertedWith("CIP: Invalid CatShare token address");
        });
    });

    describe("Admin Functions", function () {
        it("Should set all external contract addresses correctly", async function () {
            expect(await catPool.riskManagerAddress()).to.equal(riskManager.address);
            expect(await catPool.policyManagerAddress()).to.equal(policyManager.address);
            expect(await catPool.capitalPoolAddress()).to.equal(capitalPool.address);
            expect(await catPool.rewardDistributor()).to.equal(mockRewardDistributor.target);
        });

        it("Should prevent non-owners from setting addresses", async function () {
            await expect(catPool.connect(nonParty).setRiskManagerAddress(nonParty.address))
                .to.be.revertedWithCustomError(catPool, "OwnableUnauthorizedAccount");
        });

        it("Should revert when setting addresses to zero", async function () {
            await expect(catPool.connect(owner).setRiskManagerAddress(ethers.ZeroAddress))
                .to.be.revertedWith("CIP: Address cannot be zero");
            await expect(catPool.connect(owner).setCapitalPoolAddress(ethers.ZeroAddress))
                .to.be.revertedWith("CIP: Address cannot be zero");
            await expect(catPool.connect(owner).setPolicyManagerAddress(ethers.ZeroAddress))
                .to.be.revertedWith("CIP: Address cannot be zero");
        });

        it("Should allow owner to set a new adapter and flush funds from the old one", async function() {
            // Deposit some funds and flush to the adapter
            const depositAmount = ethers.parseUnits("100", 6);
            await mockUsdc.connect(owner).approve(catPool.target, depositAmount);
            await catPool.connect(owner).setPolicyManagerAddress(owner.address); // Temporarily set to owner for test
            await catPool.connect(owner).receiveUsdcPremium(depositAmount);
            await catPool.connect(owner).flushToAdapter(depositAmount);
            
            // Set up mocks for the switch
            const MockYieldAdapter = await ethers.getContractFactory("MockYieldAdapter");
            const newAdapter = await MockYieldAdapter.deploy(mockUsdc.target, ethers.ZeroAddress, owner.address);
            await mockAdapter.setTotalValueHeld(depositAmount);
            await mockAdapter.setDepositor(catPool.target);

            await expect(catPool.connect(owner).setAdapter(newAdapter.target))
                .to.emit(catPool, "AdapterChanged").withArgs(newAdapter.target);

            expect(await catPool.idleUSDC()).to.equal(depositAmount);
            expect(await catPool.adapter()).to.equal(newAdapter.target);
        });
        // New admin event tests
        it("Should emit events when updating addresses", async function() {
            await expect(catPool.connect(owner).setRiskManagerAddress(lp1.address))
                .to.emit(catPool, "RiskManagerAddressSet").withArgs(lp1.address);
            await expect(catPool.connect(owner).setCapitalPoolAddress(lp2.address))
                .to.emit(catPool, "CapitalPoolAddressSet").withArgs(lp2.address);
            await expect(catPool.connect(owner).setPolicyManagerAddress(lp2.address))
                .to.emit(catPool, "PolicyManagerAddressSet").withArgs(lp2.address);
            await expect(catPool.connect(owner).setRewardDistributor(nonParty.address))
                .to.emit(catPool, "RewardDistributorSet").withArgs(nonParty.address);
        });

        it("flushToAdapter should deposit and emit event", async function() {
            const amount = ethers.parseUnits("1000", 6);
            await catPool.connect(lp1).depositLiquidity(amount);
            await expect(catPool.connect(owner).flushToAdapter(amount))
                .to.emit(catPool, "DepositToAdapter").withArgs(amount);
            expect(await catPool.idleUSDC()).to.equal(0);
            expect(await mockAdapter.totalValueHeld()).to.equal(amount);
        });
    });

    describe("Liquidity Provision", function () {
        const DEPOSIT_AMOUNT = ethers.parseUnits("1000", 6);

        it("Should handle first liquidity deposit correctly (1:1 share mint)", async function() {
            await expect(catPool.connect(lp1).depositLiquidity(DEPOSIT_AMOUNT))
                .to.emit(catPool, "CatLiquidityDeposited")
                .withArgs(lp1.address, DEPOSIT_AMOUNT, DEPOSIT_AMOUNT); // 1:1 shares
            
            expect(await catShareToken.balanceOf(lp1.address)).to.equal(DEPOSIT_AMOUNT);
            expect(await catPool.idleUSDC()).to.equal(DEPOSIT_AMOUNT);
        });

        it("Should handle subsequent deposits based on NAV", async function() {
            // LP1 deposits
            await catPool.connect(lp1).depositLiquidity(DEPOSIT_AMOUNT);

            // Simulate yield gain of 10%
            await mockAdapter.setTotalValueHeld(DEPOSIT_AMOUNT * 110n / 100n);

            // LP2 deposits the same amount of USDC
            const totalShares = await catShareToken.totalSupply();
            const totalValue = await catPool.liquidUsdc();
            const expectedShares = (DEPOSIT_AMOUNT * totalShares) / totalValue;

            await expect(catPool.connect(lp2).depositLiquidity(DEPOSIT_AMOUNT))
                .to.emit(catPool, "CatLiquidityDeposited")
                .withArgs(lp2.address, DEPOSIT_AMOUNT, expectedShares);

            expect(await catShareToken.balanceOf(lp2.address)).to.equal(expectedShares);
            expect(expectedShares).to.be.lt(DEPOSIT_AMOUNT);
        });

        it("Should allow withdrawing liquidity, pulling from idleUSDC first", async function() {
            await catPool.connect(lp1).depositLiquidity(DEPOSIT_AMOUNT);
            const sharesToBurn = await catShareToken.balanceOf(lp1.address) / 2n;
            const totalShares = await catShareToken.totalSupply();
            const usdcToWithdraw = (sharesToBurn * (await catPool.liquidUsdc())) / totalShares;

            await expect(catPool.connect(lp1).withdrawLiquidity(sharesToBurn))
                .to.emit(catPool, "CatLiquidityWithdrawn")
                .withArgs(lp1.address, usdcToWithdraw, sharesToBurn);

            const finalBalance = await mockUsdc.balanceOf(lp1.address);
            const expectedBalance = ethers.parseUnits("10000", 6) - DEPOSIT_AMOUNT + usdcToWithdraw;
            expect(finalBalance).to.equal(expectedBalance);
        });
        
        it("Should allow withdrawing liquidity, pulling from adapter if idle is insufficient", async function() {
            // LP1 deposits, and funds are moved to adapter
            await catPool.connect(lp1).depositLiquidity(DEPOSIT_AMOUNT);
            await catPool.connect(owner).flushToAdapter(DEPOSIT_AMOUNT);
            expect(await catPool.idleUSDC()).to.equal(0);
            
            // Setup mocks for withdrawal
            const sharesToBurn = await catShareToken.balanceOf(lp1.address);
            await mockAdapter.setTotalValueHeld(DEPOSIT_AMOUNT);

            await catPool.connect(lp1).withdrawLiquidity(sharesToBurn);

            const finalBalance = await mockUsdc.balanceOf(lp1.address);
            const expectedBalance = ethers.parseUnits("10000", 6) - DEPOSIT_AMOUNT +
                (sharesToBurn * DEPOSIT_AMOUNT) / (sharesToBurn + 1000n);
            expect(finalBalance).to.equal(expectedBalance);
        });
    });

    describe("Trusted Functions", function() {
        it("receiveUsdcPremium should accept funds from the PolicyManager", async function() {
            const premiumAmount = ethers.parseUnits("50", 6);
            await mockUsdc.connect(owner).transfer(policyManager.address, premiumAmount);
            await mockUsdc.connect(policyManager).approve(catPool.target, premiumAmount);

            await expect(catPool.connect(policyManager).receiveUsdcPremium(premiumAmount))
                .to.emit(catPool, "UsdcPremiumReceived").withArgs(premiumAmount);
            
            expect(await catPool.idleUSDC()).to.equal(premiumAmount);
        });
        
        it("drawFund should send funds to the CapitalPool when called by RiskManager", async function() {
            const depositAmount = ethers.parseUnits("1000", 6);
            await catPool.connect(lp1).depositLiquidity(depositAmount);
            const drawAmount = ethers.parseUnits("100", 6);

            await expect(catPool.connect(riskManager).drawFund(drawAmount))
                .to.emit(catPool, "DrawFromFund");

            expect(await mockUsdc.balanceOf(capitalPool.address)).to.equal(drawAmount);
            expect(await catPool.idleUSDC()).to.equal(depositAmount - drawAmount);
        });

        it("drawFund should withdraw from adapter when idle funds are insufficient", async function() {
            const depositAmount = ethers.parseUnits("1000", 6);
            await catPool.connect(lp1).depositLiquidity(depositAmount);
            const flushAmount = ethers.parseUnits("800", 6);

            // Move most funds to the adapter
            await catPool.connect(owner).flushToAdapter(flushAmount);
            expect(await catPool.idleUSDC()).to.equal(depositAmount - flushAmount);

            const drawAmount = ethers.parseUnits("600", 6); // more than idle
            await mockAdapter.setTotalValueHeld(flushAmount);

            await expect(catPool.connect(riskManager).drawFund(drawAmount))
                .to.emit(catPool, "DrawFromFund").withArgs(drawAmount, drawAmount);

            expect(await mockUsdc.balanceOf(capitalPool.address)).to.equal(drawAmount);
            expect(await catPool.idleUSDC()).to.equal(0);
            expect(await mockAdapter.totalValueHeld()).to.equal(flushAmount - (drawAmount - (depositAmount - flushAmount)));
        });
        
        it("receiveProtocolAssetsForDistribution should call the RewardDistributor", async function() {
            const rewardAmount = ethers.parseUnits("100", 18);
            await mockRewardToken.connect(owner).transfer(riskManager.address, rewardAmount);
            await mockRewardToken.connect(riskManager).approve(catPool.target, rewardAmount);
            const totalShares = await catShareToken.totalSupply();

            await expect(
                catPool.connect(riskManager).receiveProtocolAssetsForDistribution(
                    mockRewardToken.target,
                    rewardAmount
                )
            ).to.emit(catPool, "ProtocolAssetReceivedForDistribution");

            expect(
                await mockRewardDistributor.totalRewards(CAT_POOL_REWARD_ID, mockRewardToken.target)
            ).to.equal(rewardAmount);
        });
    });

    describe("View Functions", function() {
        it("liquidUsdc should include adapter balance", async function() {
            const amount = ethers.parseUnits("1000", 6);
            await catPool.connect(lp1).depositLiquidity(amount);
            await catPool.connect(owner).flushToAdapter(amount);
            await mockAdapter.setTotalValueHeld(amount * 2n);
            expect(await catPool.liquidUsdc()).to.equal(amount * 2n);
        });
    });
    describe("Rewards", function() {
        it("claimProtocolAssetRewards should call the reward distributor", async function() {
            const rewardAmount = ethers.parseUnits("50", 18);
            await catPool.connect(lp1).depositLiquidity(ethers.parseUnits("1000", 6));
            const userShares = await catShareToken.balanceOf(lp1.address);
            // Distribute rewards first
            await mockRewardToken.connect(owner).transfer(riskManager.address, rewardAmount);
            await mockRewardToken.connect(riskManager).approve(catPool.target, rewardAmount);
            await catPool.connect(riskManager).receiveProtocolAssetsForDistribution(mockRewardToken.target, rewardAmount);

            const totalSharesAfter = await catShareToken.totalSupply();
            const expectedReward = (rewardAmount * userShares) / totalSharesAfter;

            await expect(
                catPool.connect(lp1).claimProtocolAssetRewards(mockRewardToken.target)
            )
                .to.emit(catPool, "ProtocolAssetRewardsClaimed")
                .withArgs(lp1.address, mockRewardToken.target, expectedReward);
        });
    });

    describe("Validation and Reverts", function () {
        it("Should revert when deposit amount is below minimum", async function () {
            await expect(
                catPool.connect(lp1).depositLiquidity(MIN_USDC_AMOUNT - 1n)
            ).to.be.revertedWith("CIP: Amount below minimum");
        });

        it("Should revert when withdrawing zero shares", async function () {
            await catPool.connect(lp1).depositLiquidity(MIN_USDC_AMOUNT);
            await expect(
                catPool.connect(lp1).withdrawLiquidity(0)
            ).to.be.revertedWith("CIP: Shares to burn must be positive");
        });

        it("Should revert when withdrawing more shares than owned", async function () {
            await catPool.connect(lp1).depositLiquidity(MIN_USDC_AMOUNT);
            await expect(
                catPool.connect(lp1).withdrawLiquidity(MIN_USDC_AMOUNT * 2n)
            ).to.be.revertedWith("CIP: Insufficient CatShare balance");
        });

        it("flushToAdapter should validate amount and adapter", async function () {
            await catPool.connect(owner).setAdapter(ethers.ZeroAddress);
            await catPool.connect(owner).setPolicyManagerAddress(owner.address);
            await mockUsdc.connect(owner).approve(catPool.target, MIN_USDC_AMOUNT);
            await catPool.connect(owner).receiveUsdcPremium(MIN_USDC_AMOUNT);
            await expect(
                catPool.connect(owner).flushToAdapter(0)
            ).to.be.revertedWith("CIP: Amount must be > 0");
            await expect(
                catPool.connect(owner).flushToAdapter(MIN_USDC_AMOUNT)
            ).to.be.revertedWith("CIP: Yield adapter not set");
        });

        it("flushToAdapter should not allow withdrawing more than idle", async function () {
            await mockUsdc.connect(owner).approve(catPool.target, MIN_USDC_AMOUNT);
            await catPool.connect(owner).setPolicyManagerAddress(owner.address);
            await catPool.connect(owner).receiveUsdcPremium(MIN_USDC_AMOUNT);
            await expect(
                catPool.connect(owner).flushToAdapter(MIN_USDC_AMOUNT * 2n)
            ).to.be.revertedWith("CIP: Amount exceeds idle USDC");
        });

        it("setRewardDistributor should enforce access control and non-zero", async function () {
            await expect(
                catPool.connect(nonParty).setRewardDistributor(mockRewardDistributor.target)
            ).to.be.revertedWithCustomError(catPool, "OwnableUnauthorizedAccount");

            await expect(
                catPool.connect(owner).setRewardDistributor(ethers.ZeroAddress)
            ).to.be.revertedWith("CIP: Address cannot be zero");
        });

        it("receiveUsdcPremium should only be callable by PolicyManager and with positive amount", async function () {
            await expect(
                catPool.connect(owner).receiveUsdcPremium(MIN_USDC_AMOUNT)
            ).to.be.revertedWith("CIP: Caller is not the PolicyManager");

            await mockUsdc.connect(policyManager).approve(catPool.target, 0);
            await expect(
                catPool.connect(policyManager).receiveUsdcPremium(0)
            ).to.be.revertedWith("CIP: Premium amount must be positive");
        });

        it("drawFund should enforce risk manager and validate amounts", async function () {
            await catPool.connect(lp1).depositLiquidity(MIN_USDC_AMOUNT * 2n);

            await expect(
                catPool.connect(owner).drawFund(1)
            ).to.be.revertedWith("CIP: Caller is not the RiskManager");

            await expect(
                catPool.connect(riskManager).drawFund(0)
            ).to.be.revertedWith("CIP: Draw amount must be positive");

            await expect(
                catPool.connect(riskManager).drawFund(MIN_USDC_AMOUNT * 3n)
            ).to.be.revertedWith("CIP: Draw amount exceeds Cat Pool's liquid USDC");
        });

        it("drawFund should revert when capital pool address is unset", async function () {
            const CatShareFactory = await ethers.getContractFactory("CatShare");
            const share = await CatShareFactory.deploy();
            const CatPoolFactory = await ethers.getContractFactory("CatInsurancePool");
            const pool = await CatPoolFactory.deploy(mockUsdc.target, share.target, mockAdapter.target, owner.address);
            await share.transferOwnership(pool.target);
            await pool.initialize();
            await pool.connect(owner).setRiskManagerAddress(riskManager.address);
            await mockAdapter.setDepositor(pool.target);

            await mockUsdc.connect(lp1).approve(pool.target, MIN_USDC_AMOUNT);
            await pool.connect(lp1).depositLiquidity(MIN_USDC_AMOUNT);

            await expect(pool.connect(riskManager).drawFund(MIN_USDC_AMOUNT))
                .to.be.revertedWith("CIP: CapitalPool address not set");
        });

        it("claimProtocolAssetRewards should revert when no rewards", async function () {
            await catPool.connect(lp1).depositLiquidity(MIN_USDC_AMOUNT);
            await expect(
                catPool.connect(lp1).claimProtocolAssetRewards(mockRewardToken.target)
            ).to.be.revertedWith("CIP: No rewards to claim for this asset");
        });

        it("getPendingProtocolAssetRewards should return zero when distributor unset", async function () {
            const CatShareFactory = await ethers.getContractFactory("CatShare");
            const newShare = await CatShareFactory.deploy();
            const CatPoolFactory = await ethers.getContractFactory("CatInsurancePool");
            const newCatPool = await CatPoolFactory.deploy(mockUsdc.target, newShare.target, ethers.ZeroAddress, owner.address);
            await newShare.transferOwnership(newCatPool.target);
            await newCatPool.initialize();
            await newCatPool.connect(owner).setRiskManagerAddress(riskManager.address);
            await newCatPool.connect(owner).setPolicyManagerAddress(policyManager.address);
            await expect(await newCatPool.getPendingProtocolAssetRewards(lp1.address, mockRewardToken.target)).to.equal(0);
        });

        it("getPendingProtocolAssetRewards should return correct value with rewards", async function () {
            const depositAmount = ethers.parseUnits("1000", 6);
            await catPool.connect(lp1).depositLiquidity(depositAmount);
            const userShares = await catShareToken.balanceOf(lp1.address);

            const rewardAmount = ethers.parseUnits("100", 18);
            await mockRewardToken.connect(owner).transfer(riskManager.address, rewardAmount);
            await mockRewardToken.connect(riskManager).approve(catPool.target, rewardAmount);
            await catPool.connect(riskManager).receiveProtocolAssetsForDistribution(mockRewardToken.target, rewardAmount);

            const totalShares = await catShareToken.totalSupply();
            const expected = (rewardAmount * userShares) / totalShares;

            expect(await catPool.getPendingProtocolAssetRewards(lp1.address, mockRewardToken.target)).to.equal(expected);
        });

        it("Should revert when withdrawal amount below minimum", async function () {
            const depositAmount = ethers.parseUnits("2000", 6);
            await catPool.connect(lp1).depositLiquidity(depositAmount);
            await expect(catPool.connect(lp1).withdrawLiquidity(1))
                .to.be.revertedWith("CIP: Withdrawal amount below minimum");
        });

        it("Should revert when adapter cannot return enough funds", async function () {
            const depositAmount = ethers.parseUnits("2000", 6);
            await catPool.connect(lp1).depositLiquidity(depositAmount);

            // Move half to the adapter and then inflate its reported value
            const flushAmount = depositAmount / 2n;
            await catPool.connect(owner).flushToAdapter(flushAmount);
            await mockAdapter.setTotalValueHeld(flushAmount * 4n); // Report more than actual balance

            const shares = await catShareToken.balanceOf(lp1.address);
            await expect(catPool.connect(lp1).withdrawLiquidity(shares))
                .to.be.revertedWith("CIP: Adapter withdrawal failed");
        });

        it("claimProtocolAssetRewards should revert when distributor unset", async function () {
            const CatShareFactory = await ethers.getContractFactory("CatShare");
            const share = await CatShareFactory.deploy();
            const CatPoolFactory = await ethers.getContractFactory("CatInsurancePool");
            const pool = await CatPoolFactory.deploy(mockUsdc.target, share.target, ethers.ZeroAddress, owner.address);
            await share.transferOwnership(pool.target);
            await pool.initialize();
            await pool.connect(owner).setRiskManagerAddress(riskManager.address);
            await pool.connect(owner).setPolicyManagerAddress(policyManager.address);

            await mockUsdc.connect(lp1).approve(pool.target, MIN_USDC_AMOUNT);
            await pool.connect(lp1).depositLiquidity(MIN_USDC_AMOUNT);
            await expect(
                pool.connect(lp1).claimProtocolAssetRewards(mockRewardToken.target)
            ).to.be.revertedWith("CIP: Reward distributor not set");
        });

        it("receiveProtocolAssetsForDistribution should validate caller and params", async function () {
            await expect(
                catPool.connect(owner).receiveProtocolAssetsForDistribution(mockRewardToken.target, 1)
            ).to.be.revertedWith("CIP: Caller is not the RiskManager");

            await expect(
                catPool.connect(riskManager).receiveProtocolAssetsForDistribution(ethers.ZeroAddress, 1)
            ).to.be.revertedWith("CIP: Protocol asset cannot be zero address");

            await mockRewardToken.connect(owner).transfer(riskManager.address, 1);
            await mockRewardToken.connect(riskManager).approve(catPool.target, 1);
            await expect(
                catPool.connect(riskManager).receiveProtocolAssetsForDistribution(mockRewardToken.target, 0)
            ).to.be.revertedWith("CIP: Amount of protocol asset must be positive");

            const CatShareFactory = await ethers.getContractFactory("CatShare");
            const share2 = await CatShareFactory.deploy();
            const CatPoolFactory = await ethers.getContractFactory("CatInsurancePool");
            const pool2 = await CatPoolFactory.deploy(mockUsdc.target, share2.target, ethers.ZeroAddress, owner.address);
            await share2.transferOwnership(pool2.target);
            await pool2.initialize();
            await pool2.connect(owner).setRiskManagerAddress(riskManager.address);
            await mockRewardToken.connect(riskManager).approve(pool2.target, 1);
            await expect(
                pool2.connect(riskManager).receiveProtocolAssetsForDistribution(mockRewardToken.target, 1)
            ).to.be.revertedWith("CIP: Reward distributor not set");
        });
        it("Should revert when deposit would mint zero shares", async function() {
            const amount = ethers.parseUnits("1000", 6);
            await catPool.connect(lp1).depositLiquidity(amount);
            await catPool.connect(owner).flushToAdapter(amount);
            await mockAdapter.setTotalValueHeld(amount * 1000000000000n);
            await expect(catPool.connect(lp2).depositLiquidity(amount))
                .to.be.revertedWith("CIP: No shares to mint");
        });


    });
    describe("Security", function() {
        it("Should prevent re-entrancy on depositLiquidity", async function() {
            const MaliciousUSDCFactory = await ethers.getContractFactory("MaliciousToken");
            const maliciousUsdc = await MaliciousUSDCFactory.deploy(catPool.target);
            await maliciousUsdc.setDepositArgs(ethers.parseUnits("1000", 6), 0); // Re-enter with 0
            
            await expect(maliciousUsdc.executeDeposit()).to.be.reverted; // The inner call will revert with ReentrancyGuard
        });

        it("Should prevent re-entrancy on withdrawLiquidity", async function() {
            // Deposit enough liquidity so we can keep some CatShares in the malicious adapter
            const depositAmount = ethers.parseUnits("2000", 6);
            await catPool.connect(lp1).depositLiquidity(depositAmount);

            // Deploy malicious adapter that re-enters on withdraw
            const MaliciousAdapterFactory = await ethers.getContractFactory("MaliciousAdapter");
            const maliciousAdapter = await MaliciousAdapterFactory.deploy(catPool.target, mockUsdc.target);

            // Transfer half of LP1's CatShares to the malicious adapter so it can pass the
            // balance checks when it re-enters.
            const totalShares = await catShareToken.balanceOf(lp1.address);
            const sharesForAdapter = totalShares / 2n;
            await catShareToken.connect(lp1).transfer(maliciousAdapter.target, sharesForAdapter);
            const sharesToBurn = totalShares - sharesForAdapter;
            await maliciousAdapter.setWithdrawArgs(sharesToBurn);


            await catPool.connect(owner).setAdapter(maliciousAdapter.target);

            // Move funds to the malicious adapter
            await mockAdapter.setTotalValueHeld(0); // Old adapter is empty
            await catPool.connect(owner).flushToAdapter(depositAmount);

            await expect(catPool.connect(lp1).withdrawLiquidity(sharesToBurn))
                .to.be.reverted;
        });
    });
});

// Helper contract for re-entrancy test on deposit
const MaliciousTokenArtifact = {
    "contractName": "MaliciousToken",
    "abi": [
        {"inputs":[{"internalType":"address","name":"_catPool","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},
        {"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[],"name":"executeDeposit","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[{"internalType":"uint256","name":"_amount","type":"uint256"},{"internalType":"uint256","name":"_yieldChoice","type":"uint256"}],"name":"setDepositArgs","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[{"internalType":"address","name":"","type":"address"},{"internalType":"address","name":"","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"success","type":"bool"}],"stateMutability":"nonpayable","type":"function"}
    ],
    "bytecode": "0x608060405234801561001057600080fd5b50604051610368380380610368833981810160405281019061003291906102cc565b806000819055505061030e565b600080fd5b61005c82610118565b610066826102d8565b905060008152600181526020818152602001925050506020810190506001019050919050565b600060006002600084815260200190815260200160002054905080820190808211156100e4576000828202808211156100e457fe5b9060200190a1919050565b6330c5419460e01b81526004018080602001828103825260168152602001807f4d616c6963696f7573546f6b656e000000000000000000000000000000000000815250600091019061014e565b610157826102a9565b6000828210156101855763a9059cbb81810380828337508281111561017c57600080fd5b509392505050565b6000602082840312156101ae57600080fd5b5035919050565b6101bb826102a9565b6000808282540392505081905550565b600060008282540392505081905550565b600081519050919050565b6102c1816102b2565b82525050565b60006020820190506001600083018460405180828051906020019080838360005b83811015610170578082015181840152602001835260200182810190508083111561017057fe5b50505050905090810190601f16801561019d57808203815260200180519050905090565b5050565b600060006001838152602001908152602001600020549050919050565b6000806000828254039250508190555056fea2646970667358221220a2e796e625d97f8417539002dd9422a571f3756bd84a7e80064f7b6b199bb63d64736f6c63430008140033"
};

ethers.ContractFactory.getContractFactory = async (name, signer) => {
    if (name === "MockERC20") {
        const factory = new ethers.ContractFactory(MockERC20Artifact.abi, MockERC20Artifact.bytecode, signer);
        return factory;
    }
    if (name === "MaliciousToken") {
        const factory = new ethers.ContractFactory(MaliciousTokenArtifact.abi, MaliciousTokenArtifact.bytecode, signer);
        return factory;
    }
    const hardhatEthers = require("hardhat").ethers;
    return hardhatEthers.getContractFactory(name, signer);
};

const fs = require('fs');
const path = require('path');
// Helper contract for re-entrancy test on deposit
const maliciousTokenSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface ICatPool {
    function depositLiquidity(uint256 usdcAmount) external;
}
contract MaliciousToken {
    ICatPool catPool;
    uint256 amount;
    uint256 yieldChoice;
    constructor(address _catPool) {
        catPool = ICatPool(_catPool);
    }
    function setDepositArgs(uint256 _amount, uint256 _yieldChoice) external {
        amount = _amount;
        yieldChoice = _yieldChoice;
    }
    function executeDeposit() external {
        catPool.depositLiquidity(amount);
    }
    function approve(address spender, uint256 amount) external returns (bool) { return true; }
    function transferFrom(address, address, uint256 amount) external returns (bool success) {
        // Re-enter
        catPool.depositLiquidity(amount);
        return true;
    }
}
`;
fs.writeFileSync(path.join(__dirname, "..", "contracts", "MaliciousToken.sol"), maliciousTokenSource);
// Recreate other helper contracts if they were deleted by other test runs
const maliciousAdapterSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
interface ICatPool {
    function withdrawLiquidity(uint256 shareAmount) external;
}
contract MaliciousAdapter {
    ICatPool catPool;
    IERC20 public asset;
    uint256 sharesToBurn;
    constructor(address _catPool, address _asset) {
        catPool = ICatPool(_catPool);
        asset = IERC20(_asset);
    }
    function setWithdrawArgs(uint256 _shares) external {
        sharesToBurn = _shares;
    }
    function deposit(uint256 amount) external {
        asset.transferFrom(msg.sender, address(this), amount);
    }
    function withdraw(uint256, address) external returns (uint256) {
        catPool.withdrawLiquidity(sharesToBurn);
        return 0;
    }
    function getCurrentValueHeld() external view returns (uint256) { return asset.balanceOf(address(this)); }
}
`;
fs.writeFileSync(path.join(__dirname, "..", "contracts", "MaliciousAdapter.sol"), maliciousAdapterSource);
