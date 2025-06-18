/* eslint-disable no-console */
/**
 * Configure reserve parameters for an existing deployment.
 *
 * Updates the following settings on deployed contracts:
 *  - coverCooldownPeriod on PolicyManager
 *  - maxAllocationsPerUnderwriter on RiskManager
 *  - underwriterNoticePeriod on CapitalPool
 *
 * Adjust the CONTRACT_SET constant or set the CONTRACT_SET environment
 * variable to choose which deployment entry from deployments/deployedAddresses.json
 * will be used.
 *
 * The values to set can be provided via environment variables or edited below.
 */

const hre = require('hardhat');
const { ethers } = hre;
const fs = require('fs');
const path = require('path');

const CONTRACT_SET = process.env.CONTRACT_SET || 'usdc';

const COVER_COOLDOWN_PERIOD =
  process.env.COVER_COOLDOWN_PERIOD || 5 * 24 * 60 * 60; // seconds
const MAX_ALLOCATIONS_PER_UNDERWRITER =
  process.env.MAX_ALLOCATIONS_PER_UNDERWRITER || 5;
const UNDERWRITER_NOTICE_PERIOD =
  process.env.UNDERWRITER_NOTICE_PERIOD || 0;

async function main() {
  const addressesPath = path.join(__dirname, '..', 'deployments', 'deployedAddresses.json');
  const deployments = JSON.parse(fs.readFileSync(addressesPath, 'utf8'));

  let entry = deployments.find((d) => d.name === CONTRACT_SET);
  if (!entry && CONTRACT_SET === 'default') entry = deployments[0];
  if (!entry) throw new Error(`Contracts for '${CONTRACT_SET}' not found`);

  const policyManager = await ethers.getContractAt('PolicyManager', entry.PolicyManager);
  const riskManager = await ethers.getContractAt('RiskManager', entry.RiskManager);
  const capitalPool = await ethers.getContractAt('CapitalPool', entry.CapitalPool);

  console.log('Setting cover cooldown period to', COVER_COOLDOWN_PERIOD);
  const tx1 = await policyManager.setCoverCooldownPeriod(COVER_COOLDOWN_PERIOD);
  await tx1.wait();
  console.log('  tx', tx1.hash);

  console.log('Setting max allocations per underwriter to', MAX_ALLOCATIONS_PER_UNDERWRITER);
  const tx2 = await riskManager.setMaxAllocationsPerUnderwriter(MAX_ALLOCATIONS_PER_UNDERWRITER);
  await tx2.wait();
  console.log('  tx', tx2.hash);

  console.log('Setting underwriter notice period to', UNDERWRITER_NOTICE_PERIOD);
  const tx3 = await capitalPool.setUnderwriterNoticePeriod(UNDERWRITER_NOTICE_PERIOD);
  await tx3.wait();
  console.log('  tx', tx3.hash);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
