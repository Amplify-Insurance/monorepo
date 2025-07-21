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

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

// TODO: set these to the deployed addresses
const RISK_MANAGER_ADDRESS = "0xD1c640f4C9ff53ba46B42959ECB9a76f2dB9Cb2b";
const PROTOCOL_CONFIGURATOR_ADDRESS = "0x0000000000000000000000000000000000000000";

const VOTING_PERIOD = 7 * 24 * 60 * 60;       // 7 days
const CHALLENGE_PERIOD = 7 * 24 * 60 * 60;    // 7 days
const QUORUM_BPS = 4000;                      // 40%
// const PROPOSAL_BOND = ethers.parseEther("100");
// const PROPOSER_FEE_SHARE_BPS = 1000;          // 10%
const SLASH_BPS = 500;                        // 5%

// Helper to verify a contract on Etherscan
async function verifyContract(address, args) {
  try {
    await hre.run("verify:verify", { address, constructorArguments: args });
  } catch (err) {
    console.log(`Verification failed for ${address}: ${err.message}`);
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying governance contracts with:", deployer.address);

  const riskManager = await ethers.getContractAt(
    "RiskManager",
    RISK_MANAGER_ADDRESS
  );
  const protocolConfigurator = await ethers.getContractAt(
    "RiskAdmin",
    PROTOCOL_CONFIGURATOR_ADDRESS
  );

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
    SLASH_BPS
  );
  await committee.waitForDeployment();

  // Wire committee address in staking contract
  await staking.setCommitteeAddress(committee.target);
  await protocolConfigurator.setCommittee(committee.target, RISK_MANAGER_ADDRESS);

  /*──────────────────────────── Output ────────────────────────────────*/
  const addresses = {
    GovernanceToken: govToken.target,
    StakingContract: staking.target,
    Committee: committee.target,
  };

  console.table(addresses);

  const outPath = path.join(__dirname, "..", "deployments", "governance_deployedAddresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log(`Saved addresses to ${outPath}`);

  const rootPath = path.join(__dirname, "..", "deployments", "deployedAddresses.json");
  const name = process.env.DEPLOYMENT_NAME || hre.network.name || "default";
  let root = [];
  if (fs.existsSync(rootPath)) {
    root = JSON.parse(fs.readFileSync(rootPath, "utf8"));
  }
  if (!Array.isArray(root)) {
    root = [{ name: "default", ...root }];
  }
  let entry = root.find((d) => d.name === name);
  if (!entry) {
    entry = { name };
    root.push(entry);
  }
  Object.assign(entry, addresses);
  fs.writeFileSync(rootPath, JSON.stringify(root, null, 2));
  console.log(`Updated ${rootPath}`);

  // Verify contracts on Etherscan
  await verifyContract(govToken.target, ["Governance Token", "GOV", 18]);
  await verifyContract(staking.target, [govToken.target, deployer.address]);
  await verifyContract(committee.target, [
    RISK_MANAGER_ADDRESS,
    staking.target,
    VOTING_PERIOD,
    CHALLENGE_PERIOD,
    QUORUM_BPS,
    SLASH_BPS,
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
