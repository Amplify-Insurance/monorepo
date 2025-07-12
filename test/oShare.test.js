const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OShare", function () {
  async function deployFixture() {
    const [pool, other] = await ethers.getSigners();
    const ERC20 = await ethers.getContractFactory("MockERC20");
    const asset = await ERC20.deploy("Mock", "MOCK", 6);
    const oShareFactory = await ethers.getContractFactory("OShare");
    const token = await oShareFactory.deploy(asset.target, pool.address, "OShare", "OSH");
    return { pool, other, asset, token };
  }

  it("initializes with correct parameters", async function () {
    const { pool, asset, token } = await deployFixture();
    expect(await token.asset()).to.equal(asset.target);
    expect(await token.pool()).to.equal(pool.address);
    expect(await token.name()).to.equal("OShare");
    expect(await token.symbol()).to.equal("OSH");
  });

  it("only pool can mint and burn", async function () {
    const { pool, other, token } = await deployFixture();
    await expect(token.connect(pool).mint(other.address, 50))
      .to.emit(token, "Transfer")
      .withArgs(ethers.ZeroAddress, other.address, 50);
    await expect(token.connect(other).mint(other.address, 1)).to.be.revertedWith(
      "OShare: only pool"
    );
    await expect(token.connect(pool).burn(other.address, 20))
      .to.emit(token, "Transfer")
      .withArgs(other.address, ethers.ZeroAddress, 20);
    await expect(token.connect(other).burn(other.address, 1)).to.be.revertedWith(
      "OShare: only pool"
    );
  });
});