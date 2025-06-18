/* eslint-disable no-console */
/**
 * Add protocol risk pools to an existing deployment.
 *
 * Set the CONTRACT_SET constant below to the name entry in
 * deployedAddresses.json to select which addresses to use. For example,
 * 'default' or 'eth'.
 */

const CONTRACT_SET ='usdc';

// Example rate model used for all new pools
const RATE_MODEL = { base: 200, slope1: 1000, slope2: 5000, kink: 7000 };

// List the protocols you wish to add. Each item should contain the
// underlying asset address and the claim fee in basis points.
const PROTOCOLS_TO_ADD = [
  // Example: add a pool for USDC with a 5% claim fee
  {
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
    claimFee: 500, // 5% fee on claims
  },
];

const hre = require('hardhat');
const { ethers } = hre;
const fs = require('fs');
const path = require('path');

async function main() {
  const addressesPath = path.join(__dirname, '..', 'deployedAddresses.json');
  const deployments = JSON.parse(fs.readFileSync(addressesPath, 'utf8'));

  let entry = deployments.find((d) => d.name === CONTRACT_SET);
  if (!entry && CONTRACT_SET === 'default') entry = deployments[0];
  if (!entry) throw new Error(`Contracts for '${CONTRACT_SET}' not found`);

  const riskManager = await ethers.getContractAt('RiskManager', entry.RiskManager);

  for (const proto of PROTOCOLS_TO_ADD) {
    console.log(`Adding pool for asset ${proto.asset} with fee ${proto.claimFee}bps...`);
    const tx = await riskManager.addProtocolRiskPool(
      proto.asset,
      RATE_MODEL,
      proto.claimFee
    );
    await tx.wait();
    console.log('  Added with tx', tx.hash);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
