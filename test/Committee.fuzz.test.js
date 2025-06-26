const { expect } = require("chai");
const { ethers } = require("hardhat");
const fc = require("fast-check");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const MockERC20 = "contracts/test/MockERC20.sol:MockERC20";
const MockRiskManager = "contracts/test/MockCommitteeRiskManager.sol:MockCommitteeRiskManager";
const MockStaking = "contracts/test/MockCommitteeStaking.sol:MockCommitteeStaking";

describe("CommitteeFuzz", function () {
    let owner, riskManager, proposer, voter1;
    let committee, mockRiskManager, mockStakingContract, mockGovToken;

    const POOL_ID = 1;
    const VOTING_PERIOD = 7 * 24 * 60 * 60;
    const CHALLENGE_PERIOD = 7 * 24 * 60 * 60;
    const QUORUM_BPS = 4000;
    const SLASH_BPS = 500;

    beforeEach(async function () {
        [owner, riskManager, proposer, voter1] = await ethers.getSigners();

        const ERC20Factory = await ethers.getContractFactory(MockERC20);
        mockGovToken = await ERC20Factory.deploy("Gov", "GOV", 18);

        const StakingFactory = await ethers.getContractFactory(MockStaking);
        mockStakingContract = await StakingFactory.deploy(mockGovToken.target);

        const RiskManagerFactory = await ethers.getContractFactory(MockRiskManager);
        mockRiskManager = await RiskManagerFactory.deploy();

        const CommitteeFactory = await ethers.getContractFactory("Committee");
        committee = await CommitteeFactory.deploy(
            mockRiskManager.target,
            mockStakingContract.target,
            VOTING_PERIOD,
            CHALLENGE_PERIOD,
            QUORUM_BPS,
            SLASH_BPS
        );

        for (const user of [proposer, voter1]) {
            await mockGovToken.mint(user.address, ethers.parseEther("5000"));
            await mockGovToken.connect(user).approve(committee.target, ethers.MaxUint256);
        }

        await mockGovToken.mint(mockStakingContract.target, ethers.parseEther("10000"));
    });

    it("fuzzes proposal creation with varying bonds", async function () {
        const min = await committee.minBondAmount();
        const max = await committee.maxBondAmount();
        await fc.assert(
            fc.asyncProperty(fc.bigUintN(256).filter(b => b >= min && b <= max), async (bond) => {
                await mockStakingContract.setBalance(proposer.address, ethers.parseEther("1000"));
                await committee.connect(proposer).createProposal(POOL_ID, 1, bond);
                const proposal = await committee.proposals(1n);
                expect(proposal.bondAmount).to.equal(bond);
                // reset for next iteration
                await committee.connect(owner).updateVoteWeight(proposer.address, 1, 0).catch(() => {});
            }),
            { numRuns: 1 }
        );
    });

    it("fuzzes vote weight updates", async function () {
        await fc.assert(
            fc.asyncProperty(fc.bigUintN(96), fc.bigUintN(96), async (start, updated) => {
                await mockStakingContract.setBalance(proposer.address, start);
                await committee.connect(proposer).createProposal(POOL_ID, 1, await committee.minBondAmount());
                await committee.connect(proposer).vote(1, 2);
                await mockStakingContract.callUpdateWeight(committee.target, proposer.address, 1, updated);
                const proposal = await committee.proposals(1n);
                expect(proposal.forVotes).to.equal(updated);
            }),
            { numRuns: 1 }
        );
    });

    it("fuzzes reward distribution", async function () {
        const reward = ethers.parseEther("1");
        await fc.assert(
            fc.asyncProperty(fc.bigUintN(96), fc.bigUintN(96), async (w1, w2) => {
                fc.pre(w1 > 0n && w2 > 0n);
                await mockStakingContract.setBalance(proposer.address, w1);
                await mockStakingContract.setBalance(voter1.address, w2);

                await committee.connect(proposer).createProposal(POOL_ID, 1, await committee.minBondAmount());
                await committee.connect(proposer).vote(1, 2);
                await committee.connect(voter1).vote(1, 2);

                await time.increase(VOTING_PERIOD + 1);
                await committee.executeProposal(1);

                await mockRiskManager.sendFees(committee.target, 1, { value: reward });

                await time.increase(CHALLENGE_PERIOD + 1);
                await committee.resolvePauseBond(1);

                const beforeP = await ethers.provider.getBalance(proposer);
                await committee.connect(proposer).claimReward(1);
                const afterP = await ethers.provider.getBalance(proposer);

                const beforeV = await ethers.provider.getBalance(voter1);
                await committee.connect(voter1).claimReward(1);
                const afterV = await ethers.provider.getBalance(voter1);

                const diff = afterP - beforeP + afterV - beforeV;
                expect(diff).to.equal(reward);
            }),
            { numRuns: 1 }
        );
    });
});
