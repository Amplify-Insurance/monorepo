const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

async function deployFixture() {
  const [owner, policyManager, user, other] = await ethers.getSigners();
  const PolicyNFT = await ethers.getContractFactory("PolicyNFT");
  const policyNFT = await PolicyNFT.deploy(ethers.ZeroAddress, owner.address);
  return { owner, policyManager, user, other, policyNFT };
}

describe("PolicyNFT", function () {
  describe("Deployment", function () {
    it("Initial state", async function () {
      const { owner, policyNFT } = await loadFixture(deployFixture);
      expect(await policyNFT.owner()).to.equal(owner.address);
      expect(await policyNFT.nextId()).to.equal(1n);
      expect(await policyNFT.policyManagerContract()).to.equal(ethers.ZeroAddress);
      expect(await policyNFT.name()).to.equal("Policy");
      expect(await policyNFT.symbol()).to.equal("PCOVER");
    });
  });

  describe("setPolicyManagerAddress", function () {
    it("Only owner can set", async function () {
      const { owner, policyManager, other, policyNFT } = await loadFixture(deployFixture);
      await expect(policyNFT.connect(other).setPolicyManagerAddress(policyManager.address))
        .to.be.revertedWithCustomError(policyNFT, "OwnableUnauthorizedAccount")
        .withArgs(other.address);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      expect(await policyNFT.policyManagerContract()).to.equal(policyManager.address);
    });

    it("Emits event on update", async function () {
      const { owner, policyManager, policyNFT } = await loadFixture(deployFixture);
      await expect(policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address))
        .to.emit(policyNFT, "PolicyManagerAddressSet")
        .withArgs(policyManager.address);
    });

    it("Cannot set zero address", async function () {
      const { owner, policyNFT } = await loadFixture(deployFixture);
      await expect(policyNFT.connect(owner).setPolicyManagerAddress(ethers.ZeroAddress))
        .to.be.revertedWith("PolicyNFT: Address cannot be zero");
    });

    it("Allows owner to change manager and restrict access to new one", async function () {
      const { owner, policyManager, other, user, policyNFT } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await expect(policyNFT.connect(owner).setPolicyManagerAddress(other.address))
        .to.emit(policyNFT, "PolicyManagerAddressSet")
        .withArgs(other.address);

      await expect(policyNFT.connect(policyManager).mint(user.address, 1, 1000, 0, 0, 0))
        .to.be.revertedWith("PolicyNFT: Caller is not the authorized PolicyManager");

      await policyNFT.connect(other).mint(user.address, 1, 1000, 0, 0, 0);
      expect(await policyNFT.ownerOf(1)).to.equal(user.address);
    });
  });

  describe("mint", function () {
    const poolId = 1n;
    const coverage = 1000n;
    const activation = 12345n;
    const premiumDeposit = 1000n;
    const lastDrainTime = 12346n;

    it("Reverts if manager address not set", async function () {
      const { policyNFT, policyManager, user } = await loadFixture(deployFixture);
      await expect(
        policyNFT.connect(policyManager).mint(user.address, poolId, coverage, activation, premiumDeposit, lastDrainTime)
      ).to.be.revertedWith("PolicyNFT: PolicyManager address not set");
    });

    it("Only manager can mint and policy is stored", async function () {
      const { owner, policyNFT, policyManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);

      await expect(
        policyNFT.connect(owner).mint(user.address, poolId, coverage, activation, premiumDeposit, lastDrainTime)
      ).to.be.revertedWith("PolicyNFT: Caller is not the authorized PolicyManager");

      const tx = await policyNFT
        .connect(policyManager)
        .mint(user.address, poolId, coverage, activation, premiumDeposit, lastDrainTime);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(policyNFT, "Transfer")
        .withArgs(ethers.ZeroAddress, user.address, 1n);

      expect(await policyNFT.nextId()).to.equal(2n);
      const policy = await policyNFT.getPolicy(1n);
      expect(policy.coverage).to.equal(coverage);
      expect(policy.poolId).to.equal(poolId);
      expect(policy.activation).to.equal(activation);
      expect(policy.premiumDeposit).to.equal(premiumDeposit);
      expect(policy.lastDrainTime).to.equal(lastDrainTime);
      expect(policy.start).to.equal(BigInt(block.timestamp));
      expect(await policyNFT.ownerOf(1n)).to.equal(user.address);
    });

    it("Returns the minted token id", async function () {
      const { owner, policyNFT, policyManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      const tx = await policyNFT.connect(policyManager).mint(user.address, poolId, coverage, activation, premiumDeposit, lastDrainTime);
      const receipt = await tx.wait();
      const tokenId = receipt.logs
        .filter((l) => l.fragment && l.fragment.name === "Transfer")[0]
        .args[2];
      expect(tokenId).to.equal(1n);
    });

    it("Cannot mint to the zero address", async function () {
      const { owner, policyNFT, policyManager } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await expect(
        policyNFT.connect(policyManager).mint(ethers.ZeroAddress, poolId, coverage, activation, premiumDeposit, lastDrainTime)
      )
        .to.be.revertedWithCustomError(policyNFT, "ERC721InvalidReceiver")
        .withArgs(ethers.ZeroAddress);
    });

    it("Increments token ids sequentially", async function () {
      const { owner, policyNFT, policyManager, user, other } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await policyNFT.connect(policyManager).mint(user.address, poolId, coverage, activation, premiumDeposit, lastDrainTime);
      await policyNFT.connect(policyManager).mint(other.address, poolId, coverage, activation, premiumDeposit, lastDrainTime);
      expect(await policyNFT.nextId()).to.equal(3n);
      expect(await policyNFT.ownerOf(1n)).to.equal(user.address);
      expect(await policyNFT.ownerOf(2n)).to.equal(other.address);
    });
  });

  describe("burn", function () {
    it("Burns token and deletes policy", async function () {
      const { owner, policyNFT, policyManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await policyNFT.connect(policyManager).mint(user.address, 1, 1000, 0, 0, 0);

      await expect(policyNFT.connect(owner).burn(1)).to.be.revertedWith(
        "PolicyNFT: Caller is not the authorized PolicyManager"
      );

      await policyNFT.connect(policyManager).burn(1);
      await expect(policyNFT.ownerOf(1)).to.be.reverted;
      const policy = await policyNFT.getPolicy(1);
      expect(policy.coverage).to.equal(0n);
      expect(policy.poolId).to.equal(0n);
      expect(policy.start).to.equal(0n);
      expect(policy.activation).to.equal(0n);
      expect(policy.premiumDeposit).to.equal(0n);
      expect(policy.lastDrainTime).to.equal(0n);
    });

    it("Emits a Transfer event on burn", async function () {
      const { owner, policyNFT, policyManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await policyNFT.connect(policyManager).mint(user.address, 1, 1000, 0, 0, 0);

      await expect(policyNFT.connect(policyManager).burn(1))
        .to.emit(policyNFT, "Transfer")
        .withArgs(user.address, ethers.ZeroAddress, 1n);
    });

    it("Reverts when token does not exist", async function () {
      const { owner, policyManager, policyNFT } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await expect(policyNFT.connect(policyManager).burn(1))
        .to.be.revertedWithCustomError(policyNFT, "ERC721NonexistentToken")
        .withArgs(1);
    });
  });

  describe("updatePremiumAccount", function () {
    it("Reverts if manager address not set", async function () {
      const { policyNFT, policyManager } = await loadFixture(deployFixture);
      await expect(policyNFT.connect(policyManager).updatePremiumAccount(1, 0, 0))
        .to.be.revertedWith("PolicyNFT: PolicyManager address not set");
    });

    it("Reverts if caller is not manager", async function () {
      const { owner, other, policyNFT, policyManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await policyNFT.connect(policyManager).mint(user.address, 1, 1000, 0, 0, 0);
      await expect(policyNFT.connect(other).updatePremiumAccount(1, 0, 0))
        .to.be.revertedWith("PolicyNFT: Caller is not the authorized PolicyManager");
    });

    it("Updates premium fields and emits event", async function () {
      const { owner, policyNFT, policyManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await policyNFT.connect(policyManager).mint(user.address, 1, 1000, 0, 500, 0);

      const newDeposit = 300n;
      const newDrainTime = 5000n;
      await expect(policyNFT.connect(owner).updatePremiumAccount(1, newDeposit, newDrainTime)).to.be.revertedWith(
        "PolicyNFT: Caller is not the authorized PolicyManager"
      );

      await expect(policyNFT.connect(policyManager).updatePremiumAccount(2, newDeposit, newDrainTime)).to.be.revertedWith(
        "PolicyNFT: Policy does not exist or has been burned"
      );

      await expect(policyNFT.connect(policyManager).updatePremiumAccount(1, newDeposit, newDrainTime))
        .to.emit(policyNFT, "PolicyPremiumAccountUpdated")
        .withArgs(1n, newDeposit, newDrainTime);

      const policy = await policyNFT.getPolicy(1);
      expect(policy.premiumDeposit).to.equal(newDeposit);
      expect(policy.lastDrainTime).to.equal(newDrainTime);
    });

    it("Reverts if policy was burned", async function () {
      const { owner, policyNFT, policyManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await policyNFT.connect(policyManager).mint(user.address, 1, 1000, 0, 0, 0);
      await policyNFT.connect(policyManager).burn(1);
      await expect(policyNFT.connect(policyManager).updatePremiumAccount(1, 0, 0)).to.be.revertedWith(
        "PolicyNFT: Policy does not exist or has been burned"
      );
    });
  });

  describe("updateCoverage", function () {
    it("Reverts if manager not set", async function () {
      const { policyNFT, policyManager } = await loadFixture(deployFixture);
      await expect(policyNFT.connect(policyManager).updateCoverage(1, 1000)).to.be.revertedWith(
        "PolicyNFT: PolicyManager address not set"
      );
    });

    it("Reverts if caller is not manager", async function () {
      const { owner, policyNFT, policyManager, other } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await expect(policyNFT.connect(other).updateCoverage(1, 1000)).to.be.revertedWith(
        "PolicyNFT: Caller is not the authorized PolicyManager"
      );
    });

    it("Reverts if policy does not exist", async function () {
      const { owner, policyNFT, policyManager } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await expect(policyNFT.connect(policyManager).updateCoverage(1, 1000)).to.be.revertedWith(
        "PolicyNFT: Policy does not exist or has been burned"
      );
    });

    it("Reverts if new coverage not higher", async function () {
      const { owner, policyNFT, policyManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await policyNFT.connect(policyManager).mint(user.address, 1, 1000, 0, 0, 0);
      await expect(policyNFT.connect(policyManager).updateCoverage(1, 500)).to.be.revertedWith(
        "PolicyNFT: New coverage must be greater than current"
      );
    });

    it("Updates coverage and emits event", async function () {
      const { owner, policyNFT, policyManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await policyNFT.connect(policyManager).mint(user.address, 1, 1000, 0, 0, 0);
      await expect(policyNFT.connect(policyManager).updateCoverage(1, 1500))
        .to.emit(policyNFT, "PolicyCoverageUpdated")
        .withArgs(1n, 1500n);
      const policy = await policyNFT.getPolicy(1);
      expect(policy.coverage).to.equal(1500n);
    });
  });

  describe("pending increase workflow", function () {
    it("Adds and finalizes a pending increase", async function () {
      const { owner, policyNFT, policyManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await policyNFT.connect(policyManager).mint(user.address, 1, 1000, 0, 0, 0);

      const activation = (await time.latest()) + 100;
      await expect(policyNFT.connect(policyManager).addPendingIncrease(1, 200, activation))
        .to.emit(policyNFT, "PendingIncreaseAdded")
        .withArgs(1n, 200n, activation);

      await expect(policyNFT.connect(policyManager).finalizeIncrease(1)).to.be.revertedWith(
        "PolicyNFT: Cooldown still active"
      );

      await time.increaseTo(activation + 1);
      await expect(policyNFT.connect(policyManager).finalizeIncrease(1))
        .to.emit(policyNFT, "PolicyCoverageIncreased")
        .withArgs(1n, 1200n);

      const policy = await policyNFT.getPolicy(1);
      expect(policy.coverage).to.equal(1200n);
      expect(policy.pendingIncrease).to.equal(0n);
      expect(policy.increaseActivationTimestamp).to.equal(0n);
    });

    it("Reverts if increase already pending", async function () {
      const { owner, policyNFT, policyManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await policyNFT.connect(policyManager).mint(user.address, 1, 1000, 0, 0, 0);
      const activation = (await time.latest()) + 100;
      await policyNFT.connect(policyManager).addPendingIncrease(1, 200, activation);
      await expect(policyNFT.connect(policyManager).addPendingIncrease(1, 50, activation)).to.be.revertedWith(
        "PolicyNFT: An increase is already pending"
      );
    });

    it("Reverts if manager address not set when adding", async function () {
      const { policyNFT, policyManager } = await loadFixture(deployFixture);
      await expect(
        policyNFT.connect(policyManager).addPendingIncrease(1, 100, 0)
      ).to.be.revertedWith("PolicyNFT: PolicyManager address not set");
    });

    it("Reverts if caller is not manager when adding", async function () {
      const { owner, policyNFT, policyManager, other, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await policyNFT.connect(policyManager).mint(user.address, 1, 1000, 0, 0, 0);
      await expect(
        policyNFT.connect(other).addPendingIncrease(1, 100, 0)
      ).to.be.revertedWith("PolicyNFT: Caller is not the authorized PolicyManager");
    });

    it("Reverts if policy does not exist when adding", async function () {
      const { owner, policyNFT, policyManager } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await expect(
        policyNFT.connect(policyManager).addPendingIncrease(1, 100, 0)
      ).to.be.revertedWith("PolicyNFT: Policy does not exist");
    });

    it("Reverts if manager address not set when finalizing", async function () {
      const { policyNFT, policyManager } = await loadFixture(deployFixture);
      await expect(
        policyNFT.connect(policyManager).finalizeIncrease(1)
      ).to.be.revertedWith("PolicyNFT: PolicyManager address not set");
    });

    it("Reverts if caller is not manager when finalizing", async function () {
      const { owner, policyNFT, policyManager, other, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await policyNFT.connect(policyManager).mint(user.address, 1, 1000, 0, 0, 0);
      await policyNFT.connect(policyManager).addPendingIncrease(1, 100, 0);
      await expect(
        policyNFT.connect(other).finalizeIncrease(1)
      ).to.be.revertedWith("PolicyNFT: Caller is not the authorized PolicyManager");
    });

    it("Reverts if no pending increase when finalizing", async function () {
      const { owner, policyNFT, policyManager, user } = await loadFixture(deployFixture);
      await policyNFT.connect(owner).setPolicyManagerAddress(policyManager.address);
      await policyNFT.connect(policyManager).mint(user.address, 1, 1000, 0, 0, 0);
      await expect(
        policyNFT.connect(policyManager).finalizeIncrease(1)
      ).to.be.revertedWith("PolicyNFT: No pending increase");
    });
  });

  describe("getPolicy", function () {
    it("Returns zero struct for unknown id", async function () {
      const { policyNFT } = await loadFixture(deployFixture);
      const policy = await policyNFT.getPolicy(99);
      expect(policy.coverage).to.equal(0);
      expect(policy.poolId).to.equal(0);
      expect(policy.start).to.equal(0);
    });
  });
});
