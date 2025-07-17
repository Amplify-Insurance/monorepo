/* eslint-disable no-console */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying mock tokens with:", deployer.address);

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();

  const dai = await MockERC20.deploy("Dai Stablecoin", "DAI", 18);
  await dai.waitForDeployment();

  const usdt = await MockERC20.deploy("Tether USD", "USDT", 6);
  await usdt.waitForDeployment();

  const usdm = await MockERC20.deploy("USD Moon", "USDM", 6);
  await usdm.waitForDeployment();

  const addresses = {
    USDC: usdc.target,
    DAI: dai.target,
    USDT: usdt.target,
    USDM: usdm.target,
  };

  console.table(addresses);

  const outPath = path.join(__dirname, "..", "deployments", "token_deployedAddresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log(`Saved token addresses to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
