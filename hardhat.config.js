require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */

module.exports = {
  solidity: {
    version: "0.8.20", // Or your contract's pragma
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000, // <--- INCREASE THIS SIGNIFICANTLY (e.g., 1000, 2000, 5000)
      },
      viaIR: true,    // <--- ENSURE THIS IS TRUE
    },

  },
  networks: {
    hardhat: {
      // Configuration for the local Hardhat Network
      // forking: { // Example: To fork mainnet for testing adapters
      //   url: "YOUR_MAINNET_RPC_URL",
      //   blockNumber: LATEST_BLOCK_NUMBER // Optional: pin to a block
      // }
    },
    baseTenderly: {
      url: "https://virtual.base.rpc.tenderly.co/cf8f88d7-1bdc-45f4-9260-f7d32fff3ba6",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    // localhost: { // Example: For a local node like Ganache
    //   url: "http://127.0.0.1:8545",
    // },
    // sepolia: { // Example: For deploying to a testnet
    //   url: "YOUR_SEPOLIA_RPC_URL",
    //   accounts: ["YOUR_PRIVATE_KEY_1", "YOUR_PRIVATE_KEY_2"]
    // }
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: "YOUR_ETHERSCAN_API_KEY" // Optional, for contract verification
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  mocha: {
    timeout: 40000 // Optional: extend timeout for long tests
  }
};