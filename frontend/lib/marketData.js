// lib/marketData.js

// Define and export your markets data here
export const markets = [
    {
      id: "aave",
      name: "Aave",
      description: "Decentralized lending protocol",
      tvl: 5200000000,
      pools: [
        {
          token: "ETH",
          premium: 2.5,
          underwriterYield: 4.2,
          tvl: 1200000000,
          price: 3500,
          utilizationRate: 34.81,
          reserveFactor: 15,
          liquidationThreshold: 73.0,
          liquidationPenalty: 9.0,
          maxLTV: 68.0,
          optimalUtilization: 80,
          baseRate: 0,
          slope1: 0.04,
          slope2: 0.6,
        },
        {
          token: "USDC",
          premium: 1.8,
          underwriterYield: 3.5,
          tvl: 980000000,
          price: 1,
          utilizationRate: 42.15,
          reserveFactor: 10,
          liquidationThreshold: 80.0,
          liquidationPenalty: 5.0,
          maxLTV: 75.0,
          optimalUtilization: 85,
          baseRate: 0.005,
          slope1: 0.03,
          slope2: 0.55,
        },
        {
          token: "BTC",
          premium: 2.2,
          underwriterYield: 3.8,
          tvl: 850000000,
          price: 62000,
          utilizationRate: 38.42,
          reserveFactor: 15,
          liquidationThreshold: 70.0,
          liquidationPenalty: 10.0,
          maxLTV: 65.0,
          optimalUtilization: 80,
          baseRate: 0,
          slope1: 0.04,
          slope2: 0.6,
        },
        {
          token: "AVAX",
          premium: 2.6,
          underwriterYield: 4.4,
          tvl: 450000000,
          price: 21.52,
          utilizationRate: 34.81,
          reserveFactor: 20,
          liquidationThreshold: 65.0,
          liquidationPenalty: 12.0,
          maxLTV: 60.0,
          optimalUtilization: 75,
          baseRate: 0.01,
          slope1: 0.05,
          slope2: 0.7,
        },
      ],
    },
    {
      id: "compound",
      name: "Compound",
      description: "Algorithmic money market protocol",
      tvl: 3800000000,
      pools: [
        {
          token: "ETH",
          premium: 2.3,
          underwriterYield: 3.9,
          tvl: 950000000,
          price: 3500,
          utilizationRate: 32.67,
          reserveFactor: 15,
          liquidationThreshold: 75.0,
          liquidationPenalty: 8.0,
          maxLTV: 70.0,
          optimalUtilization: 80,
          baseRate: 0,
          slope1: 0.04,
          slope2: 0.6,
        },
        {
          token: "USDC",
          premium: 1.5,
          underwriterYield: 3.2,
          tvl: 1100000000,
          price: 1,
          utilizationRate: 45.23,
          reserveFactor: 10,
          liquidationThreshold: 82.0,
          liquidationPenalty: 5.0,
          maxLTV: 77.0,
          optimalUtilization: 85,
          baseRate: 0.005,
          slope1: 0.03,
          slope2: 0.55,
        },
        {
          token: "AVAX",
          premium: 2.4,
          underwriterYield: 4.1,
          tvl: 320000000,
          price: 21.52,
          utilizationRate: 36.45,
          reserveFactor: 20,
          liquidationThreshold: 67.0,
          liquidationPenalty: 11.0,
          maxLTV: 62.0,
          optimalUtilization: 75,
          baseRate: 0.01,
          slope1: 0.05,
          slope2: 0.7,
        },
      ],
    },
    // Add other markets if they exist...
    { id: "morpho", name: "Morpho", description: "Peer-to-peer lending protocol", tvl: 2100000000, pools: [/*...*/] },
    { id: "yearn", name: "Yearn Finance", description: "Yield aggregator protocol", tvl: 1500000000, pools: [/*...*/] },
    { id: "layerbank", name: "LayerBank", description: "Cross-layer lending protocol", tvl: 980000000, pools: [/*...*/] },
  ];
  
  // You could also move helper functions like generateHistoricalData, calculateRate, etc.
  // here or into another utility file (e.g., lib/chartUtils.js) if they
  // aren't strictly tied only to the PoolDetailsPage component.
  // For now, we'll leave them in the page component file.