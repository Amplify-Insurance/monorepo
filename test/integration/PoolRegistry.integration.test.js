const { expect } = require("chai");
const { ethers } = require("hardhat");

// Simple fixture to deploy PoolRegistry and a real ERC20 token
async function deployFixture() {
  const [owner, riskManager, other] = await ethers.getSigners();

  // Use the actual CatShare token contract instead of a mock
  const CatShare = await ethers.getContractFactory("CatShare");
  const token = await CatShare.deploy();
  await token.waitForDeployment();

  const PoolRegistry = await ethers.getContractFactory("PoolRegistry");
  const registry = await PoolRegistry.deploy(owner.address, riskManager.address);
  await registry.waitForDeployment();

  const rateModel = {
    base: ethers.parseUnits("1", 18),
    slope1: ethers.parseUnits("2", 18),
    slope2: ethers.parseUnits("3", 18),
    kink: ethers.parseUnits("0.8", 18),
  };

  return { owner, riskManager, other, registry, token, rateModel };
}

describe("PoolRegistry integration", function () {
  it("allows risk manager to create a pool and stores data", async function () {
    const { riskManager, registry, token, rateModel } = await deployFixture();

    await registry
      .connect(riskManager)
      .addProtocolRiskPool(token.target, rateModel, 500);
    const poolId = 0;

    expect(poolId).to.equal(0);
    expect(await registry.getPoolCount()).to.equal(1);

    const poolData = await registry.getPoolData(poolId);
    expect(poolData.protocolTokenToCover).to.equal(token.target);
    expect(poolData.totalCapitalPledgedToPool).to.equal(0);
    expect(poolData.totalCoverageSold).to.equal(0);
    expect(poolData.isPaused).to.be.false;
    expect(poolData.feeRecipient).to.equal(ethers.ZeroAddress);
    expect(poolData.claimFeeBps).to.equal(500);

    const rm = await registry.getPoolRateModel(poolId);
    expect(rm.base).to.equal(rateModel.base);
    expect(rm.slope1).to.equal(rateModel.slope1);
    expect(rm.slope2).to.equal(rateModel.slope2);
    expect(rm.kink).to.equal(rateModel.kink);
  });

  it("handles capital allocation and deallocation", async function () {
    const { riskManager, registry, token, rateModel } = await deployFixture();

    await registry
      .connect(riskManager)
      .addProtocolRiskPool(token.target, rateModel, 0);

    const adapter = ethers.Wallet.createRandom().address;
    const amount = ethers.parseUnits("1000", 18);

    await registry
      .connect(riskManager)
      .updateCapitalAllocation(0, adapter, amount, true);

    let poolData = await registry.getPoolData(0);
    expect(poolData.totalCapitalPledgedToPool).to.equal(amount);
    expect(await registry.getCapitalPerAdapter(0, adapter)).to.equal(amount);
    let adapters = await registry.getPoolActiveAdapters(0);
    expect(adapters).to.deep.equal([adapter]);

    await registry
      .connect(riskManager)
      .updateCapitalAllocation(0, adapter, amount, false);

    poolData = await registry.getPoolData(0);
    expect(poolData.totalCapitalPledgedToPool).to.equal(0);
    expect(await registry.getCapitalPerAdapter(0, adapter)).to.equal(0);
    adapters = await registry.getPoolActiveAdapters(0);
    expect(adapters).to.have.lengthOf(0);
  });

  it("allows pausing and unpausing of a pool", async function () {
    const { riskManager, registry, token, rateModel } = await deployFixture();

    await registry
      .connect(riskManager)
      .addProtocolRiskPool(token.target, rateModel, 0);

    await registry.connect(riskManager).setPauseState(0, true);
    let poolData = await registry.getPoolData(0);
    expect(poolData.isPaused).to.be.true;
    const poolStruct = await registry.protocolRiskPools(0);
    expect(poolStruct.pauseTimestamp).to.be.gt(0);

    await registry.connect(riskManager).setPauseState(0, false);
    poolData = await registry.getPoolData(0);
    expect(poolData.isPaused).to.be.false;
    const poolStructAfter = await registry.protocolRiskPools(0);
    expect(poolStructAfter.pauseTimestamp).to.equal(0);
  });

  it("updates pending withdrawal and coverage sold counts", async function () {
    const { riskManager, registry, token, rateModel } = await deployFixture();

    await registry
      .connect(riskManager)
      .addProtocolRiskPool(token.target, rateModel, 0);

    const amt = ethers.parseUnits("500", 18);

    // pending withdrawal increase/decrease
    await registry.connect(riskManager).updateCapitalPendingWithdrawal(0, amt, true);
    let pool = await registry.getPoolData(0);
    expect(pool.capitalPendingWithdrawal).to.equal(amt);

    await registry.connect(riskManager).updateCapitalPendingWithdrawal(0, amt, false);
    pool = await registry.getPoolData(0);
    expect(pool.capitalPendingWithdrawal).to.equal(0);

    // coverage sold increase/decrease
    await registry.connect(riskManager).updateCoverageSold(0, amt, true);
    pool = await registry.getPoolData(0);
    expect(pool.totalCoverageSold).to.equal(amt);

    await registry.connect(riskManager).updateCoverageSold(0, amt, false);
    pool = await registry.getPoolData(0);
    expect(pool.totalCoverageSold).to.equal(0);
  });

  it("stores a fee recipient and isolates multiple pools", async function () {
    const { riskManager, registry, token, rateModel } = await deployFixture();

    await registry.connect(riskManager).addProtocolRiskPool(token.target, rateModel, 0);
    await registry.connect(riskManager).addProtocolRiskPool(token.target, rateModel, 0);

    const recipient = ethers.Wallet.createRandom().address;
    await registry.connect(riskManager).setFeeRecipient(0, recipient);

    expect((await registry.getPoolData(0)).feeRecipient).to.equal(recipient);
    expect((await registry.getPoolData(1)).feeRecipient).to.equal(ethers.ZeroAddress);

    const amount = ethers.parseUnits("100", 18);
    const adapter0 = ethers.Wallet.createRandom().address;
    const adapter1 = ethers.Wallet.createRandom().address;
    await registry.connect(riskManager).updateCapitalAllocation(0, adapter0, amount, true);
    await registry.connect(riskManager).updateCapitalAllocation(1, adapter1, amount, true);

    const pool0 = await registry.getPoolData(0);
    const pool1 = await registry.getPoolData(1);
    expect(pool0.totalCapitalPledgedToPool).to.equal(amount);
    expect(pool1.totalCapitalPledgedToPool).to.equal(amount);
  });

  it("allows resetting the fee recipient", async function () {
    const { riskManager, registry, token, rateModel } = await deployFixture();

    await registry.connect(riskManager).addProtocolRiskPool(token.target, rateModel, 0);

    const recipient = ethers.Wallet.createRandom().address;
    await registry.connect(riskManager).setFeeRecipient(0, recipient);
    expect((await registry.getPoolData(0)).feeRecipient).to.equal(recipient);

    await registry.connect(riskManager).setFeeRecipient(0, ethers.ZeroAddress);
    expect((await registry.getPoolData(0)).feeRecipient).to.equal(ethers.ZeroAddress);
  });

  it("allows owner to change risk manager and new manager gains permissions", async function () {
    const { owner, riskManager, registry, token, rateModel } = await deployFixture();

    const [, , newRM] = await ethers.getSigners();

    await registry.connect(riskManager).addProtocolRiskPool(token.target, rateModel, 0);

    await expect(registry.connect(owner).setRiskManager(newRM.address)).to.not.be.reverted;

    await expect(
      registry.connect(newRM).updateCoverageSold(0, 1, true)
    ).to.not.be.reverted;

    await expect(
      registry.connect(riskManager).updateCoverageSold(0, 1, true)
    ).to.be.revertedWith("PR: Not RiskManager");
  });

  it("prevents non-owner from changing the risk manager", async function () {
    const { riskManager, registry, token, rateModel } = await deployFixture();

    const [, nonOwner] = await ethers.getSigners();

    await registry.connect(riskManager).addProtocolRiskPool(token.target, rateModel, 0);

    await expect(
      registry.connect(nonOwner).setRiskManager(nonOwner.address)
    ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");

    // ensure original manager still has permissions
    await expect(
      registry.connect(riskManager).updateCoverageSold(0, 1, true)
    ).to.not.be.reverted;
  });

  it("returns payout data for adapters correctly", async function () {
    const { riskManager, registry, token, rateModel } = await deployFixture();

    await registry.connect(riskManager).addProtocolRiskPool(token.target, rateModel, 0);

    const adapterA = ethers.Wallet.createRandom().address;
    const adapterB = ethers.Wallet.createRandom().address;
    const amountA = ethers.parseUnits("50", 18);
    const amountB = ethers.parseUnits("75", 18);

    await registry.connect(riskManager).updateCapitalAllocation(0, adapterA, amountA, true);
    await registry.connect(riskManager).updateCapitalAllocation(0, adapterB, amountB, true);

    const [adapters, capitalPerAdapter, total] = await registry.getPoolPayoutData(0);

    const adapterList = Array.from(adapters);
    const capitalList = Array.from(capitalPerAdapter);

    expect(adapterList).to.have.members([adapterA, adapterB]);
    const idxA = adapterList.indexOf(adapterA);
    const idxB = adapterList.indexOf(adapterB);
    expect(capitalList[idxA]).to.equal(amountA);
    expect(capitalList[idxB]).to.equal(amountB);
    expect(total).to.equal(amountA + amountB);
  });

  it("returns empty payout data when no adapters", async function () {
    const { riskManager, registry, token, rateModel } = await deployFixture();

    await registry.connect(riskManager).addProtocolRiskPool(token.target, rateModel, 0);

    const [adapters, amounts, total] = await registry.getPoolPayoutData(0);
    expect(adapters).to.deep.equal([]);
    expect(amounts).to.deep.equal([]);
    expect(total).to.equal(0);
  });

  it("reflects adapter removal in payout data", async function () {
    const { riskManager, registry, token, rateModel } = await deployFixture();

    await registry
      .connect(riskManager)
      .addProtocolRiskPool(token.target, rateModel, 0);

    const adapter = ethers.Wallet.createRandom().address;
    const amount = ethers.parseUnits("100", 18);

    await registry
      .connect(riskManager)
      .updateCapitalAllocation(0, adapter, amount, true);

    await registry
      .connect(riskManager)
      .updateCapitalAllocation(0, adapter, amount, false);

    const [adapters, amounts, total] = await registry.getPoolPayoutData(0);
    expect(adapters).to.deep.equal([]);
    expect(amounts).to.deep.equal([]);
    expect(total).to.equal(0);
  });

  it("prevents non-risk manager from modifying pools", async function () {
    const { other, registry, token, rateModel } = await deployFixture();

    await expect(
      registry.connect(other).addProtocolRiskPool(token.target, rateModel, 0)
    ).to.be.revertedWith("PR: Not RiskManager");

    const [, riskManager] = await ethers.getSigners();
    await registry
      .connect(riskManager)
      .addProtocolRiskPool(token.target, rateModel, 0);

    const adapter = ethers.Wallet.createRandom().address;
    await expect(
      registry.connect(other).updateCapitalAllocation(0, adapter, 1, true)
    ).to.be.revertedWith("PR: Not RiskManager");
  });

  it("reverts when owner sets risk manager to zero address", async function () {
    const { owner, registry } = await deployFixture();

    await expect(
      registry.connect(owner).setRiskManager(ethers.ZeroAddress)
    ).to.be.revertedWith("PR: Zero address");
  });

  it("reverts when using an invalid pool id", async function () {
    const { riskManager, registry } = await deployFixture();

    const invalidId = 99;
    const adapter = ethers.Wallet.createRandom().address;

    await expect(registry.getPoolData(invalidId)).to.be.reverted;
    await expect(
      registry
        .connect(riskManager)
        .updateCapitalAllocation(invalidId, adapter, 1, true)
    ).to.be.reverted;
    await expect(
      registry
        .connect(riskManager)
        .updateCapitalPendingWithdrawal(invalidId, 1, true)
    ).to.be.reverted;
    await expect(
      registry.connect(riskManager).updateCoverageSold(invalidId, 1, true)
    ).to.be.reverted;
    await expect(
      registry.connect(riskManager).setPauseState(invalidId, true)
    ).to.be.reverted;
  });

  it("removes adapters from the middle correctly", async function () {
    const { riskManager, registry, token, rateModel } = await deployFixture();

    await registry
      .connect(riskManager)
      .addProtocolRiskPool(token.target, rateModel, 0);

    const adapters = [
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
      ethers.Wallet.createRandom().address,
    ];

    const amt = ethers.parseUnits("10", 18);
    for (const a of adapters) {
      await registry
        .connect(riskManager)
        .updateCapitalAllocation(0, a, amt, true);
    }

    await registry
      .connect(riskManager)
      .updateCapitalAllocation(0, adapters[1], amt, false);

    const active = await registry.getPoolActiveAdapters(0);
    expect(active).to.deep.equal([adapters[0], adapters[2]]);
    expect(await registry.getCapitalPerAdapter(0, adapters[1])).to.equal(0);
  });

  it("reverts on arithmetic underflow for allocations", async function () {
    const { riskManager, registry, token, rateModel } = await deployFixture();

    await registry
      .connect(riskManager)
      .addProtocolRiskPool(token.target, rateModel, 0);

    const adapter = ethers.Wallet.createRandom().address;
    const amount = ethers.parseUnits("50", 18);
    await registry
      .connect(riskManager)
      .updateCapitalAllocation(0, adapter, amount, true);

    await expect(
      registry
        .connect(riskManager)
        .updateCapitalAllocation(0, adapter, amount + 1n, false)
    ).to.be.revertedWithPanic(0x11);
  });

  it("reverts on arithmetic underflow for pending withdrawals", async function () {
    const { riskManager, registry, token, rateModel } = await deployFixture();

    await registry
      .connect(riskManager)
      .addProtocolRiskPool(token.target, rateModel, 0);

    const amount = ethers.parseUnits("25", 18);
    await registry
      .connect(riskManager)
      .updateCapitalPendingWithdrawal(0, amount, true);

    await expect(
      registry
        .connect(riskManager)
        .updateCapitalPendingWithdrawal(0, amount + 1n, false)
    ).to.be.revertedWithPanic(0x11);
  });

  it("reverts on arithmetic underflow for coverage sold", async function () {
    const { riskManager, registry, token, rateModel } = await deployFixture();

    await registry
      .connect(riskManager)
      .addProtocolRiskPool(token.target, rateModel, 0);

    const amount = ethers.parseUnits("10", 18);
    await registry.connect(riskManager).updateCoverageSold(0, amount, true);

    await expect(
      registry.connect(riskManager).updateCoverageSold(0, amount + 1n, false)
    ).to.be.revertedWithPanic(0x11);
  });
});
