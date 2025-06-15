const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

async function deployFixture() {
  const [owner] = await ethers.getSigners();
  const ERC20 = await ethers.getContractFactory("MockERC20");
  const Token = await ERC20.deploy("Mock Token", "MTK", 6);

  const Aggregator = await ethers.getContractFactory("MockAggregator");
  const price = 2000n * 10n ** 8n; // $2000 with 8 decimals
  const aggregator = await Aggregator.deploy(price, 8);

  const Oracle = await ethers.getContractFactory("PriceOracle");
  const oracle = await Oracle.deploy(owner.address);
  await oracle.setAggregator(Token.target, aggregator.target);

  return { Token, oracle };
}

describe("PriceOracle", function () {
  it("calculates USD value", async function () {
    const { Token, oracle } = await loadFixture(deployFixture);
    const amount = 50n * 10n ** 6n; // 50 tokens with 6 decimals
    const usd = await oracle.getUsdValue(Token.target, amount);
    const expected = 100000n * 10n ** 18n; // $100,000 with 18 decimals
    expect(usd).to.equal(expected);
  });

  it("returns zero for unknown tokens", async function () {
    const { oracle } = await loadFixture(deployFixture);
    const ERC20 = await ethers.getContractFactory("MockERC20");
    const Unknown = await ERC20.deploy("Unknown", "UNK", 18);

    const [price, decimals] = await oracle.getLatestUsdPrice(Unknown.target);
    expect(price).to.equal(0n);
    expect(decimals).to.equal(0);

    const value = await oracle.getUsdValue(Unknown.target, 1000n);
    expect(value).to.equal(0n);
  });
});
