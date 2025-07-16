/* eslint-disable no-console */
/**
 * Hardhat deployment script
 * ------------------------------------------------------------
 * Supports Aave v3 and Compound v3
 * ------------------------------------------------------------
 * ⚠️ Replace the placeholder addresses (marked TODO) with real
 *     network‑specific values before deploying to mainnet.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

// ────────────────────────────────────────────────────────────────────────────
// Asset addresses (Base mainnet)
// ────────────────────────────────────────────────────────────────────────────
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006"; // WETH
// ───────────────────────────  Yield platform contracts  ────────────────────
// 1. Aave v3
const AAVE_POOL_ADDRESS   = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const AAVE_AWETH_ADDRESS  = "0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7";

// 2. Compound v3 (Comet)
const COMPOUND_COMET_WETH = "0x46e6b214b524310239732D51387075E0e70970bf";


// ────────────────────────────────────────────────────────────────────────────
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  /*──────────────────────────── Core contracts ───────────────────────────*/
  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  // Deploy with deployer as a temporary PolicyManager; updated after
  const policyNFT = await PolicyNFT.deploy(deployer.address, deployer.address);
  await policyNFT.waitForDeployment();

  const RiskManager = await ethers.getContractFactory("RiskManager");
  const riskManager = await RiskManager.deploy(deployer.address);
  await riskManager.waitForDeployment();

  const UnderwriterManager = await ethers.getContractFactory("UnderwriterManager");
  const underwriterManager = await UnderwriterManager.deploy(deployer.address);
  await underwriterManager.waitForDeployment();

  const PoolRegistry = await ethers.getContractFactory("PoolRegistry");
  const poolRegistry = await PoolRegistry.deploy(deployer.address, riskManager.target);
  await poolRegistry.waitForDeployment();

  const LossDistributor = await ethers.getContractFactory("LossDistributor");
  const lossDistributor = await LossDistributor.deploy(riskManager.target);
  await lossDistributor.waitForDeployment();

  const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
  const rewardDistributor = await RewardDistributor.deploy(riskManager.target);
  await rewardDistributor.waitForDeployment();

  const PolicyManager = await ethers.getContractFactory("PolicyManager");
  const policyManager = await PolicyManager.deploy(policyNFT.target, deployer.address);
  await policyManager.waitForDeployment();
  await policyNFT.setPolicyManagerAddress(policyManager.target);

  const CatShare = await ethers.getContractFactory("CatShare");
  const catShare = await CatShare.deploy();
  await catShare.waitForDeployment();

  const BackstopPool = await ethers.getContractFactory("BackstopPool");
  const catPool = await BackstopPool.deploy(WETH_ADDRESS, catShare.target, ethers.ZeroAddress, deployer.address);
  await catPool.waitForDeployment();

  const transferTx = await catShare.transferOwnership(catPool.target);
  await transferTx.wait();
  await catPool.initialize();

  const CapitalPool = await ethers.getContractFactory("CapitalPool");
  const capitalPool = await CapitalPool.deploy(deployer.address, WETH_ADDRESS);
  await capitalPool.waitForDeployment();

  // Wire permissions and addresses
  await catPool.setRiskManagerAddress(riskManager.target);
  await catPool.setCapitalPoolAddress(capitalPool.target);
  await catPool.setPolicyManagerAddress(policyManager.target);
  await catPool.setRewardDistributor(rewardDistributor.target);
  await rewardDistributor.setCatPool(catPool.target);

  await policyManager.setAddresses(poolRegistry.target, capitalPool.target, catPool.target, rewardDistributor.target, riskManager.target);
  await riskManager.setAddresses(
    capitalPool.target,
    poolRegistry.target,
    policyManager.target,
    catPool.target,
    lossDistributor.target,
    rewardDistributor.target,
    underwriterManager.target
  );
  await underwriterManager.setAddresses(
    capitalPool.target,
    poolRegistry.target,
    catPool.target,
    lossDistributor.target,
    rewardDistributor.target,
    riskManager.target
  );

  /*───────────────────────── ProtocolConfigurator ───────────────────────*/
  const ProtocolConfigurator = await ethers.getContractFactory("RiskAdmin");
  const protocolConfigurator = await ProtocolConfigurator.deploy(deployer.address);
  await protocolConfigurator.waitForDeployment();
  await protocolConfigurator.initialize(
    poolRegistry.target,
    capitalPool.target,
    policyManager.target,
    underwriterManager.target
  );

  // Use configurator for initial setup
  await protocolConfigurator.setPoolRegistryRiskManager(riskManager.target);
  await protocolConfigurator.setCapitalPoolRiskManager(riskManager.target);

  /*─────────────────────────── Yield adapters ────────────────────────────*/
  // 1. Aave v3
  const AaveAdapter = await ethers.getContractFactory("AaveV3Adapter");
  const aaveAdapter = await AaveAdapter.deploy(WETH_ADDRESS, AAVE_POOL_ADDRESS, AAVE_AWETH_ADDRESS, deployer.address);
  await aaveAdapter.waitForDeployment();
  await aaveAdapter.setCapitalPoolAddress(capitalPool.target);

  // 2. Compound v3 (Comet)
  const CompoundAdapter = await ethers.getContractFactory("CompoundV3Adapter");
  const compoundAdapter = await CompoundAdapter.deploy(COMPOUND_COMET_WETH, deployer.address);
  await compoundAdapter.waitForDeployment();
  await compoundAdapter.setCapitalPoolAddress(capitalPool.target);


  /*──────────────── Register adapters in CapitalPool (enum indices) ──────*/
  // 1=AAVE, 2=COMPOUND
  await protocolConfigurator.setCapitalPoolBaseYieldAdapter(1, aaveAdapter.target);
  await protocolConfigurator.setCapitalPoolBaseYieldAdapter(2, compoundAdapter.target);

  /*────────────────────── Protocol risk‑pool examples ───────────────────*/
  const defaultRateModel = { base: 200, slope1: 1000, slope2: 5000, kink: 7000 };

  // WETH pools across both platforms
  await protocolConfigurator.addProtocolRiskPool(WETH_ADDRESS, defaultRateModel, 1);
  await protocolConfigurator.addProtocolRiskPool(WETH_ADDRESS, defaultRateModel, 2);

  // Transfer ownership of core contracts to the configurator
  await poolRegistry.transferOwnership(protocolConfigurator.target);
  await capitalPool.transferOwnership(protocolConfigurator.target);
  await policyManager.transferOwnership(protocolConfigurator.target);
  await riskManager.transferOwnership(protocolConfigurator.target);
  await underwriterManager.transferOwnership(protocolConfigurator.target);
  await rewardDistributor.transferOwnership(protocolConfigurator.target);
  await catPool.transferOwnership(protocolConfigurator.target);

  /*──────────────────────────────── Output ──────────────────────────────*/
  const addresses = {
    PolicyNFT:         policyNFT.target,
    PolicyManager:     policyManager.target,
    PoolRegistry:      poolRegistry.target,
    BackstopPool:  catPool.target,
    CapitalPool:       capitalPool.target,
    LossDistributor:   lossDistributor.target,
    RewardDistributor: rewardDistributor.target,
    RiskManager:       riskManager.target,
    ProtocolConfigurator: protocolConfigurator.target,
    UnderwriterManager: underwriterManager.target,
    "Aave Adapter":    aaveAdapter.target,
    "Compound Adapter": compoundAdapter.target,
  };

  console.table(addresses);

  const outPath = path.join(__dirname, "..", "deployments", "weth_deployedAddresses.json");
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
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

