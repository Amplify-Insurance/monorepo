const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CatShare", function () {
  it("owner can mint and burn", async function () {
    const [owner, user] = await ethers.getSigners();
    const CatShare = await ethers.getContractFactory("CatShare");
    const token = await CatShare.deploy();
    await expect(token.mint(user.address, 100))
      .to.emit(token, "Transfer")
      .withArgs(ethers.ZeroAddress, user.address, 100);
    expect(await token.balanceOf(user.address)).to.equal(100);
    await expect(token.burn(user.address, 40))
      .to.emit(token, "Transfer")
      .withArgs(user.address, ethers.ZeroAddress, 40);
    expect(await token.balanceOf(user.address)).to.equal(60);
  });

  it("non-owner cannot mint or burn", async function () {
    const [owner, user] = await ethers.getSigners();
    const CatShare = await ethers.getContractFactory("CatShare");
    const token = await CatShare.deploy();
    await expect(token.connect(user).mint(user.address, 1)).to.be.revertedWithCustomError(
      token,
      "OwnableUnauthorizedAccount"
    );
    await token.mint(owner.address, 10);
    await expect(token.connect(user).burn(owner.address, 1)).to.be.revertedWithCustomError(
      token,
      "OwnableUnauthorizedAccount"
    );
  });
});