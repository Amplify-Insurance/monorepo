/* eslint-disable no-console */
/**
 * Hardhat script to configure additional RiskManager markets.
 * Adds new protocol risk pools using an existing deployment.
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Example ERC20 tokens (mainnet addresses - replace as needed)
const WBTC_ADDRESS = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"; // Wrapped BTC
const STETH_ADDRESS = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"; // Lido stETH

async function main() {
  const addressesPath = path.join(__dirname, "..", "deployedAddresses.json");
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  const riskManager = await ethers.getContractAt("RiskManager", addresses.RiskManager);

  const defaultRateModel = { base: 200, slope1: 1000, slope2: 5000, kink: 7000 };

  console.log("Adding WBTC market...");
  await riskManager.addProtocolRiskPool(WBTC_ADDRESS, defaultRateModel, 1); // PROTOCOL_A

  console.log("Adding stETH market...");
  await riskManager.addProtocolRiskPool(STETH_ADDRESS, defaultRateModel, 2); // PROTOCOL_B

  console.log("Markets configured successfully");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
