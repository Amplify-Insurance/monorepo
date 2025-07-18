/* eslint-disable no-console */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying mock tokens with:", deployer.address);

  const MockERC20 = await ethers.getContractFactory("MockERC20");

  // Amount to mint of each token (in their own decimals)
  const MINT_AMOUNT = {
    USDC: ethers.parseUnits("1000000", 6),
    DAI:  ethers.parseUnits("1000000", 18),
    USDT: ethers.parseUnits("1000000", 6),
    USDM: ethers.parseUnits("1000000", 6),
  };

  // Deploy & mint USDC
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  console.log(`USDC deployed to: ${usdc.target}`);
  await (await usdc.mint(deployer.address, MINT_AMOUNT.USDC)).wait();
  console.log(`Minted ${MINT_AMOUNT.USDC.toString()} USDC to deployer`);

  // Deploy & mint DAI
  const dai = await MockERC20.deploy("Dai Stablecoin", "DAI", 18);
  await dai.waitForDeployment();
  console.log(`DAI deployed to: ${dai.target}`);
  await (await dai.mint(deployer.address, MINT_AMOUNT.DAI)).wait();
  console.log(`Minted ${MINT_AMOUNT.DAI.toString()} DAI to deployer`);

  // Deploy & mint USDT
  const usdt = await MockERC20.deploy("Tether USD", "USDT", 6);
  await usdt.waitForDeployment();
  console.log(`USDT deployed to: ${usdt.target}`);
  await (await usdt.mint(deployer.address, MINT_AMOUNT.USDT)).wait();
  console.log(`Minted ${MINT_AMOUNT.USDT.toString()} USDT to deployer`);

  // Deploy & mint USDM
  const usdm = await MockERC20.deploy("USD Moon", "USDM", 6);
  await usdm.waitForDeployment();
  console.log(`USDM deployed to: ${usdm.target}`);
  await (await usdm.mint(deployer.address, MINT_AMOUNT.USDM)).wait();
  console.log(`Minted ${MINT_AMOUNT.USDM.toString()} USDM to deployer`);

  // Write out addresses
  const addresses = {
    USDC: usdc.target,
    DAI:  dai.target,
    USDT: usdt.target,
    USDM: usdm.target,
  };
  console.table(addresses);

  const outPath = path.join(__dirname, "..", "deployments", "token_deployedAddresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log(`Saved token addresses to ${outPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
