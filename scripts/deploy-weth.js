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
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006"; // WETH
// ───────────────────────────  Yield platform contracts  ────────────────────
// 1. Aave v3
const AAVE_POOL_ADDRESS   = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const AAVE_AWETH_ADDRESS  = "0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7";

// 2. Compound v3 (Comet)
const COMPOUND_COMET_WETH = "0x46e6b214b524310239732D51387075E0e70970bf";

// 3. Moonwell (Compound‑v2 fork)
const MOONWELL_MWETH      = "0x628ff693426583D9a7FB391E54366292F509D457";

// 5. Euler v2
const EULER_EWETH = "0xD8b27CF359b7D15710a5BE299AF6e7Bf904984C2"; 
const EULER_MARKETS = "0x1C376866039Aad238B3Ae977d28C02531B911f8A" 
const EULER_VAULT = "0x1C376866039Aad238B3Ae977d28C02531B911f8A"

// ────────────────────────────────────────────────────────────────────────────
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  /*──────────────────────────── Core contracts ───────────────────────────*/
  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  const policyNFT = await PolicyNFT.deploy(deployer.address);
  await policyNFT.waitForDeployment();

  const RiskManager = await ethers.getContractFactory("RiskManager");
  const riskManager = await RiskManager.deploy(deployer.address);
  await riskManager.waitForDeployment();

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

  const CatShare = await ethers.getContractFactory("CatShare");
  const catShare = await CatShare.deploy();
  await catShare.waitForDeployment();

  const CatInsurancePool = await ethers.getContractFactory("CatInsurancePool");
  const catPool = await CatInsurancePool.deploy(WETH_ADDRESS, catShare.target, ethers.ZeroAddress, deployer.address);
  await catPool.waitForDeployment();

  await catShare.transferOwnership(catPool.target);
  await catPool.initialize();

  const CapitalPool = await ethers.getContractFactory("CapitalPool");
  const capitalPool = await CapitalPool.deploy(deployer.address, WETH_ADDRESS);
  await capitalPool.waitForDeployment();

  // Wire permissions and addresses
  await capitalPool.setRiskManager(riskManager.target);
  await catPool.setRiskManagerAddress(riskManager.target);
  await catPool.setCapitalPoolAddress(capitalPool.target);
  await catPool.setPolicyManagerAddress(policyManager.target);
  await catPool.setRewardDistributor(rewardDistributor.target);

  await policyManager.setAddresses(poolRegistry.target, capitalPool.target, catPool.target, rewardDistributor.target, riskManager.target);
  await riskManager.setAddresses(capitalPool.target, poolRegistry.target, policyManager.target, catPool.target, lossDistributor.target);

  /*─────────────────────────── Yield adapters ────────────────────────────*/
  // 1. Aave v3
  const AaveAdapter = await ethers.getContractFactory("AaveV3Adapter");
  const aaveAdapter = await AaveAdapter.deploy(WETH_ADDRESS, AAVE_POOL_ADDRESS, AAVE_AWETH_ADDRESS, deployer.address);
  await aaveAdapter.waitForDeployment();

  // 2. Compound v3 (Comet)
  const CompoundAdapter = await ethers.getContractFactory("CompoundV3Adapter");
  const compoundAdapter = await CompoundAdapter.deploy(COMPOUND_COMET_WETH, deployer.address);
  await compoundAdapter.waitForDeployment();

  // 3. Moonwell (Compound‑v2)
  const MoonwellAdapter = await ethers.getContractFactory("MoonwellAdapter");
  const moonwellAdapter = await MoonwellAdapter.deploy(WETH_ADDRESS, MOONWELL_MWETH, deployer.address);
  await moonwellAdapter.waitForDeployment();

  // 5. Euler v2
  const EulerAdapter = await ethers.getContractFactory("EulerV2Adapter");
  const eulerAdapter = await EulerAdapter.deploy(
    WETH_ADDRESS,     // underlying
    EULER_EWETH,      // eToken
    EULER_MARKETS,    // markets (rates)
    EULER_VAULT,      // ERC-4626 vault
    deployer.address  // owner
  );
    await eulerAdapter.waitForDeployment();

  /*──────────────── Register adapters in CapitalPool (enum indices) ──────*/
  // 1=AAVE, 2=COMPOUND, 3=MOONWELL, 4=MORPHO, 5=EULER
  await capitalPool.setBaseYieldAdapter(1, aaveAdapter.target);
  await capitalPool.setBaseYieldAdapter(2, compoundAdapter.target);

  /*────────────────────── Protocol risk‑pool examples ───────────────────*/
  const defaultRateModel = { base: 200, slope1: 1000, slope2: 5000, kink: 7000 };

  // WETH pools across all five platforms
  await riskManager.addProtocolRiskPool(WETH_ADDRESS, defaultRateModel, 1);
  await riskManager.addProtocolRiskPool(WETH_ADDRESS, defaultRateModel, 2);
  await riskManager.addProtocolRiskPool(WETH_ADDRESS, defaultRateModel, 3);
  await riskManager.addProtocolRiskPool(WETH_ADDRESS, defaultRateModel, 4);
  // await riskManager.addProtocolRiskPool(WETH_ADDRESS, defaultRateModel, 5);

  /*──────────────────────────────── Output ──────────────────────────────*/
  const addresses = {
    PolicyNFT:         policyNFT.target,
    PolicyManager:     policyManager.target,
    PoolRegistry:      poolRegistry.target,
    CatInsurancePool:  catPool.target,
    CapitalPool:       capitalPool.target,
    LossDistributor:   lossDistributor.target,
    RewardDistributor: rewardDistributor.target,
    RiskManager:       riskManager.target,
    "Aave Adapter":    aaveAdapter.target,
    "Compound Adapter": compoundAdapter.target,
    "Moonwell Adapter": moonwellAdapter.target,
    "Euler Adapter":    eulerAdapter.target,
  };

  console.table(addresses);

  const outPath = path.join(__dirname, "..", "weth_deployedAddresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log(`Saved addresses to ${outPath}`);

  const rootPath = path.join(__dirname, "..", "deployedAddresses.json");
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

