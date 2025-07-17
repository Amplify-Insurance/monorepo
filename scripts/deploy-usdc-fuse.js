/* eslint-disable no-console */
/**
 * Hardhat deployment script
 * ------------------------------------------------------------
 * Supports Aave v3, Compound v3, Moonwell, Morpho Blue, and Euler v2
 * ------------------------------------------------------------
 * ⚠️ Replace the placeholder addresses (marked TODO) with real
 * network‑specific values before deploying to mainnet.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

// ────────────────────────────────────────────────────────────────────────────
// Asset addresses (Using Base Sepolia for example)
// ────────────────────────────────────────────────────────────────────────────
const USDC_ADDRESS = "0xc6Bc407706B7140EE8Eef2f86F9504651b63e7f9"; // Base Sepolia USDC
const DAI_ADDRESS = "0x2502F488D481Df4F5054330C71b95d93D41625C2";  // Base Sepolia DAI
const USDT_ADDRESS = "0x3695Dd1D1D43B794C0B13eb8be8419Eb3ac22bf7";  // Base Sepolia DAI
const USDM_ADDRESS = "0x4447863cddABbF2c3dAC826f042e03c91927A196";  // Base Sepolia DAI

// Helper function to wait for a transaction to be mined
async function waitForTx(txPromise, message) {
  console.log(`Waiting for transaction: ${message}...`);
  const tx = await txPromise;
  await tx.wait();
  console.log("...Done.");
}

// ────────────────────────────────────────────────────────────────────────────
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  /*──────────────────────────── Core contracts ───────────────────────────*/
  console.log("\nDeploying core contracts...");
  const RiskManager = await ethers.getContractFactory("RiskManager");
  const riskManager = await RiskManager.deploy(deployer.address);
  await riskManager.waitForDeployment();
  console.log("RiskManager deployed to:", riskManager.target);

  const UnderwriterManager = await ethers.getContractFactory("UnderwriterManager");
  const underwriterManager = await UnderwriterManager.deploy(deployer.address);
  await underwriterManager.waitForDeployment();
  console.log("UnderwriterManager deployed to:", underwriterManager.target);

  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  const policyNFT = await PolicyNFT.deploy(deployer.address, deployer.address);
  await policyNFT.waitForDeployment();
  console.log("PolicyNFT deployed to:", policyNFT.target);

  const PoolRegistry = await ethers.getContractFactory("PoolRegistry");
  const poolRegistry = await PoolRegistry.deploy(deployer.address, riskManager.target, underwriterManager.target);
  await poolRegistry.waitForDeployment();
  console.log("PoolRegistry deployed to:", poolRegistry.target);

  const CapitalPool = await ethers.getContractFactory("CapitalPool");
  const capitalPool = await CapitalPool.deploy(deployer.address, USDC_ADDRESS);
  await capitalPool.waitForDeployment();
  console.log("CapitalPool deployed to:", capitalPool.target);

  const LossDistributor = await ethers.getContractFactory("LossDistributor");
  const lossDistributor = await LossDistributor.deploy(riskManager.target, underwriterManager.target, capitalPool.target);
  await lossDistributor.waitForDeployment();
  console.log("LossDistributor deployed to:", lossDistributor.target);

  const PolicyManager = await ethers.getContractFactory("PolicyManager");
  const policyManager = await PolicyManager.deploy(policyNFT.target, deployer.address);
  await policyManager.waitForDeployment();
  console.log("PolicyManager deployed to:", policyManager.target);
  
  const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
  const rewardDistributor = await RewardDistributor.deploy(poolRegistry.target, policyManager.target, capitalPool.target, underwriterManager.target );
  await rewardDistributor.waitForDeployment();
  console.log("RewardDistributor deployed to:", rewardDistributor.target);
  
  const CatShare = await ethers.getContractFactory("CatShare");
  const catShare = await CatShare.deploy();
  await catShare.waitForDeployment();
  console.log("CatShare deployed to:", catShare.target);

  const BackstopPool = await ethers.getContractFactory("BackstopPool");
  const catPool = await BackstopPool.deploy(USDC_ADDRESS, catShare.target, ethers.ZeroAddress, deployer.address);
  await catPool.waitForDeployment();
  console.log("BackstopPool deployed to:", catPool.target);

  /*───────────────────────── Wire up permissions and addresses ───────────────────────*/
  console.log("\nWiring up contract permissions and addresses...");
  await waitForTx(policyNFT.setPolicyManager(policyManager.target), "Set PolicyManager on PolicyNFT");
  await waitForTx(policyNFT.setRiskManager(riskManager.target), "Set RiskManager on PolicyNFT");
  
  await waitForTx(catShare.transferOwnership(catPool.target), "Transfer CatShare ownership to BackstopPool");
  await waitForTx(catPool.initialize(), "Initialize BackstopPool");

  await waitForTx(capitalPool.setRiskManager(riskManager.target), "Set RiskManager on CapitalPool");
  await waitForTx(capitalPool.setUnderwriterManager(underwriterManager.target), "Set UnderwriterManager on CapitalPool");
  await waitForTx(capitalPool.setLossDistributor(lossDistributor.target), "Set LossDistributor on CapitalPool");
  await waitForTx(capitalPool.setRewardDistributor(rewardDistributor.target), "Set RewardDistributor on CapitalPool");

  await waitForTx(catPool.setRiskManager(riskManager.target), "Set RiskManager on BackstopPool");
  await waitForTx(catPool.setCapitalPool(capitalPool.target), "Set CapitalPool on BackstopPool");
  await waitForTx(catPool.setPolicyManager(policyManager.target), "Set PolicyManager on BackstopPool");
  await waitForTx(catPool.setRewardDistributor(rewardDistributor.target), "Set RewardDistributor on BackstopPool");
  await waitForTx(rewardDistributor.setCatPool(catPool.target), "Set BackstopPool on RewardDistributor");

  await waitForTx(policyManager.setAddresses(poolRegistry.target, capitalPool.target, catPool.target, rewardDistributor.target, riskManager.target), "Set addresses on PolicyManager");
  await waitForTx(riskManager.setAddresses(
    capitalPool.target,
    poolRegistry.target,
    policyManager.target,
    catPool.target,
    lossDistributor.target,
    rewardDistributor.target,
    underwriterManager.target
  ), "Set addresses on RiskManager");
  await waitForTx(underwriterManager.setAddresses(
    capitalPool.target,
    poolRegistry.target,
    catPool.target,
    lossDistributor.target,
    rewardDistributor.target,
    riskManager.target
  ), "Set addresses on UnderwriterManager");

  /*───────────────────────── ProtocolConfigurator ───────────────────────*/
  console.log("\nDeploying and configuring RiskAdmin (ProtocolConfigurator)...");
  const ProtocolConfigurator = await ethers.getContractFactory("RiskAdmin");
  const protocolConfigurator = await ProtocolConfigurator.deploy(deployer.address);
  await protocolConfigurator.waitForDeployment();
  console.log("RiskAdmin deployed to:", protocolConfigurator.target);

  await waitForTx(protocolConfigurator.initialize(
    poolRegistry.target,
    capitalPool.target,
    policyManager.target,
    underwriterManager.target
  ), "Initialize RiskAdmin");

  /*─────────────────────────── Yield adapters (MOCKS) ────────────────────────────*/
  console.log("\nDeploying MOCK yield adapters for testnet...");
  
  // FIX: Deploy MockAaveV3Adapter with its correct constructor arguments
  const AaveAdapter = await ethers.getContractFactory("MockAaveV3Adapter");
  const aaveAdapter = await AaveAdapter.deploy(USDC_ADDRESS, deployer.address);
  await aaveAdapter.waitForDeployment();
  console.log("MockAaveV3Adapter deployed to:", aaveAdapter.target);
  await waitForTx(aaveAdapter.setCapitalPoolAddress(capitalPool.target), "Set CapitalPool on MockAaveV3Adapter");

  // FIX: Deploy MockCompoundV3Adapter with its correct constructor arguments
  const CompoundAdapter = await ethers.getContractFactory("MockCompoundV3Adapter");
  const compoundAdapter = await CompoundAdapter.deploy(USDC_ADDRESS, deployer.address);
  await compoundAdapter.waitForDeployment();
  console.log("MockCompoundV3Adapter deployed to:", compoundAdapter.target);
  await waitForTx(compoundAdapter.setCapitalPoolAddress(capitalPool.target), "Set CapitalPool on MockCompoundV3Adapter");

  /*──────────────── Transfer ownership and configure via RiskAdmin ──────*/
  console.log("\nTransferring ownership to RiskAdmin and configuring...");
  await waitForTx(poolRegistry.transferOwnership(protocolConfigurator.target), "Transfer PoolRegistry ownership");
  await waitForTx(capitalPool.transferOwnership(protocolConfigurator.target), "Transfer CapitalPool ownership");
  await waitForTx(policyManager.transferOwnership(protocolConfigurator.target), "Transfer PolicyManager ownership");
  await waitForTx(riskManager.transferOwnership(protocolConfigurator.target), "Transfer RiskManager ownership");
  await waitForTx(underwriterManager.transferOwnership(protocolConfigurator.target), "Transfer UnderwriterManager ownership");
  await waitForTx(rewardDistributor.transferOwnership(protocolConfigurator.target), "Transfer RewardDistributor ownership");
  await waitForTx(catPool.transferOwnership(protocolConfigurator.target), "Transfer BackstopPool ownership");

  // Use configurator for initial setup
  await waitForTx(protocolConfigurator.setRiskManager(poolRegistry.target, riskManager.target), "Set RiskManager on PoolRegistry via Admin");
  await waitForTx(protocolConfigurator.setRiskManager(capitalPool.target, riskManager.target), "Set RiskManager on CapitalPool via Admin");
  
  // 1=AAVE, 2=COMPOUND
  await waitForTx(protocolConfigurator.setCapitalPoolBaseYieldAdapter(1, aaveAdapter.target), "Set Aave adapter via Admin");
  await waitForTx(protocolConfigurator.setCapitalPoolBaseYieldAdapter(2, compoundAdapter.target), "Set Compound adapter via Admin");

  /*────────────────────── Protocol risk‑pool examples ───────────────────*/
  console.log("\nAdding initial risk pools...");
  const defaultRateModel = { base: 200, slope1: 1000, slope2: 5000, kink: 7000 };

  // For a testnet, we can just use the underlying asset addresses as placeholders for the covered assets
  await waitForTx(protocolConfigurator.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 500), "Add USDC risk pool");
  await waitForTx(protocolConfigurator.addProtocolRiskPool(DAI_ADDRESS, defaultRateModel, 250), "Add DAI risk pool");
  await waitForTx(protocolConfigurator.addProtocolRiskPool(USDM_ADDRESS, defaultRateModel, 250), "Add DAI risk pool");
  await waitForTx(protocolConfigurator.addProtocolRiskPool(USDT_ADDRESS, defaultRateModel, 250), "Add DAI risk pool");

  /*──────────────────────────────── Output ──────────────────────────────*/
  const addresses = {
    PolicyNFT:         policyNFT.target,
    PolicyManager:     policyManager.target,
    PoolRegistry:      poolRegistry.target,
    BackstopPool:      catPool.target,
    CapitalPool:       capitalPool.target,
    LossDistributor:   lossDistributor.target,
    RewardDistributor: rewardDistributor.target,
    RiskManager:       riskManager.target,
    ProtocolConfigurator: protocolConfigurator.target,
    UnderwriterManager: underwriterManager.target,
    "Mock Aave Adapter":    aaveAdapter.target,
    "Mock Compound Adapter": compoundAdapter.target,
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
