// test/CapitalPool.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Helper function to create mock contracts from an ABI
async function deployMock(abi, signer) {
    const factory = new ethers.ContractFactory(abi, `0x${'6080604052348015600f57600080fd5b50600080fdfe'}`, signer);
    return await factory.deploy();
}

describe("CapitalPool", function () {
    // --- Signers ---
    let owner, riskManager, user1, user2, feeRecipient, claimant, nonParty;

    // --- Contracts ---
    let capitalPool, CapitalPoolFactory;
    let mockRiskManager, mockAdapter1, mockAdapter2, mockUsdc;

    // --- Constants ---
    const INITIAL_SHARES_LOCKED = 1000n;
    const YIELD_PLATFORM_1 = 1; // AAVE
    const YIELD_PLATFORM_2 = 2; // COMPOUND
    // Let's use a non-zero notice period for testing
    const NOTICE_PERIOD = 1 * 24 * 60 * 60; // 1 day

    // --- Mock ABIs ---
    const iYieldAdapterAbi = require("../contracts/CapitalPool.sol/IYieldAdapter.json").abi;
    const iRiskManagerHookAbi = `[{"inputs":[{"internalType":"address","name":"_underwriter","type":"address"},{"internalType":"uint256","name":"_amount","type":"uint256"}],"name":"onCapitalDeposited","outputs":[],"stateMutability":"nonpayable","type":"function"}, {"inputs":[{"internalType":"address","name":"_underwriter","type":"address"},{"internalType":"uint256","name":"_principalComponent","type":"uint256"}],"name":"onWithdrawalRequested","outputs":[],"stateMutability":"nonpayable","type":"function"}, {"inputs":[{"internalType":"address","name":"_underwriter","type":"address"},{"internalType":"uint256","name":"_principalComponentRemoved","type":"uint256"},{"internalType":"bool","name":"_isFullWithdrawal","type":"bool"}],"name":"onCapitalWithdrawn","outputs":[],"stateMutability":"nonpayable","type":"function"}]`;

    beforeEach(async function () {
        // --- Get Signers ---
        [owner, riskManager, user1, user2, feeRecipient, claimant, nonParty] = await ethers.getSigners();

        // --- Deploy Mocks ---
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        mockUsdc = await MockERC20Factory.deploy("USD Coin", "USDC", ethers.parseUnits("1000000", 6));
        
        mockRiskManager = await deployMock(iRiskManagerHookAbi, owner);
        mockAdapter1 = await deployMock(iYieldAdapterAbi, owner);
        mockAdapter2 = await deployMock(iYieldAdapterAbi, owner);

        // --- Deploy CapitalPool ---
        CapitalPoolFactory = await ethers.getContractFactory("CapitalPool");
        capitalPool = await CapitalPoolFactory.deploy(owner.address, mockUsdc.target);
        await capitalPool.setUnderwriterNoticePeriod(NOTICE_PERIOD);

        // --- Initial Setup ---
        await mockUsdc.transfer(user1.address, ethers.parseUnits("10000", 6));
        await mockUsdc.transfer(user2.address, ethers.parseUnits("10000", 6));
        await mockUsdc.connect(user1).approve(capitalPool.target, ethers.MaxUint256);
        await mockUsdc.connect(user2).approve(capitalPool.target, ethers.MaxUint256);

        await mockAdapter1.mock.asset.returns(mockUsdc.target);
        await mockAdapter2.mock.asset.returns(mockUsdc.target);
    });

    describe("Deployment & Admin Functions", function () {
        it("Should deploy with correct initial state", async function () {
            expect(await capitalPool.owner()).to.equal(owner.address);
            expect(await capitalPool.underlyingAsset()).to.equal(mockUsdc.target);
            expect(await capitalPool.totalMasterSharesSystem()).to.equal(INITIAL_SHARES_LOCKED);
        });

        it("Should allow owner to set RiskManager and revert if already set", async function() {
            await expect(capitalPool.connect(owner).setRiskManager(riskManager.address))
                .to.emit(capitalPool, "RiskManagerSet").withArgs(riskManager.address);
            expect(await capitalPool.riskManager()).to.equal(riskManager.address);

            await expect(capitalPool.connect(owner).setRiskManager(nonParty.address))
                .to.be.revertedWith("CP: RiskManager already set");
        });

        it("Should allow owner to set Base Yield Adapters", async function() {
            await expect(capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_1, mockAdapter1.target))
                .to.emit(capitalPool, "BaseYieldAdapterSet").withArgs(YIELD_PLATFORM_1, mockAdapter1.target);
            expect(await capitalPool.baseYieldAdapters(YIELD_PLATFORM_1)).to.equal(mockAdapter1.target);
            expect(await capitalPool.activeYieldAdapterAddresses()).to.include(mockAdapter1.target);
        });

        it("Should revert if adapter asset does not match", async function() {
            const BadMockERC20Factory = await ethers.getContractFactory("MockERC20");
            const badUsdc = await BadMockERC20Factory.deploy("Bad Coin", "BDC", 0);
            await mockAdapter1.mock.asset.returns(badUsdc.target);

            await expect(capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_1, mockAdapter1.target))
                .to.be.revertedWith("CP: Adapter asset mismatch");
        });
    });

    context("With RiskManager and Adapters Set", function() {
        beforeEach(async function() {
            await capitalPool.connect(owner).setRiskManager(riskManager.address);
            await capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_1, mockAdapter1.target);
            await capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_2, mockAdapter2.target);
        });

        describe("Deposit", function() {
            const DEPOSIT_AMOUNT = ethers.parseUnits("1000", 6);
            
            it("Should handle a first deposit correctly", async function() {
                await mockAdapter1.mock.deposit.withArgs(DEPOSIT_AMOUNT).returns();
                await mockRiskManager.mock.onCapitalDeposited.withArgs(user1.address, DEPOSIT_AMOUNT).returns();
                
                const expectedShares = DEPOSIT_AMOUNT;
                
                await expect(capitalPool.connect(user1).deposit(DEPOSIT_AMOUNT, YIELD_PLATFORM_1))
                    .to.emit(capitalPool, "Deposit")
                    .withArgs(user1.address, DEPOSIT_AMOUNT, expectedShares, YIELD_PLATFORM_1);

                const account = await capitalPool.getUnderwriterAccount(user1.address);
                expect(account.masterShares).to.equal(expectedShares);
                expect(await capitalPool.totalSystemValue()).to.equal(DEPOSIT_AMOUNT);
            });

            it("Should handle a second deposit correctly, calculating shares based on NAV", async function() {
                await mockAdapter1.mock.deposit.returns();
                await mockRiskManager.mock.onCapitalDeposited.returns();
                await capitalPool.connect(user1).deposit(DEPOSIT_AMOUNT, YIELD_PLATFORM_1);

                const newTotalValue = DEPOSIT_AMOUNT + ethers.parseUnits("100", 6);
                await mockAdapter1.mock.getCurrentValueHeld.returns(newTotalValue);
                await capitalPool.connect(owner).syncYieldAndAdjustSystemValue();
                
                const expectedShares = (DEPOSIT_AMOUNT * (await capitalPool.totalMasterSharesSystem())) / newTotalValue;

                await expect(capitalPool.connect(user2).deposit(DEPOSIT_AMOUNT, YIELD_PLATFORM_1))
                    .to.emit(capitalPool, "Deposit")
                    .withArgs(user2.address, DEPOSIT_AMOUNT, expectedShares, YIELD_PLATFORM_1);
            });
            
            it("Should revert if user tries to change yield platform", async function() {
                 await mockAdapter1.mock.deposit.returns();
                 await mockRiskManager.mock.onCapitalDeposited.returns();
                 await capitalPool.connect(user1).deposit(DEPOSIT_AMOUNT, YIELD_PLATFORM_1);
                 
                 await expect(capitalPool.connect(user1).deposit(DEPOSIT_AMOUNT, YIELD_PLATFORM_2))
                    .to.be.revertedWith("CP: Cannot change yield platform; withdraw first.");
            });
        });

        describe("Withdrawal Lifecycle", function() {
            const DEPOSIT_AMOUNT = ethers.parseUnits("1000", 6);
            
            beforeEach(async function() {
                await mockAdapter1.mock.deposit.returns();
                await mockRiskManager.mock.onCapitalDeposited.returns();
                await capitalPool.connect(user1).deposit(DEPOSIT_AMOUNT, YIELD_PLATFORM_1);
            });
            
            it("Should request a withdrawal successfully", async function() {
                const account = await capitalPool.getUnderwriterAccount(user1.address);
                const sharesToWithdraw = account.masterShares / 2n;
                const valueToWithdraw = await capitalPool.sharesToValue(sharesToWithdraw);

                await mockRiskManager.mock.onWithdrawalRequested.withArgs(user1.address, valueToWithdraw).returns();
                
                await expect(capitalPool.connect(user1).requestWithdrawal(sharesToWithdraw))
                    .to.emit(capitalPool, "WithdrawalRequested");
                
                const updatedAccount = await capitalPool.getUnderwriterAccount(user1.address);
                expect(updatedAccount.withdrawalRequestShares).to.equal(sharesToWithdraw);
            });
            
            it("Should revert if withdrawal is requested while one is pending", async function() {
                await mockRiskManager.mock.onWithdrawalRequested.returns();
                await capitalPool.connect(user1).requestWithdrawal(100);
                await expect(capitalPool.connect(user1).requestWithdrawal(100))
                    .to.be.revertedWithCustomError(capitalPool, "WithdrawalRequestPending");
            });

            it("Should revert if executing withdrawal before notice period ends", async function() {
                await mockRiskManager.mock.onWithdrawalRequested.returns();
                await capitalPool.connect(user1).requestWithdrawal(100);
                await expect(capitalPool.connect(user1).executeWithdrawal())
                    .to.be.revertedWithCustomError(capitalPool, "NoticePeriodActive");
            });

            it("Should execute a partial withdrawal successfully", async function() {
                const sharesToBurn = (await capitalPool.getUnderwriterAccount(user1.address)).masterShares / 2n;
                await mockRiskManager.mock.onWithdrawalRequested.returns();
                await capitalPool.connect(user1).requestWithdrawal(sharesToBurn);
                await time.increase(NOTICE_PERIOD);
                
                const valueToWithdraw = await capitalPool.sharesToValue(sharesToBurn);
                const principalRemoved = (await capitalPool.getUnderwriterAccount(user1.address)).totalDepositedAssetPrincipal / 2n;

                await mockAdapter1.mock.withdraw.returns(valueToWithdraw);
                await mockRiskManager.mock.onCapitalWithdrawn.withArgs(user1.address, principalRemoved, false).returns();

                await expect(capitalPool.connect(user1).executeWithdrawal())
                    .to.emit(capitalPool, "WithdrawalExecuted");
                
                const finalAccount = await capitalPool.getUnderwriterAccount(user1.address);
                expect(finalAccount.withdrawalRequestShares).to.equal(0);
                expect(finalAccount.masterShares).to.be.gt(0);
            });

            it("Should execute a full withdrawal successfully, cleaning up state", async function() {
                const sharesToBurn = (await capitalPool.getUnderwriterAccount(user1.address)).masterShares;
                await mockRiskManager.mock.onWithdrawalRequested.returns();
                await capitalPool.connect(user1).requestWithdrawal(sharesToBurn);
                await time.increase(NOTICE_PERIOD);

                const valueToWithdraw = await capitalPool.sharesToValue(sharesToBurn);
                const principalRemoved = (await capitalPool.getUnderwriterAccount(user1.address)).totalDepositedAssetPrincipal;

                await mockAdapter1.mock.withdraw.returns(valueToWithdraw);
                await mockRiskManager.mock.onCapitalWithdrawn.withArgs(user1.address, principalRemoved, true).returns();

                await capitalPool.connect(user1).executeWithdrawal();
                
                const finalAccount = await capitalPool.getUnderwriterAccount(user1.address);
                expect(finalAccount.totalDepositedAssetPrincipal).to.equal(0);
                expect(finalAccount.masterShares).to.equal(0);
            });
        });

        describe("RiskManager Only Functions", function() {
            const DEPOSIT_1 = ethers.parseUnits("6000", 6);
            const DEPOSIT_2 = ethers.parseUnits("4000", 6);

            beforeEach(async function() {
                await mockAdapter1.mock.deposit.returns();
                await mockAdapter2.mock.deposit.returns();
                await mockRiskManager.mock.onCapitalDeposited.returns();
                await capitalPool.connect(user1).deposit(DEPOSIT_1, YIELD_PLATFORM_1);
                await capitalPool.connect(user2).deposit(DEPOSIT_2, YIELD_PLATFORM_2);
            });

            it("executePayout should withdraw from adapters proportionally", async function() {
                const payoutAmount = ethers.parseUnits("1000", 6);
                const payoutData = {
                    claimant: claimant.address, claimantAmount: payoutAmount, feeRecipient: ethers.ZeroAddress, feeAmount: 0,
                    adapters: [mockAdapter1.target, mockAdapter2.target],
                    capitalPerAdapter: [DEPOSIT_1, DEPOSIT_2],
                    totalCapitalFromPoolLPs: DEPOSIT_1 + DEPOSIT_2
                };
                const expectedFrom1 = (payoutAmount * DEPOSIT_1) / (DEPOSIT_1 + DEPOSIT_2);
                const expectedFrom2 = (payoutAmount * DEPOSIT_2) / (DEPOSIT_1 + DEPOSIT_2);
                
                await mockAdapter1.mock.withdraw.withArgs(expectedFrom1, capitalPool.target).returns(expectedFrom1);
                await mockAdapter2.mock.withdraw.withArgs(expectedFrom2, capitalPool.target).returns(expectedFrom2);
                
                await capitalPool.connect(riskManager).executePayout(payoutData);
                expect(await mockUsdc.balanceOf(claimant.address)).to.equal(payoutAmount);
            });
            
            it("executePayout should revert if payout exceeds pool capital", async function() {
                const payoutData = {
                    claimant: claimant.address, claimantAmount: DEPOSIT_1 + DEPOSIT_2, feeRecipient: ethers.ZeroAddress, feeAmount: 1,
                    adapters: [], capitalPerAdapter: [], totalCapitalFromPoolLPs: DEPOSIT_1 + DEPOSIT_2
                };
                await expect(capitalPool.connect(riskManager).executePayout(payoutData))
                    .to.be.revertedWithCustomError(capitalPool, "PayoutExceedsPoolLPCapital");
            });

            it("executePayout should revert if adapters fail to provide enough funds", async function() {
                const payoutAmount = ethers.parseUnits("1000", 6);
                const payoutData = {
                    claimant: claimant.address, claimantAmount: payoutAmount, feeRecipient: ethers.ZeroAddress, feeAmount: 0,
                    adapters: [mockAdapter1.target], capitalPerAdapter: [DEPOSIT_1 + DEPOSIT_2], totalCapitalFromPoolLPs: DEPOSIT_1 + DEPOSIT_2
                };
                await mockAdapter1.mock.withdraw.returns(payoutAmount - 1n);
                
                await expect(capitalPool.connect(riskManager).executePayout(payoutData))
                    .to.be.revertedWith("CP: Payout failed, insufficient funds gathered");
            });
            
            it("applyLosses should burn shares and reduce principal", async function() {
                const lossAmount = ethers.parseUnits("1000", 6);
                const initialAccount = await capitalPool.getUnderwriterAccount(user1.address);
                await capitalPool.connect(riskManager).applyLosses(user1.address, lossAmount);
                const finalAccount = await capitalPool.getUnderwriterAccount(user1.address);
                expect(finalAccount.totalDepositedAssetPrincipal).to.equal(initialAccount.totalDepositedAssetPrincipal - lossAmount);
                expect(finalAccount.masterShares).to.be.lt(initialAccount.masterShares);
            });
             
            it("applyLosses should wipe out an underwriter if losses exactly equal principal", async function() {
                const lossAmount = DEPOSIT_1;
                await capitalPool.connect(riskManager).applyLosses(user1.address, lossAmount);
                const finalAccount = await capitalPool.getUnderwriterAccount(user1.address);
                expect(finalAccount.masterShares).to.equal(0);
                expect(finalAccount.totalDepositedAssetPrincipal).to.equal(0);
             });
        });

        describe("Keeper & View Functions", function() {
            it("syncYieldAndAdjustSystemValue should update totalSystemValue", async function() {
                const depositAmount = ethers.parseUnits("1000", 6);
                await mockAdapter1.mock.deposit.returns();
                await mockRiskManager.mock.onCapitalDeposited.returns();
                await capitalPool.connect(user1).deposit(depositAmount, YIELD_PLATFORM_1);

                const yieldGained = ethers.parseUnits("50", 6);
                const newValue = depositAmount + yieldGained;
                await mockAdapter1.mock.getCurrentValueHeld.returns(newValue);
                
                await expect(capitalPool.connect(nonParty).syncYieldAndAdjustSystemValue())
                    .to.emit(capitalPool, "SystemValueSynced")
                    .withArgs(newValue, depositAmount);
                
                expect(await capitalPool.totalSystemValue()).to.equal(newValue);
            });

            it("syncYieldAndAdjustSystemValue should emit event if an adapter call fails", async function() {
                await mockAdapter1.mock.getCurrentValueHeld.revertsWithReason("Adapter offline");
                
                await expect(capitalPool.connect(nonParty).syncYieldAndAdjustSystemValue())
                    .to.emit(capitalPool, "AdapterCallFailed")
                    .withArgs(mockAdapter1.target, "getCurrentValueHeld", "Adapter offline");
            });
        });

        describe("Access Control and Security", function() {
            it("should revert if a non-RiskManager calls applyLosses", async function() {
                await expect(capitalPool.connect(nonParty).applyLosses(user1.address, 1))
                    .to.be.revertedWith("CP: Caller is not the RiskManager");
            });

            it("Should prevent re-entrancy on deposit", async function() {
                const MaliciousAdapterFactory = await ethers.getContractFactory("MaliciousAdapter");
                const maliciousAdapter = await MaliciousAdapterFactory.deploy(capitalPool.target, mockUsdc.target);
                
                await capitalPool.connect(owner).setBaseYieldAdapter(3, maliciousAdapter.target);

                await expect(capitalPool.connect(user1).deposit(ethers.parseUnits("100", 6), 3))
                    .to.be.revertedWith("ReentrancyGuard: reentrant call");
            });
            
            it("Should prevent re-entrancy on executeWithdrawal", async function() {
                const MaliciousAdapterFactory = await ethers.getContractFactory("MaliciousAdapter");
                const maliciousAdapter = await MaliciousAdapterFactory.deploy(capitalPool.target, mockUsdc.target);
                await capitalPool.connect(owner).setBaseYieldAdapter(YIELD_PLATFORM_1, maliciousAdapter.target);

                const DEPOSIT_AMOUNT = ethers.parseUnits("1000", 6);
                await mockRiskManager.mock.onCapitalDeposited.returns();
                // deposit will call the malicious adapter which will try to reenter
                await expect(capitalPool.connect(user1).deposit(DEPOSIT_AMOUNT, YIELD_PLATFORM_1))
                    .to.be.revertedWith("ReentrancyGuard: reentrant call");

            });
        });
    });
});

// A basic Mock ERC20 contract for testing purposes
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
    ]
};

// Helper contract for re-entrancy test
const MaliciousAdapterArtifact = {
    "contractName": "MaliciousAdapter",
    "abi": [
        {"inputs":[{"internalType":"address","name":"_capitalPool","type":"address"},{"internalType":"address","name":"_asset","type":"address"}],"stateMutability":"nonpayable","type":"constructor"},
        {"inputs":[],"name":"asset","outputs":[{"internalType":"contract IERC20","name":"","type":"address"}],"stateMutability":"view","type":"function"},
        {"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"deposit","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"address","name":"to","type":"address"}],"name":"withdraw","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"nonpayable","type":"function"},
    ],
    "bytecode": "0x608060405234801561001057600080fd5b506040516102ab3803806102ab83398181016040528101906100329190610214565b80600081905550806001819055505061024b565b600080fd5b61005c826100c6565b6100668261019d565b905060008152600181526020818152602001925050506020810190506001019050919050565b6000600160006001848152602001908152602001600020549050919050565b600080600060003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002081905550600080600183815260200190815260200160002081905550808201908082111561015f5760008282028082111561015f57fe5b9060200190a150565b63461cb28160e01b81526004018080602001828103825260128152602001807f4d616c6963696f7573416461707465720000000000000000000000000000000081525060009101906101c7565b6000600160009054906101000a900473ffffffffffffffffffffffffffffffffffffffff169050919050565b60008060008282540192505081905550565b600081519050919050565b61023c81610204565b82525050565b60006020820190506001600083018460405180828051906020019080838360005b83811015610170578082015181840152602001835260200182810190508083111561017057fe5b50505050905090810190601f16801561019d57808203815260200180519050905090565b505056fea26469706673582212202613b5e43a918a0ac79973caea1c2c2f688e441c2d3a33993c126d9c6e5a639664736f6c63430008140033"
};

ethers.ContractFactory.getContractFactory = async (name, signer) => {
    if (name === "MockERC20") {
        const factory = new ethers.ContractFactory(MockERC20Artifact.abi, MockERC20Artifact.bytecode, signer);
        return factory;
    }
    if (name === "MaliciousAdapter") {
        const factory = new ethers.ContractFactory(MaliciousAdapterArtifact.abi, MaliciousAdapterArtifact.bytecode, signer);
        return factory;
    }
    const hardhatEthers = require("hardhat").ethers;
    return hardhatEthers.getContractFactory(name, signer);
};

// We need a simple contract artifact for the re-entrancy test
const fs = require('fs');
const path = require('path');
const maliciousAdapterSource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
interface ICapitalPool {
    function deposit(uint256 _amount, uint8 _yieldChoice) external;
    function executeWithdrawal() external;
}
contract MaliciousAdapter {
    ICapitalPool public capitalPool;
    IERC20 public asset;
    constructor(address _capitalPool, address _asset) {
        capitalPool = ICapitalPool(_capitalPool);
        asset = IERC20(_asset);
    }
    function deposit(uint256) external {
        // Re-enter on deposit
        capitalPool.deposit(1, 3); 
    }
    function withdraw(uint256 amount, address to) external returns (uint256) {
        // Re-enter on withdraw
        capitalPool.executeWithdrawal();
        return amount;
    }
    function getCurrentValueHeld() external view returns (uint256) { return 0; }
}
`;
fs.writeFileSync(path.join(__dirname, "..", "contracts", "MaliciousAdapter.sol"), maliciousAdapterSource);
// We also need to recreate this one as it might have been deleted by other tests
const maliciousPoolRegistrySource = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface IRiskManager {
    function allocateCapital(uint256[] calldata _poolIds) external;
}
contract MaliciousPoolRegistry {
    address public riskManager;
    function setRiskManager(address _rm) external {
        riskManager = _rm;
    }
    function updateCapitalAllocation(uint256, address, uint256, bool) external {
        IRiskManager(riskManager).allocateCapital(new uint256[](0));
    }
    function getPoolCount() external pure returns (uint256) {
        return 1;
    }
}
`;
fs.writeFileSync(path.join(__dirname, "..", "contracts", "MaliciousPoolRegistry.sol"), maliciousPoolRegistrySource);