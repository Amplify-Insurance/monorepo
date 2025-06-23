const { expect } = require("chai");
const { ethers } = require("hardhat");

async function deployFixture() {
  const ERC20 = await ethers.getContractFactory("MockERC20");
  const token = await ERC20.deploy("Token", "TKN", 6);
  const Multicall = await ethers.getContractFactory("MulticallReader");
  const multicall = await Multicall.deploy();
  return { token, multicall };
}

describe("MulticallReader", function () {
  it("aggregates calls and returns block info", async function () {
    const { token, multicall } = await deployFixture();
    const block = await ethers.provider.getBlock("latest");
    const iface = token.interface;
    const calls = [
      { target: token.target, callData: iface.encodeFunctionData("name") },
      { target: token.target, callData: iface.encodeFunctionData("decimals") },
    ];
    const [num, data] = await multicall.aggregate.staticCall(calls);
    expect(num).to.equal(block.number);
    const name = iface.decodeFunctionResult("name", data[0])[0];
    const decimals = iface.decodeFunctionResult("decimals", data[1])[0];
    expect(name).to.equal("Token");
    expect(decimals).to.equal(6);
  });

  it("reverts when a call fails in aggregate", async function () {
    const { token, multicall } = await deployFixture();
    const calls = [
      { target: token.target, callData: "0xdeadbeef" },
    ];
    await expect(multicall.aggregate(calls)).to.be.revertedWith(
      "Multicall: call failed"
    );
  });

  it("tryAggregate allows failures", async function () {
    const { token, multicall } = await deployFixture();
    const iface = token.interface;
    const calls = [
      { target: token.target, callData: "0xdeadbeef" },
      { target: token.target, callData: iface.encodeFunctionData("symbol") },
    ];
    const results = await multicall.tryAggregate.staticCall(false, calls);
    expect(results[0].success).to.be.false;
    expect(results[1].success).to.be.true;
    const symbol = iface.decodeFunctionResult("symbol", results[1].returnData)[0];
    expect(symbol).to.equal("TKN");
  });

  it("exposes block helpers", async function () {
    const { multicall } = await deployFixture();
    const block = await ethers.provider.getBlock("latest");
    expect(await multicall.getBlockNumber()).to.equal(block.number);
    expect(await multicall.getCurrentBlockTimestamp()).to.equal(block.timestamp);
  });
});