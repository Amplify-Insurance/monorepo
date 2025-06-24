const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const GovToken = "contracts/tokens/CatShare.sol:CatShare";
const RiskManager = "contracts/core/RiskManager.sol:RiskManager";
const PoolRegistry = "contracts/core/PoolRegistry.sol:PoolRegistry";
const CapitalPool = "contracts/core/CapitalPool.sol:CapitalPool";
const CatInsurancePool = "contracts/external/CatInsurancePool.sol:CatInsurancePool";
const LossDistributor = "contracts/utils/LossDistributor.sol:LossDistributor";
const RewardDistributor = "contracts/utils/RewardDistributor.sol:RewardDistributor";
const PolicyNFT = "contracts/tokens/PolicyNFT.sol:PolicyNFT";
const PolicyManager = "contracts/core/PolicyManager.sol:PolicyManager";

// Integration tests exercising Committee with the real StakingContract

describe("Committee Integration", function () {
    const VOTING_PERIOD = 7 * 24 * 60 * 60; // 7 days
    const CHALLENGE_PERIOD = 7 * 24 * 60 * 60; // 7 days
    const QUORUM_BPS = 4000;
    const SLASH_BPS = 500;
    const BOND = ethers.parseEther("1000");

    let owner, proposer, voter, nonStaker;
    let govToken, staking, riskManager, committee, poolRegistry;

    async function deployFixture() {
        [owner, proposer, voter, nonStaker] = await ethers.getSigners();

        const Token = await ethers.getContractFactory(GovToken);
        govToken = await Token.deploy();

        const usdc = await Token.deploy();

        const StakingFactory = await ethers.getContractFactory("StakingContract");
        staking = await StakingFactory.deploy(govToken.target, owner.address);

        const RMFactory = await ethers.getContractFactory(RiskManager);
        riskManager = await RMFactory.deploy(owner.address);

        const RegistryFactory = await ethers.getContractFactory(PoolRegistry);
        poolRegistry = await RegistryFactory.deploy(owner.address, riskManager.target);

        const CapitalPoolFactory = await ethers.getContractFactory(CapitalPool);
        const capitalPool = await CapitalPoolFactory.deploy(owner.address, usdc.target);

        const CatPoolFactory = await ethers.getContractFactory(CatInsurancePool);
        const catPool = await CatPoolFactory.deploy(usdc.target, govToken.target, ethers.ZeroAddress, owner.address);

        const LossFactory = await ethers.getContractFactory(LossDistributor);
        const lossDistributor = await LossFactory.deploy(riskManager.target);

        const RewardFactory = await ethers.getContractFactory(RewardDistributor);
        const rewardDistributor = await RewardFactory.deploy(riskManager.target);
        await rewardDistributor.setCatPool(catPool.target);

        const NFTFactory = await ethers.getContractFactory(PolicyNFT);
        const policyNFT = await NFTFactory.deploy(owner.address, owner.address);

        const PMFactory = await ethers.getContractFactory(PolicyManager);
        const policyManager = await PMFactory.deploy(policyNFT.target, owner.address);
        await policyNFT.setPolicyManagerAddress(policyManager.target);

        await riskManager.setAddresses(
            capitalPool.target,
            poolRegistry.target,
            policyManager.target,
            catPool.target,
            lossDistributor.target,
            rewardDistributor.target
        );

        const CommitteeFactory = await ethers.getContractFactory("Committee");
        committee = await CommitteeFactory.deploy(
            riskManager.target,
            staking.target,
            VOTING_PERIOD,
            CHALLENGE_PERIOD,
            QUORUM_BPS,
            SLASH_BPS
        );

        await staking.setCommitteeAddress(committee.target);
        await riskManager.setCommittee(committee.target);

        const rate = { base: 0, slope1: 0, slope2: 0, kink: 0 };
        await riskManager.addProtocolRiskPool(usdc.target, rate, 0);
        await riskManager.addProtocolRiskPool(usdc.target, rate, 0);

        for (const user of [proposer, voter, nonStaker]) {
            await govToken.mint(user.address, ethers.parseEther("2000"));
            await govToken.connect(user).approve(staking.target, ethers.MaxUint256);
            await govToken.connect(user).approve(committee.target, ethers.MaxUint256);
        }

        await staking.connect(proposer).stake(ethers.parseEther("1000"));
        await staking.connect(voter).stake(ethers.parseEther("500"));

        return { owner, proposer, voter, nonStaker };
    }

    it("locks stake after voting until proposal finalized", async function () {
        await loadFixture(deployFixture);
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
        const [, , , , isPaused, feeRecipient] = await poolRegistry.getPoolData(1);
        expect(isPaused).to.equal(true);
        expect(feeRecipient).to.equal(committee.target);

        await expect(staking.connect(proposer).unstake(ethers.parseEther("1000")))
            .to.emit(staking, "Unstaked").withArgs(proposer.address, ethers.parseEther("1000"));
        await expect(staking.connect(voter).unstake(ethers.parseEther("500")))
            .to.emit(staking, "Unstaked").withArgs(voter.address, ethers.parseEther("500"));
    });

    it("distributes rewards using stake weight", async function () {
        await loadFixture(deployFixture);
        await committee.connect(proposer).createProposal(1, 1, BOND);
        await committee.connect(proposer).vote(1, 2);
        await committee.connect(voter).vote(1, 2);

        await time.increase(VOTING_PERIOD + 1);
        await committee.executeProposal(1);
        await ethers.provider.send("hardhat_impersonateAccount", [riskManager.target]);
        await ethers.provider.send("hardhat_setBalance", [riskManager.target, "0x1000000000000000000"]);
        const rm = await ethers.getSigner(riskManager.target);
        await committee.connect(rm).receiveFees(1, { value: ethers.parseEther("5") });
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);
        await time.increase(CHALLENGE_PERIOD + 1);
        await committee.resolvePauseBond(1);

        const propBalBefore = await ethers.provider.getBalance(proposer.address);
        await committee.connect(proposer).claimReward(1);
        expect(await ethers.provider.getBalance(proposer.address)).to.be.gt(propBalBefore);
    });

    it("clears active proposal after unpause execution", async function () {
        await loadFixture(deployFixture);
        await committee.connect(proposer).createProposal(1, 0, 0);
        await committee.connect(proposer).vote(1, 2);

        await time.increase(VOTING_PERIOD + 1);
        await committee.executeProposal(1);

        expect(await committee.activeProposalForPool(1)).to.equal(false);
        expect(await committee.isProposalFinalized(1)).to.equal(true);
        const [, , , , isPaused] = await poolRegistry.getPoolData(1);
        expect(isPaused).to.equal(false);
    });

    it("returns bond when fees are received", async function () {
        await loadFixture(deployFixture);
        await committee.connect(proposer).createProposal(1, 1, BOND);
        await committee.connect(proposer).vote(1, 2);
        await committee.connect(voter).vote(1, 2);

        await time.increase(VOTING_PERIOD + 1);
        await committee.executeProposal(1);
        await ethers.provider.send("hardhat_impersonateAccount", [riskManager.target]);
        await ethers.provider.send("hardhat_setBalance", [riskManager.target, "0x1000000000000000000"]);
        const rm = await ethers.getSigner(riskManager.target);
        await committee.connect(rm).receiveFees(1, { value: ethers.parseEther("1") });
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);
        await time.increase(CHALLENGE_PERIOD + 1);

        const before = await govToken.balanceOf(proposer.address);
        await expect(committee.resolvePauseBond(1))
            .to.emit(committee, "BondResolved").withArgs(1, false);
        const after = await govToken.balanceOf(proposer.address);

        expect(after - before).to.equal(BOND);
        expect(await committee.activeProposalForPool(1)).to.equal(false);
    });

    it("slashes bond when no fees are received", async function () {
        await loadFixture(deployFixture);
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
        await loadFixture(deployFixture);
        await expect(
            committee.connect(nonStaker).createProposal(2, 1, BOND)
        ).to.be.revertedWith("Must be a staker");
    });

    it("reverts when unpause proposal includes a bond", async function () {
        await loadFixture(deployFixture);
        await expect(
            committee.connect(proposer).createProposal(2, 0, BOND)
        ).to.be.revertedWith("No bond for unpause");
    });

    it("reverts when creating a second proposal for the same pool", async function () {
        await loadFixture(deployFixture);
        await committee.connect(proposer).createProposal(1, 1, BOND);
        await expect(
            committee.connect(voter).createProposal(1, 1, BOND)
        ).to.be.revertedWith("Proposal already exists");
    });

    it("defeats proposal if quorum not met", async function () {
        await loadFixture(deployFixture);
        await committee.connect(voter).createProposal(1, 1, BOND);
        await committee.connect(voter).vote(1, 2);

        await time.increase(VOTING_PERIOD + 1);
        await committee.executeProposal(1);

        const proposal = await committee.proposals(1);
        expect(proposal.status).to.equal(3); // Defeated
        expect(await committee.activeProposalForPool(1)).to.equal(false);

        const refund = BOND - (BOND * BigInt(SLASH_BPS) / 10000n);
        expect(await govToken.balanceOf(voter.address)).to.equal(
            ethers.parseEther("2000") - ethers.parseEther("500") - BOND + refund
        );
    });

    it("defeats proposal on tie vote", async function () {
        await loadFixture(deployFixture);
        await staking.connect(nonStaker).stake(ethers.parseEther("1000"));

        await committee.connect(proposer).createProposal(1, 1, BOND);
        await committee.connect(proposer).vote(1, 2);
        await committee.connect(nonStaker).vote(1, 1);

        await time.increase(VOTING_PERIOD + 1);
        await committee.executeProposal(1);

        const proposal = await committee.proposals(1);
        expect(proposal.status).to.equal(3); // Defeated
        expect(await committee.activeProposalForPool(1)).to.equal(false);
    });

    it("reverts if executing before the voting period ends", async function () {
        await loadFixture(deployFixture);
        await committee.connect(proposer).createProposal(1, 1, BOND);
        await expect(committee.executeProposal(1)).to.be.revertedWith("Voting not over");
    });

    it("only allows RiskManager to call receiveFees", async function () {
        await loadFixture(deployFixture);
        await committee.connect(proposer).createProposal(1, 1, BOND);
        await expect(
            committee.connect(proposer).receiveFees(1, { value: ethers.parseEther("1") })
        ).to.be.revertedWith("Committee: Not RiskManager");
    });

    it("reverts reward claim for non 'For' voter", async function () {
        await loadFixture(deployFixture);
        await committee.connect(proposer).createProposal(1, 1, BOND);
        await committee.connect(proposer).vote(1, 2);
        await committee.connect(voter).vote(1, 2);
        await committee.connect(nonStaker).vote(1, 1);

        await time.increase(VOTING_PERIOD + 1);
        await committee.executeProposal(1);
        await ethers.provider.send("hardhat_impersonateAccount", [riskManager.target]);
        await ethers.provider.send("hardhat_setBalance", [riskManager.target, "0x1000000000000000000"]);
        const rm = await ethers.getSigner(riskManager.target);
        await committee.connect(rm).receiveFees(1, { value: ethers.parseEther("1") });
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);
        await time.increase(CHALLENGE_PERIOD + 1);
        await committee.resolvePauseBond(1);

        await expect(
            committee.connect(nonStaker).claimReward(1)
        ).to.be.revertedWith("Must have voted 'For' to claim rewards");
    });

    it("updates vote weight when unstaking mid-vote", async function () {
        const UNSTAKE_LOCK_PERIOD = 7 * 24 * 60 * 60; // from StakingContract

        async function deployLongVotingFixture() {
            const LONG_VOTING_PERIOD = VOTING_PERIOD * 2;
            [owner, proposer, voter, nonStaker] = await ethers.getSigners();

            const Token = await ethers.getContractFactory(GovToken);
            govToken = await Token.deploy();

            const usdc = await Token.deploy();

            const StakingFactory = await ethers.getContractFactory("StakingContract");
            staking = await StakingFactory.deploy(govToken.target, owner.address);

            const RMFactory = await ethers.getContractFactory(RiskManager);
            riskManager = await RMFactory.deploy(owner.address);

            const RegistryFactory = await ethers.getContractFactory(PoolRegistry);
            poolRegistry = await RegistryFactory.deploy(owner.address, riskManager.target);

            const CapitalPoolFactory = await ethers.getContractFactory(CapitalPool);
            const capitalPool = await CapitalPoolFactory.deploy(owner.address, usdc.target);

            const CatPoolFactory = await ethers.getContractFactory(CatInsurancePool);
            const catPool = await CatPoolFactory.deploy(usdc.target, govToken.target, ethers.ZeroAddress, owner.address);

            const LossFactory = await ethers.getContractFactory(LossDistributor);
            const lossDistributor = await LossFactory.deploy(riskManager.target);

            const RewardFactory = await ethers.getContractFactory(RewardDistributor);
            const rewardDistributor = await RewardFactory.deploy(riskManager.target);
            await rewardDistributor.setCatPool(catPool.target);

            const NFTFactory = await ethers.getContractFactory(PolicyNFT);
            const policyNFT = await NFTFactory.deploy(owner.address, owner.address);

            const PMFactory = await ethers.getContractFactory(PolicyManager);
            const policyManager = await PMFactory.deploy(policyNFT.target, owner.address);
            await policyNFT.setPolicyManagerAddress(policyManager.target);

            await riskManager.setAddresses(
                capitalPool.target,
                poolRegistry.target,
                policyManager.target,
                catPool.target,
                lossDistributor.target,
                rewardDistributor.target
            );

            const CommitteeFactory = await ethers.getContractFactory("Committee");
            committee = await CommitteeFactory.deploy(
                riskManager.target,
                staking.target,
                LONG_VOTING_PERIOD,
                CHALLENGE_PERIOD,
                QUORUM_BPS,
                SLASH_BPS
            );

            await staking.setCommitteeAddress(committee.target);
            await riskManager.setCommittee(committee.target);

            const rate = { base: 0, slope1: 0, slope2: 0, kink: 0 };
            await riskManager.addProtocolRiskPool(usdc.target, rate, 0);
            await riskManager.addProtocolRiskPool(usdc.target, rate, 0);

            for (const user of [proposer, voter, nonStaker]) {
                await govToken.mint(user.address, ethers.parseEther("2000"));
                await govToken.connect(user).approve(staking.target, ethers.MaxUint256);
                await govToken.connect(user).approve(committee.target, ethers.MaxUint256);
            }

            await staking.connect(proposer).stake(ethers.parseEther("1000"));
            await staking.connect(voter).stake(ethers.parseEther("500"));

            return { proposer };
        }

        await loadFixture(deployLongVotingFixture);
        await committee.connect(proposer).createProposal(1, 0, 0);
        await committee.connect(proposer).vote(1, 2);

        const before = await committee.proposals(1);
        expect(before.forVotes).to.equal(ethers.parseEther("1000"));

        await time.increase(UNSTAKE_LOCK_PERIOD + 1);
        await staking.connect(proposer).unstake(ethers.parseEther("500"));

        const after = await committee.proposals(1);
        expect(after.forVotes).to.equal(ethers.parseEther("500"));
    });

    it("accumulates multiple fee deposits", async function () {
        await loadFixture(deployFixture);
        await committee.connect(proposer).createProposal(1, 1, BOND);
        await committee.connect(proposer).vote(1, 2);

        await time.increase(VOTING_PERIOD + 1);
        await committee.executeProposal(1);

        await ethers.provider.send("hardhat_impersonateAccount", [riskManager.target]);
        await ethers.provider.send("hardhat_setBalance", [riskManager.target, "0x1000000000000000000"]);
        const rm = await ethers.getSigner(riskManager.target);
        await committee.connect(rm).receiveFees(1, { value: ethers.parseEther("1") });
        await committee.connect(rm).receiveFees(1, { value: ethers.parseEther("2") });
        await ethers.provider.send("hardhat_stopImpersonatingAccount", [riskManager.target]);

        await time.increase(CHALLENGE_PERIOD + 1);
        await committee.resolvePauseBond(1);

        const proposal = await committee.proposals(1);
        expect(proposal.totalRewardFees).to.equal(ethers.parseEther("3"));
    });

    it("reverts when bond amount outside range", async function () {
        await loadFixture(deployFixture);
        await expect(
            committee.connect(proposer).createProposal(1, 1, BOND - 1n)
        ).to.be.revertedWith("Invalid bond");
        await expect(
            committee.connect(proposer).createProposal(1, 1, ethers.parseEther("2501"))
        ).to.be.revertedWith("Invalid bond");
    });
});
