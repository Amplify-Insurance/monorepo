const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const VOTING_PERIOD = 7 * 24 * 60 * 60; // 7 days
const CHALLENGE_PERIOD = 7 * 24 * 60 * 60; // 7 days
const QUORUM_BPS = 4000; // 40%
const SLASH_BPS = 500; // 5%
const UNSTAKE_LOCK_PERIOD = 7 * 24 * 60 * 60; // from StakingContract

async function deployFixture() {
  const [owner, , staker] = await ethers.getSigners();

  // Use real CatShare token instead of MockERC20
  const Token = await ethers.getContractFactory("CatShare");
  const token = await Token.deploy();

  const Staking = await ethers.getContractFactory("StakingContract");
  const staking = await Staking.deploy(token.target, owner.address);

  const RiskManager = await ethers.getContractFactory("RiskManager");
  const rm = await RiskManager.deploy(owner.address);

  const PoolRegistry = await ethers.getContractFactory("PoolRegistry");
  const registry = await PoolRegistry.deploy(owner.address, rm.target);

  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  const policyNFT = await PolicyNFT.deploy(ethers.ZeroAddress, owner.address);

  const PolicyManager = await ethers.getContractFactory("PolicyManager");
  const policyManager = await PolicyManager.deploy(policyNFT.target, owner.address);
  await policyNFT.setPolicyManagerAddress(policyManager.target);

  const CapitalPool = await ethers.getContractFactory("CapitalPool");
  const capitalPool = await CapitalPool.deploy(owner.address, token.target);

  const CatPool = await ethers.getContractFactory("CatInsurancePool");
  const catPool = await CatPool.deploy(token.target, token.target, ethers.ZeroAddress, owner.address);

  const LossDistributor = await ethers.getContractFactory("LossDistributor");
  const lossDist = await LossDistributor.deploy(rm.target);

  const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
  const rewardDist = await RewardDistributor.deploy(rm.target);

  await rm.setAddresses(
    capitalPool.target,
    registry.target,
    policyManager.target,
    catPool.target,
    lossDist.target,
    rewardDist.target
  );

  const Committee = await ethers.getContractFactory("Committee");
  const committee = await Committee.deploy(
    rm.target,
    staking.target,
    VOTING_PERIOD,
    CHALLENGE_PERIOD,
    QUORUM_BPS,
    SLASH_BPS
  );

  await staking.setCommitteeAddress(committee.target);
  await rm.setCommittee(committee.target);

  const rateModel = { base: 0, slope1: 0, slope2: 0, kink: 0 };
  await rm.addProtocolRiskPool(token.target, rateModel, 0);
  await rm.addProtocolRiskPool(token.target, rateModel, 0);

  await token.mint(staker.address, ethers.parseEther("3000"));
  await token.connect(staker).approve(staking.target, ethers.MaxUint256);
  await token.connect(staker).approve(committee.target, ethers.MaxUint256);

  return { owner, staker, token, staking, committee };
}

describe("StakingContract Integration", function () {
  const STAKE = ethers.parseEther("100");

  it("records votes via committee and locks stake", async function () {
    const { staker, staking, committee } = await loadFixture(deployFixture);

    await staking.connect(staker).stake(STAKE);
    await committee.connect(staker).createProposal(1, 0, 0); // Unpause proposal
    await committee.connect(staker).vote(1, 2); // VoteOption.For

    expect(await staking.lastVotedProposal(staker.address)).to.equal(1);
    await expect(staking.connect(staker).unstake(STAKE)).to.be.revertedWithCustomError(
      staking,
      "VoteLockActive"
    );
  });

  it("allows unstake after lock period even if proposal pending", async function () {
    const { staker, staking, committee } = await loadFixture(deployFixture);

    await staking.connect(staker).stake(STAKE);
    await committee.connect(staker).createProposal(1, 0, 0);
    await committee.connect(staker).vote(1, 2);

    await time.increase(UNSTAKE_LOCK_PERIOD + 1);

    await expect(staking.connect(staker).unstake(STAKE))
      .to.emit(staking, "Unstaked")
      .withArgs(staker.address, STAKE);
    // Proposal is still pending, so the vote record remains
    expect(await staking.lastVotedProposal(staker.address)).to.equal(1);
  });

  it("clears vote record when unstaking after proposal execution", async function () {
    const { staker, staking, committee } = await loadFixture(deployFixture);

    await staking.connect(staker).stake(STAKE);
    await committee.connect(staker).createProposal(1, 0, 0);
    await committee.connect(staker).vote(1, 2);

    await time.increase(VOTING_PERIOD + 1);
    await committee.executeProposal(1);

    await expect(staking.connect(staker).unstake(STAKE))
      .to.emit(staking, "Unstaked")
      .withArgs(staker.address, STAKE);
    expect(await staking.lastVotedProposal(staker.address)).to.equal(0);
  });

  async function deployLongVotingFixture() {
    const [owner, , staker] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("CatShare");
    const token = await Token.deploy();

    const Staking = await ethers.getContractFactory("StakingContract");
    const staking = await Staking.deploy(token.target, owner.address);

    const RiskManager = await ethers.getContractFactory("RiskManager");
    const rm = await RiskManager.deploy(owner.address);

    const PoolRegistry = await ethers.getContractFactory("PoolRegistry");
    const registry = await PoolRegistry.deploy(owner.address, rm.target);

    const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
    const policyNFT = await PolicyNFT.deploy(ethers.ZeroAddress, owner.address);

    const PolicyManager = await ethers.getContractFactory("PolicyManager");
    const policyManager = await PolicyManager.deploy(policyNFT.target, owner.address);
    await policyNFT.setPolicyManagerAddress(policyManager.target);

    const CapitalPool = await ethers.getContractFactory("CapitalPool");
    const capitalPool = await CapitalPool.deploy(owner.address, token.target);

    const CatPool = await ethers.getContractFactory("CatInsurancePool");
    const catPool = await CatPool.deploy(token.target, token.target, ethers.ZeroAddress, owner.address);

    const LossDistributor = await ethers.getContractFactory("LossDistributor");
    const lossDist = await LossDistributor.deploy(rm.target);

    const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
    const rewardDist = await RewardDistributor.deploy(rm.target);

    await rm.setAddresses(
      capitalPool.target,
      registry.target,
      policyManager.target,
      catPool.target,
      lossDist.target,
      rewardDist.target
    );

    const LONG_VOTING_PERIOD = UNSTAKE_LOCK_PERIOD * 2;
    const Committee = await ethers.getContractFactory("Committee");
    const committee = await Committee.deploy(
      rm.target,
      staking.target,
      LONG_VOTING_PERIOD,
      CHALLENGE_PERIOD,
      QUORUM_BPS,
      SLASH_BPS
    );

    await staking.setCommitteeAddress(committee.target);
    await rm.setCommittee(committee.target);

    const rateModel = { base: 0, slope1: 0, slope2: 0, kink: 0 };
    await rm.addProtocolRiskPool(token.target, rateModel, 0);
    await rm.addProtocolRiskPool(token.target, rateModel, 0);

    await token.mint(staker.address, ethers.parseEther("3000"));
    await token.connect(staker).approve(staking.target, ethers.MaxUint256);
    await token.connect(staker).approve(committee.target, ethers.MaxUint256);

    return { owner, staker, token, staking, committee, LONG_VOTING_PERIOD };
  }

  it("updates committee vote weight when unstaking mid-vote", async function () {
    const { staker, staking, committee } = await loadFixture(deployLongVotingFixture);

    await staking.connect(staker).stake(STAKE);
    await committee.connect(staker).createProposal(1, 0, 0);
    await committee.connect(staker).vote(1, 2);

    const proposalBefore = await committee.proposals(1);
    expect(proposalBefore.forVotes).to.equal(STAKE);

    await time.increase(UNSTAKE_LOCK_PERIOD + 1);
    await staking.connect(staker).unstake(STAKE / 2n);

    const proposalAfter = await committee.proposals(1);
    expect(proposalAfter.forVotes).to.equal(STAKE / 2n);
    expect(await staking.stakedBalance(staker.address)).to.equal(STAKE / 2n);
  });

  it("allows the committee to slash stakers", async function () {
    const { staker, staking, committee, token } = await loadFixture(deployFixture);

    await staking.connect(staker).stake(STAKE);

    await ethers.provider.send("hardhat_impersonateAccount", [committee.target]);
    const committeeSigner = await ethers.getSigner(committee.target);
    await ethers.provider.send("hardhat_setBalance", [committee.target, "0x1000000000000000000"]);

    const slashAmount = ethers.parseEther("40");
    const balBefore = await token.balanceOf(committee.target);

    await staking.connect(committeeSigner).slash(staker.address, slashAmount);

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [committee.target]);

    expect(await staking.stakedBalance(staker.address)).to.equal(STAKE - slashAmount);
    expect(await token.balanceOf(committee.target)).to.equal(balBefore + slashAmount);
  });

  it("reverts if a non-committee tries to slash", async function () {
    const { staker, staking, owner } = await loadFixture(deployFixture);

    await staking.connect(staker).stake(STAKE);
    await expect(staking.connect(owner).slash(staker.address, 1)).to.be.revertedWithCustomError(
      staking,
      "NotCommittee"
    );
  });

  it("tracks vote timestamp when voting", async function () {
    const { staker, staking, committee } = await loadFixture(deployFixture);

    await staking.connect(staker).stake(STAKE);
    await committee.connect(staker).createProposal(1, 0, 0);
    await committee.connect(staker).vote(1, 2);

    expect(await staking.lastVoteTime(staker.address)).to.be.gt(0);
  });

  it("clears vote timestamp after unstaking post execution", async function () {
    const { staker, staking, committee } = await loadFixture(deployFixture);

    await staking.connect(staker).stake(STAKE);
    await committee.connect(staker).createProposal(1, 0, 0);
    await committee.connect(staker).vote(1, 2);

    await time.increase(VOTING_PERIOD + 1);
    await committee.executeProposal(1);

    await staking.connect(staker).unstake(STAKE);

    expect(await staking.lastVoteTime(staker.address)).to.equal(0);
  });

  it("reverts if a non-committee calls recordVote", async function () {
    const { staker, staking } = await loadFixture(deployFixture);

    await expect(
      staking.connect(staker).recordVote(staker.address, 1)
    ).to.be.revertedWithCustomError(staking, "NotCommittee");
  });

  it("reverts if committee slashes more than staked", async function () {
    const { staker, staking, committee } = await loadFixture(deployFixture);

    await staking.connect(staker).stake(STAKE);

    await ethers.provider.send("hardhat_impersonateAccount", [committee.target]);
    const committeeSigner = await ethers.getSigner(committee.target);
    await ethers.provider.send("hardhat_setBalance", [committee.target, "0x1000000000000000000"]);

    await expect(
      staking.connect(committeeSigner).slash(staker.address, STAKE + 1n)
    ).to.be.revertedWithCustomError(staking, "InsufficientStakedBalance");

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [committee.target]);
  });

  it("reverts if committee slashes zero amount", async function () {
    const { staker, staking, committee } = await loadFixture(deployFixture);

    await staking.connect(staker).stake(STAKE);

    await ethers.provider.send("hardhat_impersonateAccount", [committee.target]);
    const committeeSigner = await ethers.getSigner(committee.target);
    await ethers.provider.send("hardhat_setBalance", [committee.target, "0x1000000000000000000"]);

    await expect(
      staking.connect(committeeSigner).slash(staker.address, 0)
    ).to.be.revertedWithCustomError(staking, "InvalidAmount");

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [committee.target]);
  });
});
