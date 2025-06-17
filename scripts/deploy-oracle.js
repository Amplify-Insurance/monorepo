/* eslint-disable no-console */
/**
 * Deployment script for the PriceOracle contract.
 * ------------------------------------------------------------
 * Registers Chainlink price feeds for common tokens on Base.
 * ------------------------------------------------------------
 * ⚠️ Replace the placeholder aggregator addresses (marked TODO)
 *     with real values before deploying to mainnet.
 */

const { ethers } = require("hardhat")
const fs = require("fs")
const path = require("path")

// Base mainnet token addresses
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // USDC
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006" // WETH

// Chainlink price feed aggregators (Base)
// TODO: replace with real feed addresses
const USDC_USD_FEED = "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B"
const WETH_USD_FEED = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log("Deploying PriceOracle with:", deployer.address)

  const Oracle = await ethers.getContractFactory("PriceOracle")
  const oracle = await Oracle.deploy(deployer.address)
  await oracle.waitForDeployment()

  // Register feeds
  await oracle.setAggregator(USDC_ADDRESS, USDC_USD_FEED)
  await oracle.setAggregator(WETH_ADDRESS, WETH_USD_FEED)

  // Persist address to deployedAddresses.json
  const addressesPath = path.join(__dirname, "..", "oracle_deployedAddresses.json")
  let addresses = {}
  if (fs.existsSync(addressesPath)) {
    addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"))
  }
  addresses.PriceOracle = oracle.target
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2))
  console.log(`Saved addresses to ${addressesPath}`)

  const rootPath = path.join(__dirname, "..", "deployedAddresses.json")
  let root = {}
  if (fs.existsSync(rootPath)) {
    root = JSON.parse(fs.readFileSync(rootPath, "utf8"))
  }
  fs.writeFileSync(rootPath, JSON.stringify({ ...root, ...addresses }, null, 2))
  console.log(`Updated ${rootPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
