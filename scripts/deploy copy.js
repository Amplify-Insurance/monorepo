const { ethers } = require("hardhat");

// Base mainnet addresses
const AAVE_POOL_ADDRESS = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"; // Aave v3 Pool
const AAVE_AUSDC_ADDRESS = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB"; // aUSDC on Base
const COMPOUND_COMET_ADDRESS = "0xb125E6687d4313864e53df431d5425969c15Eb2F"; // Compound v3 USDC

// Compound V2 Forks

// Moonwell
const MOONWELL_MUSDC_ADDRESS = "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22"; // mUSDC



const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006"; // WETH
const cb_BTC_ADDRESS = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"; // cb_BTC
const EURC_ADDRESS = "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42"; // EURC
const MOONWELL_WETH_ADDRESS = "0x628ff693426583D9a7FB391E54366292F509D457"; // mUSDC
const MOONWELL_cbBTC_ADDRESS = "0xf877acafa28c19b96727966690b2f44d35ad5976"; // mUSDC
const MOONWELL_EURC_ADDRESS = "0xb682c840B5F4FC58B20769E691A6fa1305A501a2"; // mUSDC


async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

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

  await policyNFT.setCoverPoolAddress(riskManager.target);
  await catPool.setCoverPoolAddress(riskManager.target);
  await capitalPool.setRiskManager(riskManager.target);

  // Deploy yield adapters
  const AaveAdapter = await ethers.getContractFactory("AaveV3Adapter");
  const aaveAdapter = await AaveAdapter.deploy(USDC_ADDRESS, AAVE_POOL_ADDRESS, AAVE_AUSDC_ADDRESS, deployer.address);
  await aaveAdapter.waitForDeployment();

  const CompoundAdapter = await ethers.getContractFactory("CompoundV3Adapter");
  const compoundAdapter = await CompoundAdapter.deploy(COMPOUND_COMET_ADDRESS, deployer.address);
  await compoundAdapter.waitForDeployment();

  const MoonwellAdapter = await ethers.getContractFactory("MoonwellAdapter");
  const moonwellAdapter = await MoonwellAdapter.deploy(
    USDC_ADDRESS,
    MOONWELL_MUSDC_ADDRESS,
    deployer.address
  );
  await moonwellAdapter.waitForDeployment();

  const MorphoAdapter = await ethers.getContractFactory("MorphoAdapter");
  const morphoAdapter = await MorphoAdapter.deploy(COMPOUND_COMET_ADDRESS, deployer.address);
  await morphoAdapter.waitForDeployment();

  // Configure adapters in CapitalPool
  await capitalPool.setBaseYieldAdapter(1, aaveAdapter.target); // YieldPlatform.AAVE
  await capitalPool.setBaseYieldAdapter(2, compoundAdapter.target); // YieldPlatform.COMPOUND

  // Add protocol risk pools for Aave and Compound using generic identifiers
  const defaultRateModel = {
    base: 200,
    slope1: 1000,
    slope2: 5000,
    kink: 7000,
  };

  await riskManager.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 1); // PROTOCOL_A -> Aave
  await riskManager.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 2); // PROTOCOL_B -> Compound
  await riskManager.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 3); // PROTOCOL_C -> Moonwell
  await riskManager.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 4); // PROTOCOL_C -> Moonwell

  // await riskManager.addProtocolRiskPool(WETH_ADDRESS, defaultRateModel, 1); // PROTOCOL_A -> Aave
  // await riskManager.addProtocolRiskPool(WETH_ADDRESS, defaultRateModel, 2); // PROTOCOL_B -> Compound

  console.log("PolicyNFT:", policyNFT.target);
  console.log("CatInsurancePool:", catPool.target);
  console.log("CapitalPool:", capitalPool.target);
  console.log("RiskManager:", riskManager.target);
  console.log("Aave Adapter:", aaveAdapter.target);
  console.log("Compound Adapter:", compoundAdapter.target);
  console.log("Moonwell Adapter:", moonwellAdapter.target);
  console.log("Morpho Adapter:", morphoAdapter.target);
}


main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
