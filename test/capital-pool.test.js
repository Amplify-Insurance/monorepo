const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// A simple mock for an ERC20 token
async function deployMockERC20() {
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const mockERC20 = await MockERC20Factory.deploy("Mock Token", "MTKN", 18);
    return { mockERC20 };
}


// To make a direct comparison with the Solidity test, we map the enum values.
// In CapitalPool.sol: enum YieldPlatform { NONE, AAVE, COMPOUND, OTHER_YIELD }
const YieldPlatform = {
    NONE: 0,
    AAVE: 1,
    COMPOUND: 2,
    OTHER_YIELD: 3,
};

describe("CapitalPool - Constructor and Admin Functions", function () {

    // A simple fixture to deploy the CapitalPool contract
    async function deployCapitalPoolFixture() {
        const [owner, nonOwner, riskManagerAddress] = await ethers.getSigners();
        const { mockERC20: underlyingAsset } = await loadFixture(deployMockERC20);
        
        const CapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
        const capitalPool = await CapitalPoolFactory.deploy(owner.address, underlyingAsset.address);

        return { capitalPool, owner, nonOwner, underlyingAsset, riskManagerAddress };
    }

    // --- Tests for the Constructor ---
    
    describe("Constructor", function() {
        it("should deploy successfully with valid arguments", async function () {
            const { capitalPool, owner, underlyingAsset } = await loadFixture(deployCapitalPoolFixture);

            // Assert that the contract was deployed and state variables are set correctly
            expect(capitalPool.address).to.be.properAddress;
            expect(await capitalPool.owner()).to.equal(owner.address);
            expect(await capitalPool.underlyingAsset()).to.equal(underlyingAsset.address);
        });

        it("should revert if the _underlyingAsset address is the zero address", async function () {
            const [owner] = await ethers.getSigners();
            const CapitalPoolFactory = await ethers.getContractFactory("CapitalPool");

            // Expect deployment to fail with the custom ZeroAddress error
            await expect(
                CapitalPoolFactory.deploy(owner.address, ethers.constants.AddressZero)
            ).to.be.revertedWithCustomError(CapitalPoolFactory, "ZeroAddress");
        });
    });

    // --- Tests for setRiskManager ---

    describe("setRiskManager", function() {
        it("should allow the owner to set the RiskManager address", async function () {
            const { capitalPool, owner, riskManagerAddress } = await loadFixture(deployCapitalPoolFixture);
            
            // Check that the address is correctly set
            await capitalPool.connect(owner).setRiskManager(riskManagerAddress.address);
            expect(await capitalPool.riskManager()).to.equal(riskManagerAddress.address);
        });

        it("should emit a RiskManagerSet event on successful setting", async function () {
            const { capitalPool, owner, riskManagerAddress } = await loadFixture(deployCapitalPoolFixture);
            
            // Check for the correct event and arguments
            await expect(capitalPool.connect(owner).setRiskManager(riskManagerAddress.address))
                .to.emit(capitalPool, "RiskManagerSet")
                .withArgs(riskManagerAddress.address);
        });

        it("should revert if a non-owner tries to set the RiskManager", async function () {
            const { capitalPool, nonOwner, riskManagerAddress } = await loadFixture(deployCapitalPoolFixture);

            // Expect revert due to Ownable's access control
            await expect(
                capitalPool.connect(nonOwner).setRiskManager(riskManagerAddress.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });

        it("should revert if setting the RiskManager to the zero address", async function () {
            const { capitalPool, owner } = await loadFixture(deployCapitalPoolFixture);

            // Expect revert with the custom ZeroAddress error
            await expect(
                capitalPool.connect(owner).setRiskManager(ethers.constants.AddressZero)
            ).to.be.revertedWithCustomError(capitalPool, "ZeroAddress");
        });

        it("should revert if the RiskManager address is already set", async function () {
            const { capitalPool, owner, riskManagerAddress } = await loadFixture(deployCapitalPoolFixture);

            // Set the address the first time (this should succeed)
            await capitalPool.connect(owner).setRiskManager(riskManagerAddress.address);
            
            // Try to set it again (this must fail)
            await expect(
                capitalPool.connect(owner).setRiskManager(riskManagerAddress.address)
            ).to.be.revertedWith("CP: RiskManager already set");
        });
    });
});



describe("CapitalPool - setBaseYieldAdapter", function () {
    // Fixture to deploy the CapitalPool and necessary mock contracts.
    async function deployCapitalPoolWithMocksFixture() {
        const [owner, nonOwner, eoaAddress] = await ethers.getSigners();

        // Deploy the underlying asset for the pool (e.g., USDC)
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const underlyingAsset = await MockERC20Factory.deploy("USD Coin", "USDC", 6);

        // Deploy the CapitalPool contract
        const CapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
        const capitalPool = await CapitalPoolFactory.deploy(owner.address, underlyingAsset.address);

        // Deploy a valid mock Yield Adapter
        const MockYieldAdapterFactory = await ethers.getContractFactory("MockYieldAdapter");
        const correctAdapter = await MockYieldAdapterFactory.deploy(
            underlyingAsset.address,
            ethers.constants.AddressZero,
            owner.address
        );

        // Deploy another valid mock Yield Adapter for update tests
        const anotherCorrectAdapter = await MockYieldAdapterFactory.deploy(
            underlyingAsset.address,
            ethers.constants.AddressZero,
            owner.address
        );
        
        // Deploy a mock token with a different address for mismatch tests
        const wrongAsset = await MockERC20Factory.deploy("Wrong Token", "W_TKN", 18);
        const wrongAssetAdapter = await MockYieldAdapterFactory.deploy(
            wrongAsset.address,
            ethers.constants.AddressZero,
            owner.address
        );

        return { capitalPool, owner, nonOwner, eoaAddress, correctAdapter, anotherCorrectAdapter, wrongAssetAdapter };
    }

    describe("Access Control", function () {
        it("should revert if a non-owner tries to set an adapter", async function () {
            const { capitalPool, nonOwner, correctAdapter } = await loadFixture(deployCapitalPoolWithMocksFixture);

            await expect(
                capitalPool.connect(nonOwner).setBaseYieldAdapter(YieldPlatform.AAVE, correctAdapter.address)
            ).to.be.revertedWith("Ownable: caller is not the owner");
        });
    });

    describe("Input Validation", function () {
        it("should revert if setting an adapter for the NONE platform", async function () {
            const { capitalPool, owner, correctAdapter } = await loadFixture(deployCapitalPoolWithMocksFixture);

            await expect(
                capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.NONE, correctAdapter.address)
            ).to.be.revertedWith("CP: Cannot set for NONE platform");
        });

        it("should revert if the adapter address is the zero address", async function () {
            const { capitalPool, owner } = await loadFixture(deployCapitalPoolWithMocksFixture);

            await expect(
                capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.AAVE, ethers.constants.AddressZero)
            ).to.be.revertedWithCustomError(capitalPool, "ZeroAddress");
        });

        it("should revert if the adapter address is not a contract", async function () {
            const { capitalPool, owner, eoaAddress } = await loadFixture(deployCapitalPoolWithMocksFixture);

            await expect(
                capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.AAVE, eoaAddress.address)
            ).to.be.revertedWith("CP: Adapter address is not a contract");
        });

        it("should revert if the adapter's asset does not match the pool's underlying asset", async function () {
            const { capitalPool, owner, wrongAssetAdapter } = await loadFixture(deployCapitalPoolWithMocksFixture);

            await expect(
                capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.AAVE, wrongAssetAdapter.address)
            ).to.be.revertedWith("CP: Adapter asset mismatch");
        });
    });

    describe("State Changes and Logic", function () {
        it("should successfully set a new adapter for a platform", async function () {
            const { capitalPool, owner, correctAdapter } = await loadFixture(deployCapitalPoolWithMocksFixture);

            await capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.AAVE, correctAdapter.address);

            // Check that the mapping is updated correctly
            const adapterAddress = await capitalPool.baseYieldAdapters(YieldPlatform.AAVE);
            expect(adapterAddress).to.equal(correctAdapter.address);
        });

        it("should add a new adapter address to the activeYieldAdapterAddresses array", async function () {
            const { capitalPool, owner, correctAdapter } = await loadFixture(deployCapitalPoolWithMocksFixture);
            
            await capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.AAVE, correctAdapter.address);

            // Check the active status and the array
            expect(await capitalPool.isAdapterActive(correctAdapter.address)).to.be.true;
            expect(await capitalPool.activeYieldAdapterAddresses(0)).to.equal(correctAdapter.address);
            // This is the only way to check array length without a getter
            await expect(capitalPool.activeYieldAdapterAddresses(1)).to.be.reverted;
        });

        it("should not add an existing adapter address to the active array twice", async function () {
            const { capitalPool, owner, correctAdapter } = await loadFixture(deployCapitalPoolWithMocksFixture);
            
            // Set for AAVE platform
            await capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.AAVE, correctAdapter.address);
            expect(await capitalPool.activeYieldAdapterAddresses(0)).to.equal(correctAdapter.address);
            
            // Set the SAME adapter for COMPOUND platform
            await capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.COMPOUND, correctAdapter.address);
            
            // The array should still only contain one entry
            await expect(capitalPool.activeYieldAdapterAddresses(1)).to.be.reverted;
        });

        it("should allow updating a platform to a new adapter and add it to the active list", async function () {
            const { capitalPool, owner, correctAdapter, anotherCorrectAdapter } = await loadFixture(deployCapitalPoolWithMocksFixture);
            
            // 1. Set AAVE to the first adapter
            await capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.AAVE, correctAdapter.address);
            expect(await capitalPool.baseYieldAdapters(YieldPlatform.AAVE)).to.equal(correctAdapter.address);

            // 2. Update AAVE to the second adapter
            await capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.AAVE, anotherCorrectAdapter.address);
            
            // Assert the platform now points to the new adapter
            expect(await capitalPool.baseYieldAdapters(YieldPlatform.AAVE)).to.equal(anotherCorrectAdapter.address);
            
            // Assert that BOTH adapters are now in the active array
            expect(await capitalPool.activeYieldAdapterAddresses(0)).to.equal(correctAdapter.address);
            expect(await capitalPool.activeYieldAdapterAddresses(1)).to.equal(anotherCorrectAdapter.address);
        });

        it("should emit a BaseYieldAdapterSet event on success", async function () {
            const { capitalPool, owner, correctAdapter } = await loadFixture(deployCapitalPoolWithMocksFixture);

            await expect(capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.COMPOUND, correctAdapter.address))
                .to.emit(capitalPool, "BaseYieldAdapterSet")
                .withArgs(YieldPlatform.COMPOUND, correctAdapter.address);
        });
    });
});


describe("CapitalPool - deposit", function () {
    // A fixture to set up the CapitalPool with a configured adapter and a funded user.
    async function deployAndConfigureFixture() {
        const [owner, depositor, riskManager, otherUser] = await ethers.getSigners();

        // Deploy Mocks
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const underlyingAsset = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
        const MockYieldAdapterFactory = await ethers.getContractFactory("MockYieldAdapter");
        const yieldAdapter = await MockYieldAdapterFactory.deploy(
            underlyingAsset.address,
            ethers.constants.AddressZero,
            owner.address
        );
        const MockRiskManagerFactory = await ethers.getContractFactory("MockRiskManager");
        const mockRiskManager = await MockRiskManagerFactory.deploy();

        // Deploy CapitalPool
        const CapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
        const capitalPool = await CapitalPoolFactory.deploy(owner.address, underlyingAsset.address);

        // Configure CapitalPool
        await capitalPool.connect(owner).setRiskManager(mockRiskManager.address);
        await capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.AAVE, yieldAdapter.address);
        await yieldAdapter.connect(owner).setDepositor(capitalPool.address);

        // Fund user and approve the CapitalPool to spend their tokens
        const depositAmount = ethers.utils.parseUnits("10000", 6); // 10,000 USDC
        await underlyingAsset.mint(depositor.address, depositAmount);
        await underlyingAsset.connect(depositor).approve(capitalPool.address, depositAmount);

        return { capitalPool, owner, depositor, otherUser, underlyingAsset, yieldAdapter, depositAmount };
    }

    describe("Validation and Revert Scenarios", function () {
        it("should revert if the deposit amount is zero", async function () {
            const { capitalPool, depositor } = await loadFixture(deployAndConfigureFixture);
            await expect(capitalPool.connect(depositor).deposit(0, YieldPlatform.AAVE))
                .to.be.revertedWithCustomError(capitalPool, "InvalidAmount");
        });

        it("should revert if the yield choice is NONE", async function () {
            const { capitalPool, depositor, depositAmount } = await loadFixture(deployAndConfigureFixture);
            await expect(capitalPool.connect(depositor).deposit(depositAmount, YieldPlatform.NONE))
                .to.be.revertedWithCustomError(capitalPool, "AdapterNotConfigured");
        });

        it("should revert if the chosen adapter is not configured", async function () {
            const { capitalPool, depositor, depositAmount } = await loadFixture(deployAndConfigureFixture);
            const UnconfiguredPlatform = 3; // An enum value not set
            await expect(capitalPool.connect(depositor).deposit(depositAmount, UnconfiguredPlatform))
                .to.be.revertedWithCustomError(capitalPool, "AdapterNotConfigured");
        });

        it("should revert if the user already has an active deposit", async function () {
            const { capitalPool, depositor, depositAmount } = await loadFixture(deployAndConfigureFixture);
            await capitalPool.connect(depositor).deposit(depositAmount, YieldPlatform.AAVE);
            // Try to deposit again
            await expect(capitalPool.connect(depositor).deposit(1, YieldPlatform.AAVE))
                .to.be.revertedWith("CP: Must withdraw fully before new deposit");
        });

        it("should revert if the calculated shares to mint is zero", async function () {
            const { capitalPool, depositor, depositAmount, otherUser, underlyingAsset } = await loadFixture(deployAndConfigureFixture);
            // First user deposits a large amount, setting a high NAV
            await capitalPool.connect(depositor).deposit(depositAmount, YieldPlatform.AAVE);

            // A second user tries to deposit a tiny amount (1 wei)
            await underlyingAsset.mint(otherUser.address, 1);
            await underlyingAsset.connect(otherUser).approve(capitalPool.address, 1);
            
            // This deposit is too small to mint any shares and should be rejected
            await expect(capitalPool.connect(otherUser).deposit(1, YieldPlatform.AAVE))
                .to.be.revertedWithCustomError(capitalPool, "NoSharesToMint");
        });
    });

    describe("Share Calculation", function () {
        it("should mint shares 1:1 for the very first deposit", async function () {
            const { capitalPool, depositor, depositAmount } = await loadFixture(deployAndConfigureFixture);
            
            await expect(capitalPool.connect(depositor).deposit(depositAmount, YieldPlatform.AAVE))
                .to.emit(capitalPool, "Deposit")
                .withArgs(depositor.address, depositAmount, depositAmount, YieldPlatform.AAVE); // amount == sharesMinted
        });

        it("should mint shares based on NAV for subsequent deposits", async function () {
            const { capitalPool, depositor, depositAmount, otherUser, underlyingAsset } = await loadFixture(deployAndConfigureFixture);
            
            // First deposit
            await capitalPool.connect(depositor).deposit(depositAmount, YieldPlatform.AAVE);
            
            // Simulate yield gain by just increasing the system value
            const yieldGain = ethers.utils.parseUnits("2000", 6); // 2,000 USDC of yield
            await yieldAdapter.connect(owner).setTotalValueHeld(depositAmount.add(yieldGain));
            await capitalPool.connect(owner).syncYieldAndAdjustSystemValue();

            // Second depositor (otherUser) deposits the same amount
            const secondDepositAmount = depositAmount;
            await underlyingAsset.mint(otherUser.address, secondDepositAmount);
            await underlyingAsset.connect(otherUser).approve(capitalPool.address, secondDepositAmount);

            // Calculate expected shares: (amount * totalShares) / totalValue
            const expectedShares = secondDepositAmount.mul(depositAmount).div(depositAmount.add(yieldGain));

            await expect(capitalPool.connect(otherUser).deposit(secondDepositAmount, YieldPlatform.AAVE))
                .to.emit(capitalPool, "Deposit")
                .withArgs(otherUser.address, secondDepositAmount, expectedShares, YieldPlatform.AAVE);
        });
    });

    describe("Successful Deposit (Happy Path)", function () {
        it("should correctly update user account and system-wide state", async function () {
            const { capitalPool, depositor, depositAmount } = await loadFixture(deployAndConfigureFixture);
            
            await capitalPool.connect(depositor).deposit(depositAmount, YieldPlatform.AAVE);

            // Check user account state
            const account = await capitalPool.getUnderwriterAccount(depositor.address);
            expect(account.totalDepositedAssetPrincipal).to.equal(depositAmount);
            expect(account.yieldChoice).to.equal(YieldPlatform.AAVE);
            expect(account.masterShares).to.equal(depositAmount);

            // Check system-wide state
            expect(await capitalPool.totalMasterSharesSystem()).to.equal(depositAmount);
            expect(await capitalPool.totalSystemValue()).to.equal(depositAmount);
        });

        it("should perform all required external interactions", async function () {
            const { capitalPool, depositor, underlyingAsset, yieldAdapter, depositAmount } = await loadFixture(deployAndConfigureFixture);
            
            // Check token transfer from user
            await expect(() => capitalPool.connect(depositor).deposit(depositAmount, YieldPlatform.AAVE))
                .to.changeTokenBalance(underlyingAsset, depositor, depositAmount.mul(-1));
            
            // Check that the yield adapter's deposit function was called
            // This requires an event emitter in the mock adapter for verification
            await expect(capitalPool.connect(depositor).deposit(depositAmount, YieldPlatform.AAVE))
                .to.emit(yieldAdapter, "Deposited").withArgs(depositAmount);
        });
    });
});


describe("CapitalPool - requestWithdrawal", function () {
    // A fixture to set up the CapitalPool with a user who has an active deposit.
    async function deployAndDepositFixture() {
        const [owner, depositor, otherUser] = await ethers.getSigners();

        // Deploy Mocks
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const underlyingAsset = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
        const MockYieldAdapterFactory = await ethers.getContractFactory("MockYieldAdapter");
        const yieldAdapter = await MockYieldAdapterFactory.deploy(
            underlyingAsset.address,
            ethers.constants.AddressZero,
            owner.address
        );
        const MockRiskManagerFactory = await ethers.getContractFactory("MockRiskManager");
        const mockRiskManager = await MockRiskManagerFactory.deploy();
        
        // Deploy CapitalPool and configure it
        const CapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
        const capitalPool = await CapitalPoolFactory.deploy(owner.address, underlyingAsset.address);
        await capitalPool.connect(owner).setRiskManager(mockRiskManager.address);
        await capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.AAVE, yieldAdapter.address);
        await yieldAdapter.connect(owner).setDepositor(capitalPool.address);
        
        // Fund user and make a deposit
        const depositAmount = ethers.utils.parseUnits("10000", 6);
        await underlyingAsset.mint(depositor.address, depositAmount);
        await underlyingAsset.connect(depositor).approve(capitalPool.address, depositAmount);
        await capitalPool.connect(depositor).deposit(depositAmount, YieldPlatform.AAVE);
        
        // In the first deposit, shares minted = amount deposited
        const sharesOwned = depositAmount;

        return { capitalPool, depositor, otherUser, mockRiskManager, sharesOwned, owner, yieldAdapter };
    }

    describe("Validation and Revert Scenarios", function () {
        it("should revert if attempting to burn zero shares", async function () {
            const { capitalPool, depositor } = await loadFixture(deployAndDepositFixture);
            await expect(capitalPool.connect(depositor).requestWithdrawal(0))
                .to.be.revertedWithCustomError(capitalPool, "InvalidAmount");
        });

        it("should revert if attempting to burn more shares than owned", async function () {
            const { capitalPool, depositor, sharesOwned } = await loadFixture(deployAndDepositFixture);
            const sharesToBurn = sharesOwned.add(1);
            await expect(capitalPool.connect(depositor).requestWithdrawal(sharesToBurn))
                .to.be.revertedWithCustomError(capitalPool, "InsufficientShares");
        });

        it("should revert if a withdrawal request is already pending", async function () {
            const { capitalPool, depositor, sharesOwned } = await loadFixture(deployAndDepositFixture);
            const sharesToBurn = sharesOwned.div(2);
            await capitalPool.connect(depositor).requestWithdrawal(sharesToBurn); // First request
            // Second request should fail
            await expect(capitalPool.connect(depositor).requestWithdrawal(1))
                .to.be.revertedWithCustomError(capitalPool, "WithdrawalRequestPending");
        });
    });

    describe("Interaction with RiskManager", function () {
        it("should revert if the RiskManager rejects the withdrawal request", async function () {
            const { capitalPool, depositor, mockRiskManager, sharesOwned } = await loadFixture(deployAndDepositFixture);
            
            // Configure the mock RiskManager to reject requests
            await mockRiskManager.setShouldReject(true);

            await expect(capitalPool.connect(depositor).requestWithdrawal(sharesOwned))
                .to.be.revertedWith("CP: RiskManager rejected withdrawal request");
        });
    });
    
    describe("Successful Request (Happy Path)", function () {
        it("should update the user's account with the request details", async function () {
            const { capitalPool, depositor, sharesOwned } = await loadFixture(deployAndDepositFixture);
            const sharesToBurn = sharesOwned.div(4); // Request to withdraw 25% of shares
            
            const tx = await capitalPool.connect(depositor).requestWithdrawal(sharesToBurn);
            const blockTimestamp = (await ethers.provider.getBlock(tx.blockNumber)).timestamp;

            const account = await capitalPool.getUnderwriterAccount(depositor.address);
            expect(account.withdrawalRequestShares).to.equal(sharesToBurn);
            expect(account.withdrawalRequestTimestamp).to.equal(blockTimestamp);
        });

        it("should emit a WithdrawalRequested event with correct arguments", async function () {
            const { capitalPool, depositor, sharesOwned } = await loadFixture(deployAndDepositFixture);
            const sharesToBurn = ethers.utils.parseUnits("1000", 6);
            
            const tx = await capitalPool.connect(depositor).requestWithdrawal(sharesToBurn);
            const blockTimestamp = (await ethers.provider.getBlock(tx.blockNumber)).timestamp;

            await expect(tx)
                .to.emit(capitalPool, "WithdrawalRequested")
                .withArgs(depositor.address, sharesToBurn, blockTimestamp);
        });
    });
});


describe("CapitalPool - executeWithdrawal", function () {
    // A fixture that sets up a pending withdrawal request.
    async function deployAndRequestWithdrawalFixture() {
        const [owner, depositor, otherUser] = await ethers.getSigners();

        // Deploy Mocks
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const underlyingAsset = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
        const MockYieldAdapterFactory = await ethers.getContractFactory("MockYieldAdapter");
        const yieldAdapter = await MockYieldAdapterFactory.deploy(
            underlyingAsset.address,
            ethers.constants.AddressZero,
            owner.address
        );
        const MockRiskManagerFactory = await ethers.getContractFactory("MockRiskManager");
        const mockRiskManager = await MockRiskManagerFactory.deploy();
        
        // Deploy and Configure CapitalPool
        const CapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
        const capitalPool = await CapitalPoolFactory.deploy(owner.address, underlyingAsset.address);
        await capitalPool.connect(owner).setRiskManager(mockRiskManager.address);
        await capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.AAVE, yieldAdapter.address);
        await yieldAdapter.connect(owner).setDepositor(capitalPool.address);
        
        // Fund depositor, approve, and deposit
        const depositAmount = ethers.utils.parseUnits("10000", 6);
        await underlyingAsset.mint(depositor.address, depositAmount);
        await underlyingAsset.connect(depositor).approve(capitalPool.address, depositAmount);
        await capitalPool.connect(depositor).deposit(depositAmount, YieldPlatform.AAVE);
        
        // Make the withdrawal request
        const sharesToBurn = ethers.utils.parseUnits("4000", 6); // Request to burn 40% of shares
        await capitalPool.connect(depositor).requestWithdrawal(sharesToBurn);

        // Pre-fund the mock adapter so it can handle withdrawals
        await underlyingAsset.mint(yieldAdapter.address, ethers.utils.parseUnits("100000", 6));
        
        const NOTICE_PERIOD = await capitalPool.UNDERWRITER_NOTICE_PERIOD();

        return { capitalPool, depositor, mockRiskManager, yieldAdapter, underlyingAsset, sharesToBurn, depositAmount, NOTICE_PERIOD };
    }

    describe("Validation and Revert Scenarios", function () {
        it("should revert if no withdrawal has been requested", async function () {
            const { capitalPool, otherUser } = await loadFixture(deployAndRequestWithdrawalFixture);
            await expect(capitalPool.connect(otherUser).executeWithdrawal())
                .to.be.revertedWithCustomError(capitalPool, "NoWithdrawalRequest");
        });

        it("should revert if the notice period is still active", async function () {
            const { capitalPool, depositor, NOTICE_PERIOD } = await loadFixture(deployAndRequestWithdrawalFixture);
            // Advance time, but not enough to pass the notice period
            await time.increase(NOTICE_PERIOD.sub(5));
            await expect(capitalPool.connect(depositor).executeWithdrawal())
                .to.be.revertedWithCustomError(capitalPool, "NoticePeriodActive");
        });

        it("should revert if shares decreased since request (inconsistent state)", async function () {
            const { capitalPool, depositor, NOTICE_PERIOD } = await loadFixture(deployAndRequestWithdrawalFixture);
            
            // Manually burn some shares to simulate a loss after the request
            await capitalPool.mock_burnShares(depositor.address, ethers.utils.parseUnits("7000", 6));

            await time.increase(NOTICE_PERIOD.add(1));
            await expect(capitalPool.connect(depositor).executeWithdrawal())
                .to.be.revertedWithCustomError(capitalPool, "InconsistentState");
        });
    });

    describe("Withdrawal Logic and State Changes", function () {
        it("should execute a partial withdrawal correctly", async function () {
            const { capitalPool, depositor, sharesToBurn, depositAmount, NOTICE_PERIOD } = await loadFixture(deployAndRequestWithdrawalFixture);
            
            await time.increase(NOTICE_PERIOD.add(1));
            await capitalPool.connect(depositor).executeWithdrawal();

            const account = await capitalPool.getUnderwriterAccount(depositor.address);

            // Request should be cleared
            expect(account.withdrawalRequestShares).to.equal(0);
            expect(account.withdrawalRequestTimestamp).to.equal(0);
            
            // Principal and shares should be reduced
            const expectedPrincipal = ethers.utils.parseUnits("6000", 6);
            const expectedShares = depositAmount.sub(sharesToBurn);
            expect(account.totalDepositedAssetPrincipal).to.equal(expectedPrincipal);
            expect(account.masterShares).to.equal(expectedShares);
        });

        it("should execute a full withdrawal and delete the user's account", async function () {
            const { capitalPool, depositor, depositAmount, NOTICE_PERIOD } = await loadFixture(deployAndRequestWithdrawalFixture);
            
            // Make a new request for the full amount of shares
            await capitalPool.connect(depositor).cancelWithdrawalRequest(); // Assuming a cancel function exists
            await capitalPool.connect(depositor).requestWithdrawal(depositAmount);

            await time.increase(NOTICE_PERIOD.add(1));
            await capitalPool.connect(depositor).executeWithdrawal();

            // Account should be deleted, so all values are zero
            const account = await capitalPool.getUnderwriterAccount(depositor.address);
            expect(account.totalDepositedAssetPrincipal).to.equal(0);
            expect(account.masterShares).to.equal(0);
        });

        it("should pay out a share of yield if NAV has increased", async function() {
            const { capitalPool, depositor, sharesToBurn, depositAmount, underlyingAsset, NOTICE_PERIOD } = await loadFixture(deployAndRequestWithdrawalFixture);

            // Simulate a 10% yield gain on the total system value
            const yieldGain = depositAmount.div(10);
            await yieldAdapter.connect(owner).setTotalValueHeld(depositAmount.add(yieldGain));
            await capitalPool.connect(owner).syncYieldAndAdjustSystemValue();

            await time.increase(NOTICE_PERIOD.add(1));

            // Calculate expected payout: 40% of shares should get 40% of the value (4k principal + 400 yield)
            const expectedPayout = ethers.utils.parseUnits("4400", 6);
            
            await expect(() => capitalPool.connect(depositor).executeWithdrawal())
                .to.changeTokenBalance(underlyingAsset, depositor, expectedPayout);
        });
    });

    describe("External Interactions and Events", function () {
        it("should call the RiskManager with the correct principal and isFullWithdrawal=false", async function() {
            const { capitalPool, depositor, mockRiskManager, sharesToBurn, NOTICE_PERIOD } = await loadFixture(deployAndRequestWithdrawalFixture);
            await time.increase(NOTICE_PERIOD.add(1));

            const expectedPrincipalRemoved = ethers.utils.parseUnits("4000", 6);
            
            await expect(capitalPool.connect(depositor).executeWithdrawal())
                .to.emit(mockRiskManager, "CapitalWithdrawn") // Mock event
                .withArgs(depositor.address, expectedPrincipalRemoved, false);
        });

        it("should call the RiskManager with isFullWithdrawal=true", async function() {
            const { capitalPool, depositor, mockRiskManager, depositAmount, NOTICE_PERIOD } = await loadFixture(deployAndRequestWithdrawalFixture);
            await capitalPool.connect(depositor).cancelWithdrawalRequest();
            await capitalPool.connect(depositor).requestWithdrawal(depositAmount); // Full amount
            await time.increase(NOTICE_PERIOD.add(1));

            await expect(capitalPool.connect(depositor).executeWithdrawal())
                .to.emit(mockRiskManager, "CapitalWithdrawn") // Mock event
                .withArgs(depositor.address, depositAmount, true);
        });

        it("should emit a WithdrawalExecuted event", async function() {
            const { capitalPool, depositor, sharesToBurn, NOTICE_PERIOD } = await loadFixture(deployAndRequestWithdrawalFixture);
            await time.increase(NOTICE_PERIOD.add(1));
            
            const expectedAssetsReceived = ethers.utils.parseUnits("4000", 6);

            await expect(capitalPool.connect(depositor).executeWithdrawal())
                .to.emit(capitalPool, "WithdrawalExecuted")
                .withArgs(depositor.address, expectedAssetsReceived, sharesToBurn);
        });
    });
});



describe("CapitalPool - applyLosses", function () {
    // A fixture to set up the CapitalPool with multiple active depositors.
    async function deployAndDepositFixture() {
        const [owner, riskManager, underwriter1, underwriter2] = await ethers.getSigners();

        // Deploy Mocks & CapitalPool
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const underlyingAsset = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
        const MockYieldAdapterFactory = await ethers.getContractFactory("MockYieldAdapter");
        const yieldAdapter = await MockYieldAdapterFactory.deploy(
            underlyingAsset.address,
            ethers.constants.AddressZero,
            owner.address
        );
        const CapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
        const capitalPool = await CapitalPoolFactory.deploy(owner.address, underlyingAsset.address);

        // Configure CapitalPool
        await capitalPool.connect(owner).setRiskManager(riskManager.address);
        await capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.AAVE, yieldAdapter.address);
        await yieldAdapter.connect(owner).setDepositor(capitalPool.address);
        
        // Fund and deposit for Underwriter 1
        const u1Deposit = ethers.utils.parseUnits("10000", 6);
        await underlyingAsset.mint(underwriter1.address, u1Deposit);
        await underlyingAsset.connect(underwriter1).approve(capitalPool.address, u1Deposit);
        await capitalPool.connect(underwriter1).deposit(u1Deposit, YieldPlatform.AAVE);
        
        // Fund and deposit for Underwriter 2
        const u2Deposit = ethers.utils.parseUnits("20000", 6);
        await underlyingAsset.mint(underwriter2.address, u2Deposit);
        await underlyingAsset.connect(underwriter2).approve(capitalPool.address, u2Deposit);
        await capitalPool.connect(underwriter2).deposit(u2Deposit, YieldPlatform.AAVE);

        // Helper function to execute calls as the RiskManager
        async function asRiskManager(fn) {
            return fn(riskManager);
        }

        return { capitalPool, riskManager, underwriter1, underwriter2, u1Deposit, u2Deposit, asRiskManager };
    }

    describe("Access Control and Validation", function () {
        it("should revert if called by any address other than the RiskManager", async function () {
            const { capitalPool, owner, underwriter1 } = await loadFixture(deployAndDepositFixture);
            await expect(capitalPool.connect(owner).applyLosses(underwriter1.address, 100))
                .to.be.revertedWith("CP: Caller is not the RiskManager");
        });

        it("should revert if the loss amount is zero", async function () {
            const { capitalPool, asRiskManager, underwriter1 } = await loadFixture(deployAndDepositFixture);
            await expect(asRiskManager(signer => capitalPool.connect(signer).applyLosses(underwriter1.address, 0)))
                .to.be.revertedWithCustomError(capitalPool, "InvalidAmount");
        });

        it("should revert for an underwriter with no active deposit", async function () {
            const { capitalPool, asRiskManager } = await loadFixture(deployAndDepositFixture);
            const [_, __, ___, noDepositUser] = await ethers.getSigners();
            await expect(asRiskManager(signer => capitalPool.connect(signer).applyLosses(noDepositUser.address, 100)))
                .to.be.revertedWithCustomError(capitalPool, "NoActiveDeposit");
        });
    });

    describe("Loss Application Scenarios", function () {
        it("should correctly apply a partial loss to an underwriter", async function () {
            const { capitalPool, asRiskManager, underwriter1, u1Deposit } = await loadFixture(deployAndDepositFixture);
            const lossAmount = ethers.utils.parseUnits("4000", 6);
            
            const initialSystemValue = await capitalPool.totalSystemValue();
            
            await asRiskManager(signer => capitalPool.connect(signer).applyLosses(underwriter1.address, lossAmount));

            // Check underwriter's principal is reduced
            const account = await capitalPool.getUnderwriterAccount(underwriter1.address);
            expect(account.totalDepositedAssetPrincipal).to.equal(u1Deposit.sub(lossAmount));
            
            // Check their shares remain unchanged
            expect(account.masterShares).to.equal(u1Deposit);
            
            // Check total system value is reduced
            expect(await capitalPool.totalSystemValue()).to.equal(initialSystemValue.sub(lossAmount));
        });

        it("should correctly apply a full loss (wipeout) and delete the account", async function() {
            const { capitalPool, asRiskManager, underwriter1, u1Deposit } = await loadFixture(deployAndDepositFixture);
            
            const initialSystemValue = await capitalPool.totalSystemValue();
            const initialTotalShares = await capitalPool.totalMasterSharesSystem();
            
            // Apply a loss equal to their entire principal
            await asRiskManager(signer => capitalPool.connect(signer).applyLosses(underwriter1.address, u1Deposit));
            
            // Account should be deleted (all fields are zero)
            const account = await capitalPool.getUnderwriterAccount(underwriter1.address);
            expect(account.totalDepositedAssetPrincipal).to.equal(0);
            expect(account.masterShares).to.equal(0);
            
            // Check that total system value and shares are reduced
            expect(await capitalPool.totalSystemValue()).to.equal(initialSystemValue.sub(u1Deposit));
            expect(await capitalPool.totalMasterSharesSystem()).to.equal(initialTotalShares.sub(u1Deposit));
        });
        
        it("should cap the loss at the underwriter's principal if loss amount is greater", async function() {
            const { capitalPool, asRiskManager, underwriter1, u1Deposit } = await loadFixture(deployAndDepositFixture);
            const excessiveLoss = u1Deposit.add(ethers.utils.parseUnits("5000", 6));

            // The actual loss applied should be capped at u1Deposit
            await expect(
                asRiskManager(signer => capitalPool.connect(signer).applyLosses(underwriter1.address, excessiveLoss))
            ).to.emit(capitalPool, "LossesApplied").withArgs(underwriter1.address, u1Deposit, true); // actualLoss = u1Deposit
        });
    });
    
    describe("State and Event Correctness", function () {
        it("should not affect other underwriters when applying a loss to one", async function() {
            const { capitalPool, asRiskManager, underwriter1, underwriter2, u2Deposit } = await loadFixture(deployAndDepositFixture);
            const lossAmount = ethers.utils.parseUnits("1000", 6);

            // Get U2's state before the loss is applied to U1
            const u2Account_before = await capitalPool.getUnderwriterAccount(underwriter2.address);

            // Apply loss to U1
            await asRiskManager(signer => capitalPool.connect(signer).applyLosses(underwriter1.address, lossAmount));
            
            // Get U2's state after
            const u2Account_after = await capitalPool.getUnderwriterAccount(underwriter2.address);
            
            // Assert U2's account is completely unchanged
            expect(u2Account_after.totalDepositedAssetPrincipal).to.equal(u2Account_before.totalDepositedAssetPrincipal);
            expect(u2Account_after.masterShares).to.equal(u2Account_before.masterShares);
        });

        it("should emit a LossesApplied event with wipedOut=false for a partial loss", async function() {
            const { capitalPool, asRiskManager, underwriter1 } = await loadFixture(deployAndDepositFixture);
            const lossAmount = ethers.utils.parseUnits("1", 6);

            await expect(
                asRiskManager(signer => capitalPool.connect(signer).applyLosses(underwriter1.address, lossAmount))
            ).to.emit(capitalPool, "LossesApplied").withArgs(underwriter1.address, lossAmount, false);
        });

        it("should emit a LossesApplied event with wipedOut=true for a full loss", async function() {
            const { capitalPool, asRiskManager, underwriter1, u1Deposit } = await loadFixture(deployAndDepositFixture);

            await expect(
                asRiskManager(signer => capitalPool.connect(signer).applyLosses(underwriter1.address, u1Deposit))
            ).to.emit(capitalPool, "LossesApplied").withArgs(underwriter1.address, u1Deposit, true);
        });
    });
});



describe("CapitalPool - syncYieldAndAdjustSystemValue", function () {

    // A fixture to set up the CapitalPool with multiple configured adapters.
    async function deployWithAdaptersFixture() {
        const [owner, depositor1, depositor2, keeper] = await ethers.getSigners();

        // --- Deploy Mocks & CapitalPool ---
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const underlyingAsset = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
        
        const MockYieldAdapterFactory = await ethers.getContractFactory("MockYieldAdapter");
        const aaveAdapter = await MockYieldAdapterFactory.deploy(
            underlyingAsset.address,
            ethers.constants.AddressZero,
            owner.address
        );
        const compoundAdapter = await MockYieldAdapterFactory.deploy(
            underlyingAsset.address,
            ethers.constants.AddressZero,
            owner.address
        );
        
        const CapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
        const capitalPool = await CapitalPoolFactory.deploy(owner.address, underlyingAsset.address);
        
        // --- Configure CapitalPool ---
        await capitalPool.connect(owner).setRiskManager(ethers.constants.AddressZero); // Mock address
        await capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.AAVE, aaveAdapter.address);
        await capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.COMPOUND, compoundAdapter.address);
        await aaveAdapter.connect(owner).setDepositor(capitalPool.address);
        await compoundAdapter.connect(owner).setDepositor(capitalPool.address);
        
        // --- Simulate Deposits into both adapters ---
        // Deposit 1: 10k into AAVE
        const d1Amount = ethers.utils.parseUnits("10000", 6);
        await underlyingAsset.mint(depositor1.address, d1Amount);
        await underlyingAsset.connect(depositor1).approve(capitalPool.address, d1Amount);
        await capitalPool.connect(depositor1).deposit(d1Amount, YieldPlatform.AAVE);
        
        // Deposit 2: 20k into COMPOUND
        const d2Amount = ethers.utils.parseUnits("20000", 6);
        await underlyingAsset.mint(depositor2.address, d2Amount);
        await underlyingAsset.connect(depositor2).approve(capitalPool.address, d2Amount);
        await capitalPool.connect(depositor2).deposit(d2Amount, YieldPlatform.COMPOUND);

        return { capitalPool, keeper, underlyingAsset, aaveAdapter, compoundAdapter, d1Amount, d2Amount };
    }

    describe("NAV Calculation and State Changes", function () {
        it("should correctly sum values from multiple adapters and liquid assets", async function () {
            const { capitalPool, keeper, underlyingAsset, aaveAdapter, compoundAdapter, d1Amount, d2Amount } = await loadFixture(deployWithAdaptersFixture);
            
            const oldSystemValue = await capitalPool.totalSystemValue();
            
            // Simulate yield gain in each adapter and a liquid balance in the pool
            const aaveYield = ethers.utils.parseUnits("500", 6);
            const compoundYield = ethers.utils.parseUnits("1200", 6);
            const liquidAmount = ethers.utils.parseUnits("100", 6);
            
            await aaveAdapter.mock_setCurrentValueHeld(d1Amount.add(aaveYield));
            await compoundAdapter.mock_setCurrentValueHeld(d2Amount.add(compoundYield));
            await underlyingAsset.mint(capitalPool.address, liquidAmount);
            
            const expectedNewValue = d1Amount.add(aaveYield).add(d2Amount).add(compoundYield).add(liquidAmount);

            const tx = await capitalPool.connect(keeper).syncYieldAndAdjustSystemValue();

            // Check the state and the event
            expect(await capitalPool.totalSystemValue()).to.equal(expectedNewValue);
            await expect(tx).to.emit(capitalPool, "SystemValueSynced").withArgs(expectedNewValue, oldSystemValue);
        });

        it("should set totalSystemValue to 0 if all shares have been withdrawn", async function() {
            const { capitalPool, keeper, aaveAdapter } = await loadFixture(deployWithAdaptersFixture);

            // Simulate all users withdrawing, leaving 0 shares
            await capitalPool.mock_setTotalMasterShares(0);
            
            // Simulate dust or residual value left in an adapter
            await aaveAdapter.mock_setCurrentValueHeld(100);

            await capitalPool.connect(keeper).syncYieldAndAdjustSystemValue();

            // The safety check should force the value to 0
            expect(await capitalPool.totalSystemValue()).to.equal(0);
        });
    });

    describe("Exception Handling", function () {
        it("should successfully sync and emit event even if one adapter reverts", async function () {
            const { capitalPool, keeper, aaveAdapter, compoundAdapter, d2Amount } = await loadFixture(deployWithAdaptersFixture);
            
            // Configure one adapter to fail, the other to succeed
            await aaveAdapter.mock_setRevert(true, "Adapter Offline");
            const compoundYield = ethers.utils.parseUnits("1000", 6);
            await compoundAdapter.mock_setCurrentValueHeld(d2Amount.add(compoundYield));

            const tx = await capitalPool.connect(keeper).syncYieldAndAdjustSystemValue();

            // Check that the correct failure event was emitted for the failing adapter
            await expect(tx).to.emit(capitalPool, "AdapterCallFailed")
                .withArgs(aaveAdapter.address, "getCurrentValueHeld", "Adapter Offline");
            
            // Check that the system value reflects ONLY the value from the successful adapter
            const expectedValue = d2Amount.add(compoundYield);
            expect(await capitalPool.totalSystemValue()).to.equal(expectedValue);
        });
        
        it("should handle reverts without a reason string", async function() {
            const { capitalPool, keeper, aaveAdapter } = await loadFixture(deployWithAdaptersFixture);
            
            // Configure adapter to revert without a message
            await aaveAdapter.mock_setRevertWithoutReason(true);
            
            const tx = await capitalPool.connect(keeper).syncYieldAndAdjustSystemValue();
            
            await expect(tx).to.emit(capitalPool, "AdapterCallFailed")
                .withArgs(aaveAdapter.address, "getCurrentValueHeld", "Unknown error");
        });
    });

    describe("Security", function() {
        it("should prevent reentrancy attacks", async function() {
            const { capitalPool } = await loadFixture(deployWithAdaptersFixture);
            const AttackerFactory = await ethers.getContractFactory("ReentrancyAttacker");
            const attacker = await AttackerFactory.deploy(capitalPool.address);
            
            // For this test, we would need a malicious adapter that makes a re-entrant call.
            // The test below demonstrates the guard itself works as expected.
            await expect(attacker.beginSyncAttack())
                .to.be.revertedWith("ReentrancyGuard: reentrant call");
        });
    });
});



describe("CapitalPool - View Functions", function () {
    // A fixture to set up the CapitalPool with an active deposit and a known state.
    async function deployAndDepositFixture() {
        const [owner, depositor, nonDepositor] = await ethers.getSigners();

        // Deploy Mocks & CapitalPool
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        const underlyingAsset = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
        const MockYieldAdapterFactory = await ethers.getContractFactory("MockYieldAdapter");
        const yieldAdapter = await MockYieldAdapterFactory.deploy(
            underlyingAsset.address,
            ethers.constants.AddressZero,
            owner.address
        );
        const CapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
        const capitalPool = await CapitalPoolFactory.deploy(owner.address, underlyingAsset.address);

        // Configure CapitalPool
        await capitalPool.connect(owner).setRiskManager(ethers.constants.AddressZero);
        await capitalPool.connect(owner).setBaseYieldAdapter(YieldPlatform.AAVE, yieldAdapter.address);
        await yieldAdapter.connect(owner).setDepositor(capitalPool.address);
        
        // Fund and deposit for the depositor
        const depositAmount = ethers.utils.parseUnits("10000", 6); // 10,000 USDC
        await underlyingAsset.mint(depositor.address, depositAmount);
        await underlyingAsset.connect(depositor).approve(capitalPool.address, depositAmount);
        await capitalPool.connect(depositor).deposit(depositAmount, YieldPlatform.AAVE);
        
        const sharesOwned = depositAmount; // 1:1 on first deposit

        return { capitalPool, depositor, nonDepositor, depositAmount, sharesOwned, owner, yieldAdapter };
    }

    describe("getUnderwriterAccount", function () {
        it("should return all zero values for an account that has not deposited", async function () {
            const { capitalPool, nonDepositor } = await loadFixture(deployAndDepositFixture);
            const account = await capitalPool.getUnderwriterAccount(nonDepositor.address);

            expect(account.totalDepositedAssetPrincipal).to.equal(0);
            expect(account.yieldChoice).to.equal(YieldPlatform.NONE);
            expect(account.masterShares).to.equal(0);
            expect(account.withdrawalRequestTimestamp).to.equal(0);
            expect(account.withdrawalRequestShares).to.equal(0);
        });

        it("should return the correct details for an account with an active deposit", async function () {
            const { capitalPool, depositor, depositAmount, sharesOwned } = await loadFixture(deployAndDepositFixture);
            const account = await capitalPool.getUnderwriterAccount(depositor.address);

            expect(account.totalDepositedAssetPrincipal).to.equal(depositAmount);
            expect(account.yieldChoice).to.equal(YieldPlatform.AAVE);
            expect(account.masterShares).to.equal(sharesOwned);
            expect(account.withdrawalRequestTimestamp).to.equal(0);
            expect(account.withdrawalRequestShares).to.equal(0);
        });

        it("should return correct details for an account with a pending withdrawal request", async function () {
            const { capitalPool, depositor } = await loadFixture(deployAndDepositFixture);
            const sharesToRequest = ethers.utils.parseUnits("2000", 6);
            
            const tx = await capitalPool.connect(depositor).requestWithdrawal(sharesToRequest);
            const blockTimestamp = (await ethers.provider.getBlock(tx.blockNumber)).timestamp;

            const account = await capitalPool.getUnderwriterAccount(depositor.address);
            expect(account.withdrawalRequestShares).to.equal(sharesToRequest);
            expect(account.withdrawalRequestTimestamp).to.equal(blockTimestamp);
        });
    });

    describe("sharesToValue", function () {
        it("should return 0 if total shares in the system is 0", async function () {
            const { owner, underlyingAsset } = await loadFixture(deployAndDepositFixture);
            // Deploy a fresh contract with no deposits
            const CapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
            const newPool = await CapitalPoolFactory.deploy(owner.address, underlyingAsset.address);
            
            expect(await newPool.sharesToValue(100)).to.equal(0);
        });

        it("should return 0 if the input shares amount is 0", async function () {
            const { capitalPool } = await loadFixture(deployAndDepositFixture);
            expect(await capitalPool.sharesToValue(0)).to.equal(0);
        });

        it("should return value 1:1 with shares when NAV is 1", async function () {
            const { capitalPool } = await loadFixture(deployAndDepositFixture);
            const shares = ethers.utils.parseUnits("5000", 6);
            expect(await capitalPool.sharesToValue(shares)).to.equal(shares);
        });

        it("should return a higher value for the same shares when NAV increases", async function() {
            const { capitalPool, depositAmount, owner, yieldAdapter } = await loadFixture(deployAndDepositFixture);
            
            // Simulate a 25% yield gain
            const yieldGain = depositAmount.div(4); // 2,500
            await yieldAdapter.connect(owner).setTotalValueHeld(depositAmount.add(yieldGain));
            await capitalPool.connect(owner).syncYieldAndAdjustSystemValue();

            const shares = ethers.utils.parseUnits("1000", 6);
            // Expected value = shares * totalValue / totalShares = 1000 * 12500 / 10000 = 1250
            const expectedValue = ethers.utils.parseUnits("1250", 6);
            
            expect(await capitalPool.sharesToValue(shares)).to.equal(expectedValue);
        });
    });

    describe("valueToShares", function () {
        it("should return shares 1:1 with value if the system has no value", async function () {
            const { owner, underlyingAsset } = await loadFixture(deployAndDepositFixture);
            const CapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
            const newPool = await CapitalPoolFactory.deploy(owner.address, underlyingAsset.address);

            const value = ethers.utils.parseUnits("100", 6);
            expect(await newPool.valueToShares(value)).to.equal(value);
        });
        
        it("should return shares 1:1 with value when NAV is 1", async function () {
            const { capitalPool } = await loadFixture(deployAndDepositFixture);
            const value = ethers.utils.parseUnits("5000", 6);
            expect(await capitalPool.valueToShares(value)).to.equal(value);
        });

        it("should return fewer shares for the same value when NAV increases", async function() {
            const { capitalPool, depositAmount, owner, yieldAdapter } = await loadFixture(deployAndDepositFixture);
            
            // Simulate a 25% yield gain
            const yieldGain = depositAmount.div(4); // 2,500
            await yieldAdapter.connect(owner).setTotalValueHeld(depositAmount.add(yieldGain));
            await capitalPool.connect(owner).syncYieldAndAdjustSystemValue();

            const value = ethers.utils.parseUnits("1250", 6);
            // Expected shares = value * totalShares / totalValue = 1250 * 10000 / 12500 = 1000
            const expectedShares = ethers.utils.parseUnits("1000", 6);

            expect(await capitalPool.valueToShares(value)).to.equal(expectedShares);
        });
    });
});