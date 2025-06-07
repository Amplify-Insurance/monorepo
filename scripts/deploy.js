const { ethers } = require("hardhat");

// Base mainnet addresses
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC
const AAVE_POOL_ADDRESS = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"; // Aave v3 Pool
const COMPOUND_COMET_ADDRESS = "0xb125E6687d4313864e53df431d5425969c15Eb2F"; // Compound v3 USDC

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  const policyNFT = await PolicyNFT.deploy(deployer.address);
  await policyNFT.waitForDeployment();

  const CatInsurancePool = await ethers.getContractFactory("CatInsurancePool");
  const catPool = await CatInsurancePool.deploy(USDC_ADDRESS, ethers.ZeroAddress, deployer.address);
  await catPool.waitForDeployment();

  const CoverPool = await ethers.getContractFactory("CoverPool");
  const coverPool = await CoverPool.deploy(policyNFT.target, catPool.target);
  await coverPool.waitForDeployment();

  await policyNFT.setCoverPoolAddress(coverPool.target);
  await catPool.setCoverPoolAddress(coverPool.target);

  // Configure known yield adapters (placeholders for now)
  await coverPool.setBaseYieldAdapter(1, AAVE_POOL_ADDRESS); // YieldPlatform.AAVE
  await coverPool.setBaseYieldAdapter(2, COMPOUND_COMET_ADDRESS); // YieldPlatform.COMPOUND

  console.log("PolicyNFT:", policyNFT.target);
  console.log("CatInsurancePool:", catPool.target);
  console.log("CoverPool:", coverPool.target);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
