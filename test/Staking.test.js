// test/StakingContract.test.js

const { expect } = require("chai");
const { ethers } = require("hardhat");

// Helper function to create mock contracts from an ABI
async function deployMock(abi, signer) {
    const factory = new ethers.ContractFactory(abi, `0x${'6080604052348015600f57600080fd5b50600080fdfe'}`, signer);
    return await factory.deploy();
}

describe("StakingContract", function () {
    // --- Signers ---
    let owner, committee, staker1, staker2, nonParty;

    // --- Contracts ---
    let stakingContract, StakingContractFactory;
    let mockGovToken;
    
    // --- Mock ABIs ---
    const erc20Abi = require("@openzeppelin/contracts/build/contracts/ERC20.json").abi;

    beforeEach(async function () {
        // --- Get Signers ---
        [owner, committee, staker1, staker2, nonParty] = await ethers.getSigners();
        
        // --- Deploy Mocks ---
        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        mockGovToken = await MockERC20Factory.deploy("Governance Token", "GOV", ethers.parseEther("1000000"));

        // --- Deploy StakingContract ---
        StakingContractFactory = await ethers.getContractFactory("StakingContract");
        stakingContract = await StakingContractFactory.deploy(mockGovToken.target, owner.address);

        // --- Initial Setup ---
        // Fund stakers with governance tokens
        await mockGovToken.transfer(staker1.address, ethers.parseEther("1000"));
        await mockGovToken.transfer(staker2.address, ethers.parseEther("1000"));
        
        // Approve StakingContract to spend tokens
        await mockGovToken.connect(staker1).approve(stakingContract.target, ethers.MaxUint256);
        await mockGovToken.connect(staker2).approve(stakingContract.target, ethers.MaxUint256);
    });

    describe("Deployment and Constructor", function() {
        it("Should deploy with the correct owner and governance token", async function() {
            expect(await stakingContract.owner()).to.equal(owner.address);
            expect(await stakingContract.governanceToken()).to.equal(mockGovToken.target);
        });

        it("Should revert on deployment if governance token is the zero address", async function() {
            await expect(StakingContractFactory.deploy(ethers.ZeroAddress, owner.address))
                .to.be.revertedWithCustomError(stakingContract, "ZeroAddress");
        });
    });

    describe("Admin Functions", function() {
        it("Should allow the owner to set the committee address", async function() {
            await expect(stakingContract.connect(owner).setCommitteeAddress(committee.address))
                .to.emit(stakingContract, "CommitteeAddressSet").withArgs(committee.address);
            expect(await stakingContract.committeeAddress()).to.equal(committee.address);
        });

        it("Should prevent non-owner from setting the committee address", async function() {
            await expect(stakingContract.connect(nonParty).setCommitteeAddress(committee.address))
                .to.be.revertedWithCustomError(stakingContract, "OwnableUnauthorizedAccount");
        });

        it("Should prevent setting the committee address to the zero address", async function() {
            await expect(stakingContract.connect(owner).setCommitteeAddress(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(stakingContract, "ZeroAddress");
        });
        
        it("Should prevent setting the committee address more than once", async function() {
            await stakingContract.connect(owner).setCommitteeAddress(committee.address);
            await expect(stakingContract.connect(owner).setCommitteeAddress(nonParty.address))
                .to.be.revertedWith("Committee address already set");
        });
    });

    describe("Staking", function() {
        const STAKE_AMOUNT = ethers.parseEther("100");

        it("Should allow a user to stake governance tokens", async function() {
            await expect(stakingContract.connect(staker1).stake(STAKE_AMOUNT))
                .to.emit(stakingContract, "Staked").withArgs(staker1.address, STAKE_AMOUNT);

            expect(await stakingContract.stakedBalance(staker1.address)).to.equal(STAKE_AMOUNT);
            expect(await stakingContract.totalStaked()).to.equal(STAKE_AMOUNT);
            expect(await mockGovToken.balanceOf(stakingContract.target)).to.equal(STAKE_AMOUNT);
        });
        
        it("Should allow a user to stake multiple times, accumulating their balance", async function() {
            await stakingContract.connect(staker1).stake(STAKE_AMOUNT);
            await stakingContract.connect(staker1).stake(STAKE_AMOUNT);

            expect(await stakingContract.stakedBalance(staker1.address)).to.equal(STAKE_AMOUNT * 2n);
            expect(await stakingContract.totalStaked()).to.equal(STAKE_AMOUNT * 2n);
        });

        it("Should revert if staking zero amount", async function() {
            await expect(stakingContract.connect(staker1).stake(0))
                .to.be.revertedWithCustomError(stakingContract, "InvalidAmount");
        });
    });

    describe("Unstaking", function() {
        const STAKE_AMOUNT = ethers.parseEther("100");

        beforeEach(async function() {
            await stakingContract.connect(staker1).stake(STAKE_AMOUNT);
        });

        it("Should allow a user to unstake their full balance", async function() {
            const initialUserBalance = await mockGovToken.balanceOf(staker1.address);

            await expect(stakingContract.connect(staker1).unstake(STAKE_AMOUNT))
                .to.emit(stakingContract, "Unstaked").withArgs(staker1.address, STAKE_AMOUNT);

            expect(await stakingContract.stakedBalance(staker1.address)).to.equal(0);
            expect(await stakingContract.totalStaked()).to.equal(0);
            expect(await mockGovToken.balanceOf(staker1.address)).to.equal(initialUserBalance + STAKE_AMOUNT);
        });

        it("Should allow a user to unstake a partial balance", async function() {
            const unstakeAmount = STAKE_AMOUNT / 2n;
            await stakingContract.connect(staker1).unstake(unstakeAmount);

            expect(await stakingContract.stakedBalance(staker1.address)).to.equal(unstakeAmount);
            expect(await stakingContract.totalStaked()).to.equal(unstakeAmount);
        });

        it("Should revert if unstaking zero amount", async function() {
            await expect(stakingContract.connect(staker1).unstake(0))
                .to.be.revertedWithCustomError(stakingContract, "InvalidAmount");
        });

        it("Should revert if unstaking more than the staked balance", async function() {
            await expect(stakingContract.connect(staker1).unstake(STAKE_AMOUNT + 1n))
                .to.be.revertedWithCustomError(stakingContract, "InsufficientStakedBalance");
        });

        it("Should revert if a user with no stake tries to unstake", async function() {
            await expect(stakingContract.connect(staker2).unstake(1))
                .to.be.revertedWithCustomError(stakingContract, "InsufficientStakedBalance");
        });
    });

    describe("Slashing", function() {
        const STAKE_AMOUNT = ethers.parseEther("100");
        const SLASH_AMOUNT = ethers.parseEther("40");

        beforeEach(async function() {
            await stakingContract.connect(owner).setCommitteeAddress(committee.address);
            await stakingContract.connect(staker1).stake(STAKE_AMOUNT);
        });
        
        it("Should allow the committee to slash a user's stake", async function() {
            const initialCommitteeBalance = await mockGovToken.balanceOf(committee.address);

            await stakingContract.connect(committee).slash(staker1.address, SLASH_AMOUNT);
            
            expect(await stakingContract.stakedBalance(staker1.address)).to.equal(STAKE_AMOUNT - SLASH_AMOUNT);
            expect(await stakingContract.totalStaked()).to.equal(STAKE_AMOUNT - SLASH_AMOUNT);
            expect(await mockGovToken.balanceOf(committee.address)).to.equal(initialCommitteeBalance + SLASH_AMOUNT);
        });
        
        it("Should revert if a non-committee address tries to slash", async function() {
            await expect(stakingContract.connect(nonParty).slash(staker1.address, SLASH_AMOUNT))
                .to.be.revertedWithCustomError(stakingContract, "NotCommittee");
        });

        it("Should revert if slashing more than the user has staked", async function() {
            await expect(stakingContract.connect(committee).slash(staker1.address, STAKE_AMOUNT + 1n))
                .to.be.revertedWithCustomError(stakingContract, "InsufficientStakedBalance");
        });

        it("Should revert if slashing zero amount", async function() {
            await expect(stakingContract.connect(committee).slash(staker1.address, 0))
                .to.be.revertedWithCustomError(stakingContract, "InvalidAmount");
        });

        it("Should revert if slashing a user with no stake", async function() {
            await expect(stakingContract.connect(committee).slash(staker2.address, 1))
                .to.be.revertedWithCustomError(stakingContract, "InsufficientStakedBalance");
        });
    });

    describe("Complex User Journeys", function() {
        const STAKE_1 = ethers.parseEther("100");
        const STAKE_2 = ethers.parseEther("50");
        const UNSTAKE_1 = ethers.parseEther("30");
        const SLASH_1 = ethers.parseEther("20");

        it("Should handle a stake -> partial unstake -> stake again flow correctly", async function() {
            // 1. Stake
            await stakingContract.connect(staker1).stake(STAKE_1);
            expect(await stakingContract.stakedBalance(staker1.address)).to.equal(STAKE_1);

            // 2. Partial unstake
            await stakingContract.connect(staker1).unstake(UNSTAKE_1);
            expect(await stakingContract.stakedBalance(staker1.address)).to.equal(STAKE_1 - UNSTAKE_1);

            // 3. Stake again
            await stakingContract.connect(staker1).stake(STAKE_2);
            const expectedFinalBalance = STAKE_1 - UNSTAKE_1 + STAKE_2;
            expect(await stakingContract.stakedBalance(staker1.address)).to.equal(expectedFinalBalance);
            expect(await stakingContract.totalStaked()).to.equal(expectedFinalBalance);
        });

        it("Should handle a stake -> partial slash -> unstake flow correctly", async function() {
            await stakingContract.connect(owner).setCommitteeAddress(committee.address);
            
            // 1. Stake
            await stakingContract.connect(staker1).stake(STAKE_1);

            // 2. Partial slash
            await stakingContract.connect(committee).slash(staker1.address, SLASH_1);
            const balanceAfterSlash = STAKE_1 - SLASH_1;
            expect(await stakingContract.stakedBalance(staker1.address)).to.equal(balanceAfterSlash);
            
            // 3. Unstake remaining
            await stakingContract.connect(staker1).unstake(balanceAfterSlash);
            expect(await stakingContract.stakedBalance(staker1.address)).to.equal(0);
            expect(await stakingContract.totalStaked()).to.equal(0);
        });
    });

    describe("ERC20 Interaction Failures", function() {
        let maliciousToken, failingStakingContract;

        beforeEach(async function() {
            // Deploy a malicious token that can be configured to fail
            const MaliciousERC20Factory = await ethers.getContractFactory("MaliciousERC20");
            maliciousToken = await MaliciousERC20Factory.deploy("Malicious Token", "BAD");
            
            // Deploy a new StakingContract instance linked to the malicious token
            failingStakingContract = await StakingContractFactory.deploy(maliciousToken.target, owner.address);

            // Setup user with malicious tokens and approve contract
            await maliciousToken.mint(staker1.address, ethers.parseEther("1000"));
            await maliciousToken.connect(staker1).approve(failingStakingContract.target, ethers.MaxUint256);
        });

        it("Should revert stake if token transferFrom fails", async function() {
            await maliciousToken.setFailTransferFrom(true);
            await expect(failingStakingContract.connect(staker1).stake(ethers.parseEther("100")))
                .to.be.revertedWith("MaliciousERC20: transferFrom failed");
            
            // Ensure state was not updated
            expect(await failingStakingContract.stakedBalance(staker1.address)).to.equal(0);
            expect(await failingStakingContract.totalStaked()).to.equal(0);
        });
        
        it("Should revert unstake if token transfer fails", async function() {
            // First, a successful stake
            await failingStakingContract.connect(staker1).stake(ethers.parseEther("100"));

            // Now, make the next transfer fail
            await maliciousToken.setFailTransfer(true);
            await expect(failingStakingContract.connect(staker1).unstake(ethers.parseEther("100")))
                .to.be.revertedWith("MaliciousERC20: transfer failed");
            
            // Ensure state was not reverted (as this is an OpenZeppelin SafeERC20 check)
            // But the user did not receive their tokens. This highlights the importance of the check.
            // The state IS changed before the transfer, so this test shows that if the transfer fails,
            // the user loses their internal balance record without getting tokens back.
            // THIS IS A KEY INSIGHT: The contract should use a re-entrancy guard and a pull pattern for unstaking, or a check-effect-interaction pattern for more robustness if the token could be malicious.
            // However, for standard ERC20s, SafeERC20's revert is the expected behavior.
            expect(await failingStakingContract.stakedBalance(staker1.address)).to.equal(0);
        });
        
        it("Should revert slash if token transfer fails", async function() {
            await failingStakingContract.connect(owner).setCommitteeAddress(committee.address);
            await failingStakingContract.connect(staker1).stake(ethers.parseEther("100"));
            
            await maliciousToken.setFailTransfer(true);
            await expect(failingStakingContract.connect(committee).slash(staker1.address, ethers.parseEther("50")))
                .to.be.revertedWith("MaliciousERC20: transfer failed");
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

const MaliciousERC20Artifact = {
    "contractName": "MaliciousERC20",
    "abi": [
      {"inputs":[{"internalType":"string","name":"name","type":"string"},{"internalType":"string","name":"symbol","type":"string"}],"stateMutability":"nonpayable","type":"constructor"},
      {"inputs":[{"internalType":"address","name":"spender","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"approve","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},
      {"inputs":[{"internalType":"address","name":"account","type":"address"}],"name":"balanceOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
      {"inputs":[{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"mint","outputs":[],"stateMutability":"nonpayable","type":"function"},
      {"inputs":[{"internalType":"bool","name":"_fail","type":"bool"}],"name":"setFailTransfer","outputs":[],"stateMutability":"nonpayable","type":"function"},
      {"inputs":[{"internalType":"bool","name":"_fail","type":"bool"}],"name":"setFailTransferFrom","outputs":[],"stateMutability":"nonpayable","type":"function"},
      {"inputs":[{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},
      {"inputs":[{"internalType":"address","name":"from","type":"address"},{"internalType":"address","name":"to","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"}],"name":"transferFrom","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"}
    ]
};

ethers.ContractFactory.getContractFactory = async (name, signer) => {
    if (name === "MockERC20") {
        const factory = new ethers.ContractFactory(MockERC20Artifact.abi, MockERC20Artifact.bytecode, signer);
        return factory;
    }
    if (name === "MaliciousERC20") {
        const factory = new ethers.ContractFactory(MaliciousERC20Artifact.abi, MaliciousERC20Artifact.bytecode, signer);
        return factory;
    }
    const hardhatEthers = require("hardhat").ethers;
    return hardhatEthers.getContractFactory(name, signer);
};

// Helper contract for ERC20 failure tests
const fs = require('fs');
const path = require('path');
const maliciousERC20Source = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract MaliciousERC20 is ERC20 {
    bool public failTransfer = false;
    bool public failTransferFrom = false;
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function setFailTransfer(bool _fail) public {
        failTransfer = _fail;
    }
    function setFailTransferFrom(bool _fail) public {
        failTransferFrom = _fail;
    }
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
    function transfer(address to, uint256 amount) public override returns (bool) {
        require(!failTransfer, "MaliciousERC20: transfer failed");
        return super.transfer(to, amount);
    }
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        require(!failTransferFrom, "MaliciousERC20: transferFrom failed");
        return super.transferFrom(from, to, amount);
    }
}
`;
fs.writeFileSync(path.join(__dirname, "..", "contracts", "MaliciousERC20.sol"), maliciousERC20Source);