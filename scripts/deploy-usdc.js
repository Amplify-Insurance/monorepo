/* eslint-disable no-console */
/**
 * Hardhat deployment script
 * ------------------------------------------------------------
 * Supports Aave v3, Compound v3, Moonwell, Morpho Blue, and Euler v2
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
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC
// ───────────────────────────  Yield platform contracts  ────────────────────
// 1. Aave v3
const AAVE_POOL_ADDRESS   = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const AAVE_AUSDC_ADDRESS  = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB";

// 2. Compound v3 (Comet)
const COMPOUND_COMET_USDC = "0xb125E6687d4313864e53df431d5425969c15Eb2F";


const MOONWELL_MUSDC = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22";
const EULER_EUSDC = "0x0A1a3b5f2041F33522C4efc754a7D096f880eE16"; 
const USD_PLUS = "0xb79dd08ea68a908a97220c76d19a6aa9cbde4376"
const DAI = "0x50c5725949a6f0c72e6c4a641f24049a917db0cb"


// ────────────────────────────────────────────────────────────────────────────
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  /*──────────────────────────── Core contracts ───────────────────────────*/
  const RiskManager = await ethers.getContractFactory("RiskManager");
  const riskManager = await RiskManager.deploy(deployer.address);
  await riskManager.waitForDeployment();

  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  // Pass zero address for PolicyManager placeholder; set actual address later
  const policyNFT = await PolicyNFT.deploy(ethers.ZeroAddress, deployer.address);
  await policyNFT.waitForDeployment();

  const PoolRegistry = await ethers.getContractFactory("PoolRegistry");
  const poolRegistry = await PoolRegistry.deploy(deployer.address, riskManager.target);
  await poolRegistry.waitForDeployment();

  const LossDistributor = await ethers.getContractFactory("LossDistributor");
  const lossDistributor = await LossDistributor.deploy(riskManager.target);
  await lossDistributor.waitForDeployment();

  const PolicyManager = await ethers.getContractFactory("PolicyManager");
  const policyManager = await PolicyManager.deploy(policyNFT.target, deployer.address);
  await policyManager.waitForDeployment();
  await policyNFT.setPolicyManagerAddress(policyManager.target);

  
  const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
  const rewardDistributor = await RewardDistributor.deploy(riskManager.target, policyManager.target);
  await rewardDistributor.waitForDeployment();

  
  const CatShare = await ethers.getContractFactory("CatShare");
  const catShare = await CatShare.deploy();
  await catShare.waitForDeployment();

  const BackstopPool = await ethers.getContractFactory("BackstopPool");
  const catPool = await BackstopPool.deploy(USDC_ADDRESS, catShare.target, ethers.ZeroAddress, deployer.address);
  await catPool.waitForDeployment();

  const transferTx = await catShare.transferOwnership(catPool.target);
  await transferTx.wait();
  await catPool.initialize();

  const CapitalPool = await ethers.getContractFactory("CapitalPool");
  const capitalPool = await CapitalPool.deploy(deployer.address, USDC_ADDRESS);
  await capitalPool.waitForDeployment();

  // Wire permissions and addresses
  await capitalPool.setRiskManager(riskManager.target);
  await catPool.setRiskManagerAddress(riskManager.target);
  await catPool.setCapitalPoolAddress(capitalPool.target);
  await catPool.setPolicyManagerAddress(policyManager.target);
  await catPool.setRewardDistributor(rewardDistributor.target);
  await rewardDistributor.setCatPool(catPool.target);


  await policyManager.setAddresses(poolRegistry.target, capitalPool.target, catPool.target, rewardDistributor.target, riskManager.target);
  await riskManager.setAddresses(capitalPool.target, poolRegistry.target, policyManager.target, catPool.target, lossDistributor.target, rewardDistributor.target);

  /*─────────────────────────── Yield adapters ────────────────────────────*/
  // 1. Aave v3
  const AaveAdapter = await ethers.getContractFactory("AaveV3Adapter");
  const aaveAdapter = await AaveAdapter.deploy(USDC_ADDRESS, AAVE_POOL_ADDRESS, AAVE_AUSDC_ADDRESS, deployer.address);
  await aaveAdapter.waitForDeployment();
  await aaveAdapter.setCapitalPoolAddress(capitalPool.target);

  // 2. Compound v3 (Comet)
  const CompoundAdapter = await ethers.getContractFactory("CompoundV3Adapter");
  const compoundAdapter = await CompoundAdapter.deploy(COMPOUND_COMET_USDC, deployer.address);
  await compoundAdapter.waitForDeployment();
  await compoundAdapter.setCapitalPoolAddress(capitalPool.target);

  /*──────────────── Register adapters in CapitalPool (enum indices) ──────*/
  // 1=AAVE, 2=COMPOUND, 3=MOONWELL, 4=MORPHO, 5=EULER
  await capitalPool.setBaseYieldAdapter(1, aaveAdapter.target);
  await capitalPool.setBaseYieldAdapter(2, compoundAdapter.target);

  /*────────────────────── Protocol risk‑pool examples ───────────────────*/
  const defaultRateModel = { base: 200, slope1: 1000, slope2: 5000, kink: 7000 };

  // USDC pools across all five platforms
  await riskManager.addProtocolRiskPool(AAVE_AUSDC_ADDRESS, defaultRateModel, 500);
  await riskManager.addProtocolRiskPool(COMPOUND_COMET_USDC, defaultRateModel, 500);
  await riskManager.addProtocolRiskPool(MOONWELL_MUSDC, defaultRateModel, 500);
  await riskManager.addProtocolRiskPool(EULER_EUSDC, defaultRateModel, 500);
  await riskManager.addProtocolRiskPool(DAI, defaultRateModel, 250);
  await riskManager.addProtocolRiskPool(USD_PLUS, defaultRateModel, 250);


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
    "Aave Adapter":    aaveAdapter.target,
    "Compound Adapter": compoundAdapter.target,
  };

  console.table(addresses);

  const outPath = path.join(__dirname, "..", "deployments", "usdc_deployedAddresses.json");
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

