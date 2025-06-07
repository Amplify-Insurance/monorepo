const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // Deploy mock USDC token
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("Mock USDC", "mUSDC", 6);
  await usdc.waitForDeployment();
  console.log("MockUSDC deployed to:", usdc.target);

  // Deploy PolicyNFT
  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  const policyNFT = await PolicyNFT.deploy(deployer.address);
  await policyNFT.waitForDeployment();
  console.log("PolicyNFT deployed to:", policyNFT.target);

  // Deploy CatInsurancePool with a placeholder adapter for now
  const MockYieldAdapter = await ethers.getContractFactory("MockYieldAdapter");
  const catPoolAdapter = await MockYieldAdapter.deploy(usdc.target, ethers.ZeroAddress, deployer.address);
  await catPoolAdapter.waitForDeployment();

  const CatInsurancePool = await ethers.getContractFactory("CatInsurancePool");
  const catPool = await CatInsurancePool.deploy(usdc.target, catPoolAdapter.target, deployer.address);
  await catPool.waitForDeployment();
  console.log("CatInsurancePool deployed to:", catPool.target);

  // Deploy CoverPool
  const CoverPool = await ethers.getContractFactory("CoverPool");
  const coverPool = await CoverPool.deploy(policyNFT.target, catPool.target);
  await coverPool.waitForDeployment();
  console.log("CoverPool deployed to:", coverPool.target);

  // Finalise setup
  await policyNFT.setCoverPoolAddress(coverPool.target);
  await catPool.setCoverPoolAddress(coverPool.target);
  await catPoolAdapter.setDepositor(catPool.target);

  // Example yield adapters for CoverPool
  const aaveAdapter = await MockYieldAdapter.deploy(usdc.target, coverPool.target, deployer.address);
  await aaveAdapter.waitForDeployment();
  const compoundAdapter = await MockYieldAdapter.deploy(usdc.target, coverPool.target, deployer.address);
  await compoundAdapter.waitForDeployment();

  await coverPool.setBaseYieldAdapter(0 + 1, aaveAdapter.target); // YieldPlatform.AAVE = 1
  await coverPool.setBaseYieldAdapter(0 + 2, compoundAdapter.target); // YieldPlatform.COMPOUND = 2

  console.log("Aave Adapter:", aaveAdapter.target);
  console.log("Compound Adapter:", compoundAdapter.target);

  console.log("Deployment complete");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
