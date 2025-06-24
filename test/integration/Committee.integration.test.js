const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const MockERC20 = "contracts/test/MockERC20.sol:MockERC20";
const MockRiskManager = "contracts/test/MockCommitteeRiskManager.sol:MockCommitteeRiskManager";

// Integration tests exercising Committee with the real StakingContract

describe("Committee Integration", function () {
    const VOTING_PERIOD = 7 * 24 * 60 * 60; // 7 days
    const CHALLENGE_PERIOD = 7 * 24 * 60 * 60; // 7 days
    const QUORUM_BPS = 4000;
    const SLASH_BPS = 500;
    const BOND = ethers.parseEther("1000");

    let owner, proposer, voter, nonStaker;
    let govToken, staking, riskManager, committee;

    beforeEach(async function () {
        [owner, proposer, voter, nonStaker] = await ethers.getSigners();

        const TokenFactory = await ethers.getContractFactory(MockERC20);
        govToken = await TokenFactory.deploy("Gov", "GOV", 18);

        const StakingFactory = await ethers.getContractFactory("StakingContract");
        staking = await StakingFactory.deploy(govToken.target, owner.address);

        const RiskFactory = await ethers.getContractFactory(MockRiskManager);
        riskManager = await RiskFactory.deploy();

        const CommitteeFactory = await ethers.getContractFactory("Committee");
        committee = await CommitteeFactory.deploy(
            riskManager.target,
            staking.target,
            VOTING_PERIOD,
            CHALLENGE_PERIOD,
            QUORUM_BPS,
            SLASH_BPS
        );

        await staking.connect(owner).setCommitteeAddress(committee.target);

        for (const user of [proposer, voter, nonStaker]) {
            await govToken.mint(user.address, ethers.parseEther("2000"));
            await govToken.connect(user).approve(staking.target, ethers.MaxUint256);
            await govToken.connect(user).approve(committee.target, ethers.MaxUint256);
        }

        await staking.connect(proposer).stake(ethers.parseEther("1000"));
        await staking.connect(voter).stake(ethers.parseEther("500"));
    });

    it("locks stake after voting until proposal finalized", async function () {
        await committee.connect(proposer).createProposal(1, 1, BOND);
        await committee.connect(proposer).vote(1, 2);
        await committee.connect(voter).vote(1, 2);

        expect(await staking.lastVotedProposal(proposer.address)).to.equal(1);
        expect(await staking.lastVotedProposal(voter.address)).to.equal(1);

        await expect(staking.connect(proposer).unstake(ethers.parseEther("1000")))
            .to.be.revertedWithCustomError(staking, "VoteLockActive");

        await time.increase(VOTING_PERIOD + 1);
        await committee.executeProposal(1);
        await time.increase(CHALLENGE_PERIOD + 1);
        await committee.resolvePauseBond(1);

        expect(await committee.isProposalFinalized(1)).to.equal(true);

        await expect(staking.connect(proposer).unstake(ethers.parseEther("1000")))
            .to.emit(staking, "Unstaked").withArgs(proposer.address, ethers.parseEther("1000"));
        await expect(staking.connect(voter).unstake(ethers.parseEther("500")))
            .to.emit(staking, "Unstaked").withArgs(voter.address, ethers.parseEther("500"));
    });

    it("distributes rewards using stake weight", async function () {
        await committee.connect(proposer).createProposal(1, 1, BOND);
        await committee.connect(proposer).vote(1, 2);
        await committee.connect(voter).vote(1, 2);

        await time.increase(VOTING_PERIOD + 1);
        await committee.executeProposal(1);
        await riskManager.sendFees(committee.target, 1, { value: ethers.parseEther("5") });
        await time.increase(CHALLENGE_PERIOD + 1);
        await committee.resolvePauseBond(1);

        const propBalBefore = await ethers.provider.getBalance(proposer.address);
        await committee.connect(proposer).claimReward(1);
        expect(await ethers.provider.getBalance(proposer.address)).to.be.gt(propBalBefore);
    });

    it("clears active proposal after unpause execution", async function () {
        await committee.connect(proposer).createProposal(1, 0, 0);
        await committee.connect(proposer).vote(1, 2);

        await time.increase(VOTING_PERIOD + 1);
        await committee.executeProposal(1);

        expect(await committee.activeProposalForPool(1)).to.equal(false);
        expect(await committee.isProposalFinalized(1)).to.equal(true);
    });

    it("returns bond when fees are received", async function () {
        await committee.connect(proposer).createProposal(1, 1, BOND);
        await committee.connect(proposer).vote(1, 2);
        await committee.connect(voter).vote(1, 2);

        await time.increase(VOTING_PERIOD + 1);
        await committee.executeProposal(1);
        await riskManager.sendFees(committee.target, 1, { value: ethers.parseEther("1") });
        await time.increase(CHALLENGE_PERIOD + 1);

        const before = await govToken.balanceOf(proposer.address);
        await expect(committee.resolvePauseBond(1))
            .to.emit(committee, "BondResolved").withArgs(1, false);
        const after = await govToken.balanceOf(proposer.address);

        expect(after - before).to.equal(BOND);
        expect(await committee.activeProposalForPool(1)).to.equal(false);
    });

    it("slashes bond when no fees are received", async function () {
        await committee.connect(proposer).createProposal(1, 1, BOND);
        await committee.connect(proposer).vote(1, 2);
        await committee.connect(voter).vote(1, 2);

        await time.increase(VOTING_PERIOD + 1);
        await committee.executeProposal(1);
        await time.increase(CHALLENGE_PERIOD + 1);

        const before = await govToken.balanceOf(proposer.address);
        await expect(committee.resolvePauseBond(1))
            .to.emit(committee, "BondResolved").withArgs(1, true);
        const after = await govToken.balanceOf(proposer.address);

        expect(after).to.equal(before); // bond was slashed
        expect(await committee.activeProposalForPool(1)).to.equal(false);
    });

    it("reverts when a non-staker tries to create a proposal", async function () {
        await expect(
            committee.connect(nonStaker).createProposal(2, 1, BOND)
        ).to.be.revertedWith("Must be a staker");
    });

    it("reverts when unpause proposal includes a bond", async function () {
        await expect(
            committee.connect(proposer).createProposal(2, 0, BOND)
        ).to.be.revertedWith("No bond for unpause");
    });

    it("reverts when creating a second proposal for the same pool", async function () {
        await committee.connect(proposer).createProposal(1, 1, BOND);
        await expect(
            committee.connect(voter).createProposal(1, 1, BOND)
        ).to.be.revertedWith("Proposal already exists");
    });

    it("reverts if executing before the voting period ends", async function () {
        await committee.connect(proposer).createProposal(1, 1, BOND);
        await expect(committee.executeProposal(1)).to.be.revertedWith("Voting not over");
    });
});
