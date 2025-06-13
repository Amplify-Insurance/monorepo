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
const USDC_USD_FEED = "0x0000000000000000000000000000000000000000"
const WETH_USD_FEED = "0x0000000000000000000000000000000000000000"

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
  const addressesPath = path.join(__dirname, "..", "deployedAddresses.json")
  let addresses = {}
  if (fs.existsSync(addressesPath)) {
    addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"))
  }
  addresses.PriceOracle = oracle.target
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2))
  console.log(`Saved addresses to ${addressesPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
