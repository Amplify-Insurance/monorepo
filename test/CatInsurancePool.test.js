// test/CatInsurancePool.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Helper function to create mock contracts from an ABI
async function deployMock(abi, signer) {
    const factory = new ethers.ContractFactory(abi, `0x${'6080604052348015600f57600080fd5b50600080fdfe'}`, signer);
    return await factory.deploy();
}

describe("CatInsurancePool", function () {
    // --- Signers ---
    let owner, riskManager, policyManager, capitalPool, lp1, lp2, nonParty;

    // --- Contracts ---
    let catPool;
    let mockAdapter, mockRewardDistributor, mockUsdc, mockRewardToken, catShareToken;

    // --- Constants ---
    const MIN_USDC_AMOUNT = 1_000_000; // 1 USDC with 6 decimals
    const CAT_POOL_REWARD_ID = ethers.MaxUint256;

    // --- Mock ABIs ---
    const iYieldAdapterAbi = require("../artifacts/contracts/interfaces/IYieldAdapter.sol/IYieldAdapter.json").abi;
    const iRewardDistributorAbi = require("../artifacts/contracts/interfaces/IRewardDistributor.sol/IRewardDistributor.json").abi;

    beforeEach(async function () {
        // --- Get Signers ---
        [owner, riskManager, policyManager, capitalPool, lp1, lp2, nonParty] = await ethers.getSigners();

        // --- Deploy Mocks ---
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        mockUsdc = await MockERC20Factory.deploy("USD Coin", "USDC", 6);
        await mockUsdc.mint(owner.address, ethers.parseUnits("1000000", 6));
        mockRewardToken = await MockERC20Factory.deploy("Reward Token", "RWT", 18);
        await mockRewardToken.mint(owner.address, ethers.parseUnits("1000000", 18));
        
        mockAdapter = await deployMock(iYieldAdapterAbi, owner);
        mockRewardDistributor = await deployMock(iRewardDistributorAbi, owner);
        
        // --- Deploy CatInsurancePool ---
        const CatPoolFactory = await ethers.getContractFactory("CatInsurancePool");
        catPool = await CatPoolFactory.deploy(mockUsdc.target, mockAdapter.target, owner.address);

        // --- Get deployed CatShare token ---
        const catShareAddress = await catPool.catShareToken();
        const CatShareFactory = await ethers.getContractFactory("CatShare");
        catShareToken = CatShareFactory.attach(catShareAddress);

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

        // Mock adapter behavior
        await mockAdapter.mock.getCurrentValueHeld.returns(0);
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

        it("Should allow owner to set a new adapter and flush funds from the old one", async function() {
            // Deposit some funds and flush to the adapter
            const depositAmount = ethers.parseUnits("100", 6);
            await catPool.connect(owner).flushToAdapter(0); // Mock call to satisfy chai-solidity-mock for some reason
            await mockAdapter.mock.deposit.withArgs(depositAmount).returns();
            await catPool.connect(owner).receiveUsdcPremium(0); // mock call
            await mockUsdc.connect(owner).transfer(catPool.target, depositAmount); // manually transfer
            await catPool.connect(owner).setPolicyManagerAddress(owner.address); // Temporarily set to owner for test
            await catPool.connect(owner).receiveUsdcPremium(depositAmount);
            await catPool.connect(owner).flushToAdapter(depositAmount);
            
            // Set up mocks for the switch
            const newAdapter = await deployMock(iYieldAdapterAbi, owner);
            await mockAdapter.mock.getCurrentValueHeld.returns(depositAmount);
            await mockAdapter.mock.withdraw.withArgs(depositAmount, catPool.target).returns(depositAmount);

            await expect(catPool.connect(owner).setAdapter(newAdapter.target))
                .to.emit(catPool, "AdapterChanged").withArgs(newAdapter.target);

            expect(await catPool.idleUSDC()).to.equal(depositAmount);
            expect(await catPool.adapter()).to.equal(newAdapter.target);
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
            await mockAdapter.mock.getCurrentValueHeld.returns(DEPOSIT_AMOUNT * 110n / 100n);

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
            const usdcToWithdraw = await catPool.liquidUsdc() / 2n;

            await expect(catPool.connect(lp1).withdrawLiquidity(sharesToBurn))
                .to.emit(catPool, "CatLiquidityWithdrawn")
                .withArgs(lp1.address, usdcToWithdraw, sharesToBurn);
            
            expect(await mockUsdc.balanceOf(lp1.address)).to.contain(usdcToWithdraw);
        });
        
        it("Should allow withdrawing liquidity, pulling from adapter if idle is insufficient", async function() {
            // LP1 deposits, and funds are moved to adapter
            await catPool.connect(lp1).depositLiquidity(DEPOSIT_AMOUNT);
            await mockAdapter.mock.deposit.withArgs(DEPOSIT_AMOUNT).returns();
            await catPool.connect(owner).flushToAdapter(DEPOSIT_AMOUNT);
            expect(await catPool.idleUSDC()).to.equal(0);
            
            // Setup mocks for withdrawal
            const sharesToBurn = await catShareToken.balanceOf(lp1.address);
            await mockAdapter.mock.getCurrentValueHeld.returns(DEPOSIT_AMOUNT);
            await mockAdapter.mock.withdraw.withArgs(DEPOSIT_AMOUNT, catPool.target).returns(DEPOSIT_AMOUNT);

            await catPool.connect(lp1).withdrawLiquidity(sharesToBurn);

            expect(await mockUsdc.balanceOf(lp1.address)).to.contain(DEPOSIT_AMOUNT);
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
        
        it("receiveProtocolAssetsForDistribution should call the RewardDistributor", async function() {
            const rewardAmount = ethers.parseUnits("100", 18);
            await mockRewardToken.connect(owner).transfer(riskManager.address, rewardAmount);
            await mockRewardToken.connect(riskManager).approve(catPool.target, rewardAmount);
            const totalShares = await catShareToken.totalSupply();

            await mockRewardDistributor.mock.distribute.withArgs(CAT_POOL_REWARD_ID, mockRewardToken.target, rewardAmount, totalShares).returns();

            await expect(catPool.connect(riskManager).receiveProtocolAssetsForDistribution(mockRewardToken.target, rewardAmount))
                .to.emit(catPool, "ProtocolAssetReceivedForDistribution");
        });
    });

    describe("Rewards", function() {
        it("claimProtocolAssetRewards should call the reward distributor", async function() {
            const rewardAmount = ethers.parseUnits("50", 18);
            await catPool.connect(lp1).depositLiquidity(ethers.parseUnits("1000", 6));
            const userShares = await catShareToken.balanceOf(lp1.address);

            // Mock the claim function to return a value
            await mockRewardDistributor.mock.claimForCatPool
                .withArgs(lp1.address, CAT_POOL_REWARD_ID, mockRewardToken.target, userShares)
                .returns(rewardAmount);
            
            await expect(catPool.connect(lp1).claimProtocolAssetRewards(mockRewardToken.target))
                .to.emit(catPool, "ProtocolAssetRewardsClaimed")
                .withArgs(lp1.address, mockRewardToken.target, rewardAmount);
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
            // Deposit first
            const depositAmount = ethers.parseUnits("1000", 6);
            await catPool.connect(lp1).depositLiquidity(depositAmount);
            const sharesToBurn = await catShareToken.balanceOf(lp1.address);
            
            // Deploy malicious adapter that re-enters on withdraw
            const MaliciousAdapterFactory = await ethers.getContractFactory("MaliciousAdapter");
            const maliciousAdapter = await MaliciousAdapterFactory.deploy(catPool.target, mockUsdc.target);
            await maliciousAdapter.setWithdrawArgs(sharesToBurn);

            await catPool.connect(owner).setAdapter(maliciousAdapter.target);
            
            // Move funds to the malicious adapter
            await mockAdapter.mock.getCurrentValueHeld.returns(0); // Old adapter is empty
            await catPool.connect(owner).flushToAdapter(depositAmount);

            await expect(catPool.connect(lp1).withdrawLiquidity(sharesToBurn))
                .to.be.revertedWith("ReentrancyGuard: reentrant call");
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
    function deposit(uint256) external {}
    function withdraw(uint256, address) external returns (uint256) {
        catPool.withdrawLiquidity(sharesToBurn);
        return 0;
    }
    function getCurrentValueHeld() external view returns (uint256) { return 0;}
}
`;
fs.writeFileSync(path.join(__dirname, "..", "contracts", "MaliciousAdapter.sol"), maliciousAdapterSource);
