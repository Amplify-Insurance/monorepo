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
// Network‑specific addresses
// ────────────────────────────────────────────────────────────────────────────
const NETWORK_CONFIG = {
  base: {
    USDC_ADDRESS: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    AAVE_POOL_ADDRESS: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    AAVE_AUSDC_ADDRESS: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB",
    COMPOUND_COMET_USDC: "0xb125E6687d4313864e53df431d5425969c15Eb2F",
    MOONWELL_MUSDC: "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22",
    EULER_EUSDC: "0x0A1a3b5f2041F33522C4efc754a7D096f880eE16",
    USD_PLUS: "0xb79dd08ea68a908a97220c76d19a6aa9cbde4376",
    DAI: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
    useMocks: false,
  },
  base_sepolia: {
    USDC_ADDRESS: "0xDB17B0Db251013464C6f9E2477ba79bCe5d8DCE3",
    DAI: "0xdD758aD67Dc25914b17DA6602a190E266a0b0772",
    USDT_ADDRESS: "0x474C479BeC727D24F833365Db2A929Bd55ACC7eA",
    USDM_ADDRESS: "0x8815459FFDEC8FA33F9d1E37d4b5852fB269cDD8",
    useMocks: true,
  },
};

const cfg = NETWORK_CONFIG[hre.network.name];
if (!cfg) {
  throw new Error(`Unsupported network: ${hre.network.name}`);
}

const {
  USDC_ADDRESS,
  AAVE_POOL_ADDRESS,
  AAVE_AUSDC_ADDRESS,
  COMPOUND_COMET_USDC,
  MOONWELL_MUSDC,
  EULER_EUSDC,
  USD_PLUS,
  DAI,
  USDT_ADDRESS,
  USDM_ADDRESS,
  useMocks,
} = cfg;

// NEW: Helper function to wait for a transaction to be mined
async function waitForTx(txOrPromise, message) {
     console.log(`Waiting for transaction: ${message}...`);
     // Resolve the promise to get the TransactionResponse
     const tx = await txOrPromise;
     // Now we can wait for it to be mined
     await tx.wait();      // TransactionResponse.wait() → Promise<TransactionReceipt> :contentReference[oaicite:0]{index=0}
    console.log("...Done.");
  }

// Helper to verify a contract on Etherscan
async function verifyContract(address, args) {
  try {
    await hre.run("verify:verify", { address, constructorArguments: args });
  } catch (err) {
    console.log(`Verification failed for ${address}: ${err.message}`);
  }
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

  const PolicyManager = await ethers.getContractFactory("PolicyManager");
  const policyManager = await PolicyManager.deploy(policyNFT.target, deployer.address);
  await policyManager.waitForDeployment();
  console.log("PolicyManager deployed to:", policyManager.target);

  const PoolRegistry = await ethers.getContractFactory("PoolRegistry");
  const poolRegistry = await PoolRegistry.deploy(deployer.address, riskManager.target, policyManager.target);
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

  
  const RewardDistributor = await ethers.getContractFactory("RewardDistributor");
  const rewardDistributor = await RewardDistributor.deploy(poolRegistry.target, policyManager.target, capitalPool.target, underwriterManager.target, riskManager.target );
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

  await waitForTx(catPool.setRiskManager(riskManager.target), "Set RiskManager on BackstopPool");
  await waitForTx(catPool.setCapitalPool(capitalPool.target), "Set CapitalPool on BackstopPool");
  await waitForTx(catPool.setPolicyManager(policyManager.target), "Set PolicyManager on BackstopPool");
  await waitForTx(catPool.setRewardDistributor(rewardDistributor.target), "Set RewardDistributor on BackstopPool");
  await waitForTx(rewardDistributor.setCatPool(catPool.target), "Set BackstopPool on RewardDistributor");

  await waitForTx(policyManager.setAddresses(poolRegistry.target, capitalPool.target, catPool.target, rewardDistributor.target, riskManager.target,underwriterManager.target), "Set addresses on PolicyManager");
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
    underwriterManager.target,
  ), "Initialize RiskAdmin");

  /*─────────────────────────── Yield adapters ────────────────────────────*/
  console.log("\nDeploying yield adapters...");
  const AaveAdapter = await ethers.getContractFactory(useMocks ? "MockAaveV3Adapter" : "AaveV3Adapter");
  const aaveArgs = useMocks
    ? [USDC_ADDRESS, deployer.address]
    : [USDC_ADDRESS, AAVE_POOL_ADDRESS, AAVE_AUSDC_ADDRESS, deployer.address];
  const aaveAdapter = await AaveAdapter.deploy(...aaveArgs);
  await aaveAdapter.waitForDeployment();

  await waitForTx(aaveAdapter.setCapitalPoolAddress(capitalPool.target), "Set CapitalPool on AaveAdapter");

  const CompoundAdapter = await ethers.getContractFactory(useMocks ? "MockCompoundV3Adapter" : "CompoundV3Adapter");
  const compoundArgs = useMocks
    ? [USDC_ADDRESS, deployer.address]
    : [COMPOUND_COMET_USDC, deployer.address];
  const compoundAdapter = await CompoundAdapter.deploy(...compoundArgs);
  await compoundAdapter.waitForDeployment();

  
  await waitForTx(compoundAdapter.setCapitalPoolAddress(capitalPool.target), "Set CapitalPool on CompoundAdapter");

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
  
  await waitForTx(protocolConfigurator.setRewardDistributor(capitalPool.target, rewardDistributor.target), "Set rewardDistributor on CapitalPool via Admin");
  await waitForTx(protocolConfigurator.setLossDistributor(capitalPool.target, lossDistributor.target), "Set lossDistributor on CapitalPool via Admin");

  // 1=AAVE, 2=COMPOUND
  await waitForTx(protocolConfigurator.setCapitalPoolBaseYieldAdapter(1, aaveAdapter.target), "Set Aave adapter via Admin");
  await waitForTx(protocolConfigurator.setCapitalPoolBaseYieldAdapter(2, compoundAdapter.target), "Set Compound adapter via Admin");

  /*────────────────────── Protocol risk‑pool examples ───────────────────*/
  console.log("\nAdding initial risk pools...");
  const defaultRateModel = { base: 200, slope1: 1000, slope2: 5000, kink: 7000 };

  if (useMocks) {
    await waitForTx(protocolConfigurator.addProtocolRiskPool(USDC_ADDRESS, defaultRateModel, 500), "Add USDC risk pool");
    if (DAI) await waitForTx(protocolConfigurator.addProtocolRiskPool(DAI, defaultRateModel, 250), "Add DAI risk pool");
    if (USDM_ADDRESS) await waitForTx(protocolConfigurator.addProtocolRiskPool(USDM_ADDRESS, defaultRateModel, 250), "Add USDM risk pool");
    if (USDT_ADDRESS) await waitForTx(protocolConfigurator.addProtocolRiskPool(USDT_ADDRESS, defaultRateModel, 250), "Add USDT risk pool");
  } else {
    await waitForTx(protocolConfigurator.addProtocolRiskPool(AAVE_AUSDC_ADDRESS, defaultRateModel, 500), "Add Aave risk pool");
    await waitForTx(protocolConfigurator.addProtocolRiskPool(COMPOUND_COMET_USDC, defaultRateModel, 500), "Add Compound risk pool");
    await waitForTx(protocolConfigurator.addProtocolRiskPool(MOONWELL_MUSDC, defaultRateModel, 500), "Add Moonwell risk pool");
    await waitForTx(protocolConfigurator.addProtocolRiskPool(EULER_EUSDC, defaultRateModel, 500), "Add Euler risk pool");
    await waitForTx(protocolConfigurator.addProtocolRiskPool(DAI, defaultRateModel, 250), "Add DAI risk pool");
    await waitForTx(protocolConfigurator.addProtocolRiskPool(USD_PLUS, defaultRateModel, 250), "Add USD+ risk pool");
  }

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
  };

  addresses[useMocks ? "Mock Aave Adapter" : "Aave Adapter"] = aaveAdapter.target;
  addresses[useMocks ? "Mock Compound Adapter" : "Compound Adapter"] = compoundAdapter.target;

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

  // Verify contracts on Etherscan
  const verifications = [
    { address: riskManager.target, args: [deployer.address] },
    { address: underwriterManager.target, args: [deployer.address] },
    { address: policyNFT.target, args: [deployer.address, deployer.address] },
    { address: poolRegistry.target, args: [deployer.address, riskManager.target, underwriterManager.target] },
    { address: capitalPool.target, args: [deployer.address, USDC_ADDRESS] },
    { address: lossDistributor.target, args: [riskManager.target, underwriterManager.target, capitalPool.target] },
    { address: policyManager.target, args: [policyNFT.target, deployer.address] },
    { address: rewardDistributor.target, args: [poolRegistry.target, policyManager.target, capitalPool.target, underwriterManager.target, riskManager.target] },
    { address: catShare.target, args: [] },
    { address: catPool.target, args: [USDC_ADDRESS, catShare.target, ethers.ZeroAddress, deployer.address] },
    { address: protocolConfigurator.target, args: [deployer.address] },
    { address: aaveAdapter.target, args: aaveArgs },
    { address: compoundAdapter.target, args: compoundArgs },
  ];

  for (const v of verifications) {
    await verifyContract(v.address, v.args);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
