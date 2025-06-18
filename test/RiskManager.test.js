// test/RiskManager.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Helper function to create mock contracts from an ABI
async function deployMock(abi, signer) {
    const factory = new ethers.ContractFactory(abi, `0x${'6080604052348015600f57600080fd5b50600080fdfe'}`, signer);
    return await factory.deploy();
}

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

    // --- Mock ABIs (assuming they are generated in the artifacts folder) ---
    const iPoolRegistryAbi = require("../artifacts/contracts/RiskManager.sol/IPoolRegistry.json").abi;
    const iCapitalPoolAbi = require("../artifacts/contracts/RiskManager.sol/ICapitalPool.json").abi;
    const iPolicyNFTAbi = require("../artifacts/contracts/RiskManager.sol/IPolicyNFT.json").abi;
    const iCatInsurancePoolAbi = require("../artifacts/contracts/RiskManager.sol/ICatInsurancePool.json").abi;
    const iLossDistributorAbi = require("../artifacts/contracts/RiskManager.sol/ILossDistributor.json").abi;
    const iPolicyManagerAbi = require("../artifacts/contracts/RiskManager.sol/IPolicyManager.json").abi;
    const iRewardDistributorAbi = require("../artifacts/contracts/RiskManager.sol/IRewardDistributor.json").abi;


    beforeEach(async function () {
        // --- Get Signers ---
        [owner, committee, underwriter1, underwriter2, claimant, liquidator, nonParty] = await ethers.getSigners();

        // --- Deploy Mocks ---
        mockPoolRegistry = await deployMock(iPoolRegistryAbi, owner);
        mockCapitalPool = await deployMock(iCapitalPoolAbi, owner);
        mockPolicyNFT = await deployMock(iPolicyNFTAbi, owner);
        mockCatPool = await deployMock(iCatInsurancePoolAbi, owner);
        mockLossDistributor = await deployMock(iLossDistributorAbi, owner);
        mockPolicyManager = await deployMock(iPolicyManagerAbi, owner);
        mockRewardDistributor = await deployMock(iRewardDistributorAbi, owner);

        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        mockUsdc = await MockERC20Factory.deploy("USD Coin", "USDC", ethers.parseUnits("1000000", 6));
        
        // --- Deploy RiskManager ---
        const RiskManagerFactory = await ethers.getContractFactory("RiskManager");
        riskManager = await RiskManagerFactory.deploy(owner.address);

        // --- Mock Setup ---
        await mockPolicyManager.mock.policyNFT.returns(mockPolicyNFT.target);
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
                await riskManager.connect(mockCapitalPool).onCapitalDeposited(underwriter1.address, PLEDGE_AMOUNT);
                await mockPoolRegistry.mock.getPoolCount.returns(MAX_ALLOCATIONS + 1);
                await mockCapitalPool.mock.getUnderwriterAdapterAddress.withArgs(underwriter1.address).returns(nonParty.address);
                await mockPoolRegistry.mock.updateCapitalAllocation.returns();
            });

            it("Should allow an underwriter to allocate their capital to pools", async function() {
                await expect(riskManager.connect(underwriter1).allocateCapital([POOL_ID_1, POOL_ID_2]))
                    .to.emit(riskManager, "CapitalAllocated").withArgs(underwriter1.address, POOL_ID_1, PLEDGE_AMOUNT)
                    .and.to.emit(riskManager, "CapitalAllocated").withArgs(underwriter1.address, POOL_ID_2, PLEDGE_AMOUNT);
                
                const allocations = await riskManager.underwriterAllocations(underwriter1.address);
                expect(allocations).to.deep.equal([BigInt(POOL_ID_1), BigInt(POOL_ID_2)]);
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
        });

        describe("Capital Deallocation", function() {
            const PLEDGE_AMOUNT = ethers.parseUnits("10000", 6);

            beforeEach(async function() {
                await riskManager.connect(mockCapitalPool).onCapitalDeposited(underwriter1.address, PLEDGE_AMOUNT);
                await mockPoolRegistry.mock.getPoolCount.returns(1);
                await mockCapitalPool.mock.getUnderwriterAdapterAddress.returns(nonParty.address);
                await mockPoolRegistry.mock.updateCapitalAllocation.returns();
                await riskManager.connect(underwriter1).allocateCapital([POOL_ID_1]);
                await mockCapitalPool.mock.applyLosses.returns();
            });

            it("Should allow an underwriter to deallocate from a pool with no losses", async function() {
                await mockLossDistributor.mock.realizeLosses.returns(0);
                await expect(riskManager.connect(underwriter1).deallocateFromPool(POOL_ID_1))
                    .to.emit(riskManager, "CapitalDeallocated").withArgs(underwriter1.address, POOL_ID_1, PLEDGE_AMOUNT);
                
                const allocations = await riskManager.underwriterAllocations(underwriter1.address);
                expect(allocations).to.be.empty;
            });
            
            it("Should correctly apply losses before deallocating", async function() {
                const lossAmount = ethers.parseUnits("1000", 6);
                await mockLossDistributor.mock.realizeLosses.withArgs(underwriter1.address, POOL_ID_1, PLEDGE_AMOUNT).returns(lossAmount);
                
                await riskManager.connect(underwriter1).deallocateFromPool(POOL_ID_1);

                // Check that pledge was reduced before emitting the event
                expect(await riskManager.underwriterTotalPledge(underwriter1.address)).to.equal(PLEDGE_AMOUNT - lossAmount);
            });
            
            it("Should revert if trying to deallocate from a pool they are not in", async function() {
                await mockLossDistributor.mock.realizeLosses.returns(0);
                await expect(riskManager.connect(underwriter2).deallocateFromPool(POOL_ID_1))
                    .to.be.revertedWith("Not allocated to this pool");
            });
        });

        describe("Governance Hooks", function() {
            it("Should allow the committee to report an incident (pause a pool)", async function() {
                await mockPoolRegistry.mock.setPauseState.withArgs(POOL_ID_1, true).returns();
                await expect(riskManager.connect(committee).reportIncident(POOL_ID_1, true)).to.not.be.reverted;
            });
            
            it("Should prevent non-committee from reporting an incident", async function() {
                await expect(riskManager.connect(nonParty).reportIncident(POOL_ID_1, true))
                    .to.be.revertedWithCustomError(riskManager, "NotCommittee");
            });

            it("Should allow the committee to set a pool's fee recipient", async function() {
                await mockPoolRegistry.mock.setFeeRecipient.withArgs(POOL_ID_1, nonParty.address).returns();
                await expect(riskManager.connect(committee).setPoolFeeRecipient(POOL_ID_1, nonParty.address)).to.not.be.reverted;
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
                await mockPolicyNFT.mock.getPolicy.withArgs(POLICY_ID).returns(POOL_ID_1, COVERAGE_AMOUNT, 0, 0, 0);
                await mockPoolRegistry.mock.getPoolPayoutData.withArgs(POOL_ID_1).returns([nonParty.address], [TOTAL_PLEDGED], TOTAL_PLEDGED);
                await mockPoolRegistry.mock.getPoolData.withArgs(POOL_ID_1).returns(mockProtocolToken.target, TOTAL_PLEDGED, 0, 0, false, committee.address, 500);
                await mockLossDistributor.mock.distributeLoss.returns();
                await mockRewardDistributor.mock.distribute.returns();
                await mockCapitalPool.mock.executePayout.returns();
                await mockPoolRegistry.mock.updateCoverageSold.returns();
                await mockPolicyNFT.mock.burn.returns();
                await mockPolicyNFT.mock.ownerOf.withArgs(POLICY_ID).returns(claimant.address);
                await mockProtocolToken.connect(claimant).approve(riskManager.target, COVERAGE_AMOUNT);
            });

            it("Should process a claim fully covered by the pool", async function() {
                await expect(riskManager.connect(nonParty).processClaim(POLICY_ID)).to.not.be.reverted;
                const payoutData = mockCapitalPool.mock.executePayout.getCall(0).args[0];
                const expectedFee = (COVERAGE_AMOUNT * 500n) / 10000n;
                expect(payoutData.claimant).to.equal(claimant.address);
                expect(payoutData.claimantAmount).to.equal(COVERAGE_AMOUNT - expectedFee);
                expect(payoutData.feeRecipient).to.equal(committee.address);
                expect(payoutData.feeAmount).to.equal(expectedFee);
                const distCall = mockRewardDistributor.mock.distribute.getCall(0);
                expect(distCall.args[0]).to.equal(POOL_ID_1);
                expect(distCall.args[1]).to.equal(mockProtocolToken.target);
                expect(distCall.args[2]).to.equal(COVERAGE_AMOUNT);
            });
            
            it("Should draw from the CAT pool if there is a shortfall", async function() {
                const HIGH_COVERAGE = TOTAL_PLEDGED + 1000n;
                const SHORTFALL = HIGH_COVERAGE - TOTAL_PLEDGED;
                await mockPolicyNFT.mock.getPolicy.withArgs(POLICY_ID).returns(POOL_ID_1, HIGH_COVERAGE, 0, 0, 0);
                await mockCatPool.mock.drawFund.withArgs(SHORTFALL).returns();
                await mockProtocolToken.connect(owner).mint(claimant.address, HIGH_COVERAGE);
                await mockProtocolToken.connect(claimant).approve(riskManager.target, HIGH_COVERAGE);
                await mockRewardDistributor.mock.distribute.returns();

                await expect(riskManager.connect(nonParty).processClaim(POLICY_ID)).to.not.be.reverted;
                expect(mockCatPool.mock.drawFund.callCount).to.equal(1);
                const distCall2 = mockRewardDistributor.mock.distribute.getCall(0);
                expect(distCall2.args[2]).to.equal(HIGH_COVERAGE);
            });
        });

        describe("Liquidation", function() {
            const PLEDGE = ethers.parseUnits("10000", 6);
            const SHARES = ethers.parseUnits("10000", 18);

            beforeEach(async function() {
                await riskManager.connect(mockCapitalPool).onCapitalDeposited(underwriter1.address, PLEDGE);
                await mockPoolRegistry.mock.getPoolCount.returns(1);
                await mockCapitalPool.mock.getUnderwriterAdapterAddress.returns(nonParty.address);
                await mockPoolRegistry.mock.updateCapitalAllocation.returns();
                await riskManager.connect(underwriter1).allocateCapital([POOL_ID_1]);
                
                await mockCapitalPool.mock.getUnderwriterAccount.withArgs(underwriter1.address).returns(0,0,SHARES,0,0);
                await mockLossDistributor.mock.realizeLosses.returns(0);
                await mockCapitalPool.mock.applyLosses.returns();
            });

            it("Should liquidate an insolvent underwriter", async function() {
                const shareValue = ethers.parseUnits("9000", 6);
                const pendingLosses = ethers.parseUnits("9001", 6);
                await mockCapitalPool.mock.sharesToValue.withArgs(SHARES).returns(shareValue);
                await mockLossDistributor.mock.getPendingLosses.withArgs(underwriter1.address, POOL_ID_1, PLEDGE).returns(pendingLosses);

                await expect(riskManager.connect(liquidator).liquidateInsolventUnderwriter(underwriter1.address))
                    .to.emit(riskManager, "UnderwriterLiquidated").withArgs(liquidator.address, underwriter1.address);
            });

            it("Should revert if underwriter is solvent", async function() {
                const shareValue = ethers.parseUnits("9000", 6);
                const pendingLosses = ethers.parseUnits("8999", 6);
                await mockCapitalPool.mock.sharesToValue.withArgs(SHARES).returns(shareValue);
                await mockLossDistributor.mock.getPendingLosses.withArgs(underwriter1.address, POOL_ID_1, PLEDGE).returns(pendingLosses);

                await expect(riskManager.connect(liquidator).liquidateInsolventUnderwriter(underwriter1.address))
                    .to.be.revertedWithCustomError(riskManager, "UnderwriterNotInsolvent");
            });
            
            it("Should revert if underwriter has no shares", async function() {
                await mockCapitalPool.mock.getUnderwriterAccount.withArgs(underwriter2.address).returns(0,0,0,0,0);
                 await expect(riskManager.connect(liquidator).liquidateInsolventUnderwriter(underwriter2.address))
                    .to.be.revertedWithCustomError(riskManager, "UnderwriterNotInsolvent");
            });
        });

        describe("Hooks and State Updaters", function() {
            it("onCapitalDeposited should revert if not called by CapitalPool", async function() {
                await expect(riskManager.connect(nonParty).onCapitalDeposited(underwriter1.address, 100))
                    .to.be.revertedWithCustomError(riskManager, "NotCapitalPool");
            });

            it("updateCoverageSold should revert if not called by PolicyManager", async function() {
                await expect(riskManager.connect(nonParty).updateCoverageSold(POOL_ID_1, 100, true))
                    .to.be.revertedWithCustomError(riskManager, "NotPolicyManager");
            });
            
             it("onCapitalWithdrawn should handle partial withdrawal", async function() {
                const pledge = ethers.parseUnits("1000", 6);
                const partialWithdrawal = ethers.parseUnits("400", 6);
                await riskManager.connect(mockCapitalPool).onCapitalDeposited(underwriter1.address, pledge);
                await mockPoolRegistry.mock.getPoolCount.returns(1);
                await mockCapitalPool.mock.getUnderwriterAdapterAddress.returns(nonParty.address);
                await mockPoolRegistry.mock.updateCapitalAllocation.returns();
                await riskManager.connect(underwriter1).allocateCapital([POOL_ID_1]);
                
                await mockLossDistributor.mock.realizeLosses.returns(0);
                await mockPoolRegistry.mock.updateCapitalPendingWithdrawal.returns();
                
                // Perform a partial withdrawal
                await riskManager.connect(mockCapitalPool).onCapitalWithdrawn(underwriter1.address, partialWithdrawal, false);
                
                expect(await riskManager.underwriterTotalPledge(underwriter1.address)).to.equal(pledge - partialWithdrawal);
                const allocations = await riskManager.underwriterAllocations(underwriter1.address);
                expect(allocations).to.not.be.empty; // Should not be cleaned up
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
                await riskManager.connect(mockCapitalPool).onCapitalDeposited(underwriter1.address, PLEDGE_AMOUNT);
                await mockCapitalPool.mock.getUnderwriterAdapterAddress.returns(nonParty.address);

                // The malicious contract will try to re-enter `allocateCapital`
                await expect(riskManager.connect(underwriter1).allocateCapital([POOL_ID_1]))
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
    ],
};

// Helper contract for re-entrancy test
const MaliciousPoolRegistryArtifact = {
    "contractName": "MaliciousPoolRegistry",
    "abi": [
        {"inputs":[],"name":"getPoolCount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"pure","type":"function"},
        {"inputs":[{"internalType":"address","name":"_rm","type":"address"}],"name":"setRiskManager","outputs":[],"stateMutability":"nonpayable","type":"function"},
        {"inputs":[{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"address","name":"","type":"address"},{"internalType":"uint256","name":"","type":"uint256"},{"internalType":"bool","name":""}],"name":"updateCapitalAllocation","outputs":[],"stateMutability":"nonpayable","type":"function"}
    ],
    "bytecode": "0x608060405234801561001057600080fd5b50604051610214380380610214833981810160405281019061003291906100bd565b80600081905550506100f8565b600080fd5b600080600060003373ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000206000018190555080830190808211156100b7576000828202808211156100b757fe5b9060200190a1505050565b6000602082840312156100ce57600080fd5b5035919050565b63461cb28160e01b81526004018080602001828103825260178152602001807f4e6f74205269736b4d616e616765720000000000000000000000000000000000815250600091019061012b565b600081519050919050565b6101c581610134565b82525050565b60006020820190506001600083018460405180828051906020019080838360005b83811015610170578082015181840152602001835260200182810190508083111561017057fe5b50505050905090810190601f16801561019d57808203815260200180519050905090565b505056fea2646970667358221220a2e0a2d2122f872c3d9a105c938b819f72365bb7e1d52d3a3d540242207b1a6264736f6c63430008140033"
};

ethers.ContractFactory.getContractFactory = async (name, signer) => {
    if (name === "MockERC20") {
        const factory = new ethers.ContractFactory(MockERC20Artifact.abi, MockERC20Artifact.bytecode, signer);
        return factory;
    }
    if (name === "MaliciousPoolRegistry") {
        const factory = new ethers.ContractFactory(MaliciousPoolRegistryArtifact.abi, MaliciousPoolRegistryArtifact.bytecode, signer);
        return factory;
    }
    const hardhatEthers = require("hardhat").ethers;
    return hardhatEthers.getContractFactory(name, signer);
};

// We need a simple contract artifact for the re-entrancy test
const fs = require('fs');
const path = require('path');
const maliciousContractSource = `
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
        // Re-enter
        IRiskManager(riskManager).allocateCapital(new uint256[](0));
    }
    function getPoolCount() external pure returns (uint256) {
        return 1;
    }
}
`;
// Create the contract file so Hardhat can compile it
fs.writeFileSync(path.join(__dirname, "..", "contracts", "MaliciousPoolRegistry.sol"), maliciousContractSource);
