const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const VOTING_PERIOD = 7 * 24 * 60 * 60; // 7 days
const CHALLENGE_PERIOD = 7 * 24 * 60 * 60; // 7 days
const QUORUM_BPS = 4000; // 40%
const SLASH_BPS = 500; // 5%
const UNSTAKE_LOCK_PERIOD = 7 * 24 * 60 * 60; // from StakingContract

async function deployFixture() {
  const [owner, riskManager, staker] = await ethers.getSigners();

  const ERC20 = await ethers.getContractFactory("MockERC20");
  const token = await ERC20.deploy("Governance", "GOV", 18);

  const Staking = await ethers.getContractFactory("StakingContract");
  const staking = await Staking.deploy(token.target, owner.address);

  const RiskManager = await ethers.getContractFactory("MockCommitteeRiskManager");
  const rm = await RiskManager.deploy();

  const Committee = await ethers.getContractFactory("Committee");
  const committee = await Committee.deploy(
    rm.target,
    staking.target,
    VOTING_PERIOD,
    CHALLENGE_PERIOD,
    QUORUM_BPS,
    SLASH_BPS
  );

  // link staking contract with the committee
  await staking.setCommitteeAddress(committee.target);

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
    // vote record should remain until the proposal is finalized
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
});
