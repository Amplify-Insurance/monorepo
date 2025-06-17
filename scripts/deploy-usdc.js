/* eslint-disable no-console */
/**
 * Hardhat deployment script
 * ------------------------------------------------------------
 * Supports Aave v3, Compound v3, Moonwell, Morpho Blue, and Euler v2
 * ------------------------------------------------------------
 * ⚠️ Replace the placeholder addresses (marked TODO) with real
 *     network‑specific values before deploying to mainnet.
 */

const { ethers } = require("hardhat");
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

// 3. Moonwell (Compound‑v2 fork)
const MOONWELL_MUSDC      = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22";

// 5. Euler v2
const EULER_EUSDC = "0x0A1a3b5f2041F33522C4efc754a7D096f880eE16"; 
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
  const catPool = await CatInsurancePool.deploy(USDC_ADDRESS, catShare.target, ethers.ZeroAddress, deployer.address);
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
  await riskManager.setAddresses(capitalPool.target, poolRegistry.target, policyManager.target, catPool.target, lossDistributor.target);

  /*─────────────────────────── Yield adapters ────────────────────────────*/
  // 1. Aave v3
  const AaveAdapter = await ethers.getContractFactory("AaveV3Adapter");
  const aaveAdapter = await AaveAdapter.deploy(USDC_ADDRESS, AAVE_POOL_ADDRESS, AAVE_AUSDC_ADDRESS, deployer.address);
  await aaveAdapter.waitForDeployment();

  // 2. Compound v3 (Comet)
  const CompoundAdapter = await ethers.getContractFactory("CompoundV3Adapter");
  const compoundAdapter = await CompoundAdapter.deploy(COMPOUND_COMET_USDC, deployer.address);
  await compoundAdapter.waitForDeployment();

  // 3. Moonwell (Compound‑v2)
  const MoonwellAdapter = await ethers.getContractFactory("MoonwellAdapter");
  const moonwellAdapter = await MoonwellAdapter.deploy(USDC_ADDRESS, MOONWELL_MUSDC, deployer.address);
  await moonwellAdapter.waitForDeployment();


  // 5. Euler v2
  const EulerAdapter = await ethers.getContractFactory("EulerV2Adapter");
  const eulerAdapter = await EulerAdapter.deploy(
    USDC_ADDRESS,     // underlying
    EULER_EUSDC,      // eToken
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

  // USDC pools across all five platforms
  await poolRegistry.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 1);
  await poolRegistry.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 2);
  await poolRegistry.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 3);
  await poolRegistry.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 4);
  // await riskManager.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 5);

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

  const outPath = path.join(__dirname, "..", "usdc_deployedAddresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log(`Saved addresses to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

