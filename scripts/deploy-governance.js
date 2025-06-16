/* eslint-disable no-console */
/**
 * Deployment script for staking and governance contracts.
 * -------------------------------------------------------
 * Deploys a mock ERC20 governance token, the StakingContract and
 * the Committee contract. The Committee is set as the staking
 * contract's committee address.
 * -------------------------------------------------------
 * ⚠️ Replace the RISK_MANAGER_ADDRESS placeholder with the real
 *     address before deploying to a live network.
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// TODO: set this to the deployed RiskManager address
const RISK_MANAGER_ADDRESS = "0x0000000000000000000000000000000000000000";

const VOTING_PERIOD = 7 * 24 * 60 * 60;       // 7 days
const CHALLENGE_PERIOD = 7 * 24 * 60 * 60;    // 7 days
const QUORUM_BPS = 4000;                      // 40%
const PROPOSAL_BOND = ethers.parseEther("100");
const PROPOSER_FEE_SHARE_BPS = 1000;          // 10%

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying governance contracts with:", deployer.address);

  /*───────────────────────── Governance token ─────────────────────────*/
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const govToken = await MockERC20.deploy("Governance Token", "GOV", 18);
  await govToken.waitForDeployment();

  // Mint some tokens for the deployer to distribute
  await govToken.mint(deployer.address, ethers.parseEther("1000000"));

  /*──────────────────────────── Staking ───────────────────────────────*/
  const StakingContract = await ethers.getContractFactory("StakingContract");
  const staking = await StakingContract.deploy(govToken.target, deployer.address);
  await staking.waitForDeployment();

  /*──────────────────────────── Committee ─────────────────────────────*/
  const Committee = await ethers.getContractFactory("Committee");
  const committee = await Committee.deploy(
    RISK_MANAGER_ADDRESS,
    staking.target,
    VOTING_PERIOD,
    CHALLENGE_PERIOD,
    QUORUM_BPS,
    PROPOSAL_BOND,
    PROPOSER_FEE_SHARE_BPS
  );
  await committee.waitForDeployment();

  // Wire committee address in staking contract
  await staking.setCommitteeAddress(committee.target);

  /*──────────────────────────── Output ────────────────────────────────*/
  const addresses = {
    GovernanceToken: govToken.target,
    StakingContract: staking.target,
    Committee: committee.target,
  };

  console.table(addresses);

  const outPath = path.join(__dirname, "..", "governance_deployedAddresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log(`Saved addresses to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
