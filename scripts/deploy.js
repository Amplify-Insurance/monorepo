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

// ────────────────────────────────────────────────────────────────────────────
// Asset addresses (Base mainnet)
// ────────────────────────────────────────────────────────────────────────────
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006"; // WETH

// ───────────────────────────  Yield platform contracts  ────────────────────
// 1. Aave v3
const AAVE_POOL_ADDRESS   = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const AAVE_AUSDC_ADDRESS  = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB";

// 2. Compound v3 (Comet)
const COMPOUND_COMET_USDC = "0xb125E6687d4313864e53df431d5425969c15Eb2F";

// 3. Moonwell (Compound‑v2 fork)
const MOONWELL_MUSDC      = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22";

// 4. Morpho Blue
const MORPHO_BLUE_CORE    = "0x0000000000000000000000000000000000000000"; // TODO: replace with real core address
// Market params (USDC loan / WETH collateral example — update as needed)
const MORPHO_LOAN_TOKEN       = USDC_ADDRESS;
const MORPHO_COLLATERAL_TOKEN = WETH_ADDRESS;
const MORPHO_ORACLE           = "0x0000000000000000000000000000000000000000"; // TODO
const MORPHO_IRM              = "0x0000000000000000000000000000000000000000"; // TODO
const MORPHO_LLTV             = ethers.parseUnits("0.87", 18);             // 87% LLTV

// 5. Euler v2
const EULER_EUSDC = "0x0A1a3b5f2041F33522C4efc754a7D096f880eE16"; // TODO: eUSDC address
const EULER_MARKETS = "0x1C376866039Aad238B3Ae977d28C02531B911f8A" // TODO: Replace with real markets address
const EULER_VAULT = "0x1C376866039Aad238B3Ae977d28C02531B911f8A"

// ────────────────────────────────────────────────────────────────────────────
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  /*──────────────────────────── Core contracts ───────────────────────────*/
  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  const policyNFT = await PolicyNFT.deploy(deployer.address);
  await policyNFT.waitForDeployment();

  const CatInsurancePool = await ethers.getContractFactory("CatInsurancePool");
  const catPool = await CatInsurancePool.deploy(USDC_ADDRESS, ethers.ZeroAddress, deployer.address);
  await catPool.waitForDeployment();

  const CapitalPool = await ethers.getContractFactory("CapitalPool");
  const capitalPool = await CapitalPool.deploy(deployer.address, USDC_ADDRESS);
  await capitalPool.waitForDeployment();

  const RiskManager = await ethers.getContractFactory("RiskManager");
  const riskManager = await RiskManager.deploy(capitalPool.target, policyNFT.target, catPool.target);
  await riskManager.waitForDeployment();

  // Wiring permissions
  await policyNFT.setCoverPoolAddress(riskManager.target);
  await catPool.setCoverPoolAddress(riskManager.target);
  await capitalPool.setRiskManager(riskManager.target);

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

  // 4. Morpho Blue
  // const MorphoBlueAdapter = await ethers.getContractFactory("MorphoBlueAdapter");
  // const morphoAdapter = await MorphoBlueAdapter.deploy(
  //   MORPHO_BLUE_CORE,
  //   MORPHO_LOAN_TOKEN,
  //   MORPHO_COLLATERAL_TOKEN,
  //   MORPHO_ORACLE,
  //   MORPHO_IRM,
  //   MORPHO_LLTV,
  //   deployer.address
  // );
  // await morphoAdapter.waitForDeployment();

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
  // await capitalPool.setBaseYieldAdapter(3, moonwellAdapter.target);
  // await capitalPool.setBaseYieldAdapter(4, morphoAdapter.target);
  // await capitalPool.setBaseYieldAdapter(4, eulerAdapter.target);

  /*────────────────────── Protocol risk‑pool examples ───────────────────*/
  const defaultRateModel = { base: 200, slope1: 1000, slope2: 5000, kink: 7000 };

  // USDC pools across all five platforms
  await riskManager.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 1);
  await riskManager.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 2);
  await riskManager.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 3);
  await riskManager.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 4);
  // await riskManager.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 5);

  /*──────────────────────────────── Output ──────────────────────────────*/
  console.table({
    PolicyNFT:        policyNFT.target,
    CatInsurancePool: catPool.target,
    CapitalPool:      capitalPool.target,
    RiskManager:      riskManager.target,
    "Aave Adapter":   aaveAdapter.target,
    "Compound Adapter": compoundAdapter.target,
    "Moonwell Adapter": moonwellAdapter.target,
    // "Morpho Adapter":   morphoAdapter.target,
    "Euler Adapter":    eulerAdapter.target,
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

