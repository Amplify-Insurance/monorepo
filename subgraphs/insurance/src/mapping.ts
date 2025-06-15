import { ethereum, BigInt, Address, dataSource } from "@graphprotocol/graph-ts";
import { GenericEvent, Pool, Underwriter, Policy, ContractOwner, PoolUtilizationSnapshot, Claim, PolicyCreatedEvent, PolicyLapsedEvent, PremiumPaidEvent, GovernanceProposal, GovernanceVote } from "../generated/schema";
import {
  PoolAdded,
  IncidentReported,
  CapitalAllocated,
  CapitalDeallocated,
  PolicyCreated,
  PremiumPaid,
  PolicyLapsed,
  ClaimProcessed,
  PremiumRewardsClaimed,
  DistressedAssetRewardsClaimed,
  AddressesSet,
  CommitteeSet,
  UnderwriterLiquidated,
  OwnershipTransferred as RiskManagerOwnershipTransferred
} from "../generated/RiskManagerV2/RiskManager";
import { RiskManager } from "../generated/RiskManagerV2/RiskManager";
import {
  RiskManagerSet,
  BaseYieldAdapterSet,
  Deposit,
  WithdrawalRequested,
  WithdrawalExecuted,
  LossesApplied,
  SystemValueSynced,
  AdapterCallFailed,
  OwnershipTransferred as CapitalPoolOwnershipTransferred
} from "../generated/CapitalPool/CapitalPool";
import {
  AdapterChanged,
  CatLiquidityDeposited,
  CatLiquidityWithdrawn,
  CoverPoolAddressSet,
  DepositToAdapter,
  DrawFromFund,
  OwnershipTransferred as CatInsurancePoolOwnershipTransferred,
  ProtocolAssetReceivedForDistribution,
  ProtocolAssetRewardsClaimed,
  UsdcPremiumReceived,
  PolicyManagerAddressSet,
  RewardDistributorSet
} from "../generated/CatInsurancePool/CatInsurancePool";
import {
  AddressesSet as PMAddressesSet,
  CatPremiumShareSet,
  CatPoolSet
} from "../generated/PoolManager/PoolManager";
import {
  PolicyPremiumAccountUpdated,
  Transfer,
  RiskManagerAddressSet,
  OwnershipTransferred as PolicyNFTOwnershipTransferred,
  PolicyNFT
} from "../generated/PolicyNFT/PolicyNFT";
import {
  FundsWithdrawn,
  CapitalPoolAddressSet
} from "../generated/AaveV3Adapter/YieldAdapter";
import { ProposalCreated, Voted, ProposalExecuted, BondResolved, RewardClaimed } from "../generated/Committee/Committee";
import { OwnershipTransferred as PoolRegistryOwnershipTransferred } from "../generated/PoolRegistry/PoolRegistry";

function saveGeneric(event: ethereum.Event, name: string): void {
  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let entity = new GenericEvent(id);
  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";
  entity.deployment = deployment;
  entity.blockNumber = event.block.number;
  entity.timestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;
  entity.eventName = name;
  let params: string[] = [];
  for (let i = 0; i < event.parameters.length; i++) {
    let p = event.parameters[i];
    params.push(p.value.toString());
  }
  entity.data = params.join(",");
  entity.save();
}

function saveOwner(event: ethereum.Event, newOwner: Address): void {
  let id = event.address.toHex();
  let owner = ContractOwner.load(id);
  if (owner == null) {
    owner = new ContractOwner(id);
  }
  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";
  owner.deployment = deployment;
  owner.owner = newOwner;
  owner.save();
}

const BPS = BigInt.fromI32(10000);

function snapshotPool(
  rm: RiskManager,
  event: ethereum.Event,
  poolId: BigInt
): BigInt | null {
  let infoRes = rm.try_getPoolInfo(poolId);
  if (infoRes.reverted) {
    return null;
  }
  let info = infoRes.value;
  let totalCapital = info.totalCapitalPledgedToPool;
  let sold = info.totalCoverageSold;
  let utilization = totalCapital.equals(BigInt.zero())
    ? BigInt.zero()
    : sold.times(BPS).div(totalCapital);
  let base = info.rateModel.base;
  let slope1 = info.rateModel.slope1;
  let slope2 = info.rateModel.slope2;
  let kink = info.rateModel.kink;
  let rate = utilization.lt(kink)
    ? base.plus(slope1.times(utilization).div(BPS))
    : base
        .plus(slope1.times(kink).div(BPS))
        .plus(slope2.times(utilization.minus(kink)).div(BPS));

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";
  let snapId = deployment + "-" + poolId.toString() + "-" + event.block.number.toString();
  let snap = new PoolUtilizationSnapshot(snapId);
  snap.deployment = deployment;
  snap.pool = deployment + "-" + poolId.toString();
  snap.timestamp = event.block.timestamp;
  snap.blockNumber = event.block.number;
  snap.utilizationBps = utilization;
  snap.premiumRateBps = rate;
  snap.save();
  return rate;
}

// RiskManager events
export function handlePoolAdded(event: PoolAdded): void {
  saveGeneric(event, "PoolAdded");

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";

  let poolId = deployment + "-" + event.params.poolId.toString();
  let pool = new Pool(poolId);
  pool.deployment = deployment;
  pool.underlyingAsset = Address.zero();
  pool.protocolToken = event.params.protocolToken;
  pool.protocolCovered = event.params.protocolCovered;

  let rm = RiskManager.bind(event.address);
  let info = rm.try_getPoolInfo(event.params.poolId);
  if (!info.reverted) {
    pool.protocolCovered = info.value.protocolCovered;
    pool.protocolToken = info.value.protocolTokenToCover;
  }
  pool.save();
}

export function handleDeposit(event: Deposit): void {
  saveGeneric(event, "Deposit");

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";

  let id = deployment + "-" + event.params.user.toHex();
  let u = Underwriter.load(id);
  if (u == null) {
    u = new Underwriter(id);
    u.deployment = deployment;
    u.totalDeposited = BigInt.fromI32(0);
    u.masterShares = BigInt.fromI32(0);
  }
  u.totalDeposited = u.totalDeposited.plus(event.params.amount);
  u.masterShares = u.masterShares.plus(event.params.sharesMinted);
  u.save();
}
export function handleWithdrawalRequested(event: WithdrawalRequested): void { saveGeneric(event, "WithdrawalRequested"); }
export function handleWithdrawalExecuted(event: WithdrawalExecuted): void { saveGeneric(event, "WithdrawalExecuted"); }
export function handlePremiumPaid(event: PremiumPaid): void {
  saveGeneric(event, "PremiumPaid");

  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let ev = new PremiumPaidEvent(id);
  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";
  ev.deployment = deployment;
  ev.policyId = event.params.policyId;
  ev.poolId = event.params.poolId;
  ev.amountPaid = event.params.amountPaid;
  ev.catAmount = event.params.catAmount;
  ev.poolIncome = event.params.poolIncome;
  ev.timestamp = event.block.timestamp;
  ev.transactionHash = event.transaction.hash;
  ev.save();
}
export function handleClaimProcessed(event: ClaimProcessed): void {
  saveGeneric(event, "ClaimProcessed");
  let rm = RiskManager.bind(event.address);
  snapshotPool(rm, event, event.params.poolId);

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";

  let coverage = BigInt.zero();
  let policyAddr = rm.try_policyNFT();
  if (!policyAddr.reverted) {
    let policyNft = PolicyNFT.bind(policyAddr.value);
    let polRes = policyNft.try_getPolicy(event.params.policyId);
    if (!polRes.reverted) {
      coverage = polRes.value.coverage;
    }
  }

  let scale = BigInt.zero();
  let infoRes = rm.try_getPoolInfo(event.params.poolId);
  if (!infoRes.reverted) {
    scale = infoRes.value.scaleToProtocolToken;
  }

  let protocolTokenAmountReceived = coverage.times(scale);
  let net = event.params.netPayoutToClaimant;
  let claimFee = BigInt.zero();
  if (coverage > net) {
    claimFee = coverage.minus(net);
  }

  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let entity = new Claim(id);
  entity.deployment = deployment;
  entity.policyId = event.params.policyId;
  entity.poolId = event.params.poolId;
  entity.claimant = event.params.claimant;
  entity.coverage = coverage;
  entity.netPayoutToClaimant = net;
  entity.claimFee = claimFee;
  entity.protocolTokenAmountReceived = protocolTokenAmountReceived;
  entity.timestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;
  entity.save();
}
export function handleLossesApplied(event: LossesApplied): void { saveGeneric(event, "LossesApplied"); }
export function handleCapitalAllocated(event: CapitalAllocated): void {
  saveGeneric(event, "CapitalAllocated");
  let rm = RiskManager.bind(event.address);
  snapshotPool(rm, event, event.params.poolId);
}
export function handleCapitalDeallocated(event: CapitalDeallocated): void { saveGeneric(event, "CapitalDeallocated"); }
export function handleAddressesSet(event: AddressesSet): void { saveGeneric(event, "AddressesSet"); }
export function handleCommitteeSet(event: CommitteeSet): void { saveGeneric(event, "CommitteeSet"); }
export function handleUnderwriterLiquidated(event: UnderwriterLiquidated): void { saveGeneric(event, "UnderwriterLiquidated"); }
export function handlePolicyCreated(event: PolicyCreated): void {
  saveGeneric(event, "PolicyCreated");

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";

  let policyId = deployment + "-" + event.params.policyId.toString();
  let policy = new Policy(policyId);
  policy.deployment = deployment;
  policy.owner = event.params.user;
  policy.pool = deployment + "-" + event.params.poolId.toString();
  policy.coverageAmount = event.params.coverageAmount;
  policy.premiumPaid = event.params.premiumPaid;
  let rm = RiskManager.bind(event.address);
  let rate = snapshotPool(rm, event, event.params.poolId);
  policy.premiumRateBps = rate == null ? BigInt.fromI32(0) : rate as BigInt;
  policy.save();

  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let ev = new PolicyCreatedEvent(id);
  ev.deployment = deployment;
  ev.policyId = event.params.policyId;
  ev.poolId = event.params.poolId;
  ev.user = event.params.user;
  ev.coverage = event.params.coverageAmount;
  ev.timestamp = event.block.timestamp;
  ev.transactionHash = event.transaction.hash;
  ev.save();
}
export function handleIncidentReported(event: IncidentReported): void { saveGeneric(event, "IncidentReported"); }
export function handlePolicyLapsed(event: PolicyLapsed): void {
  saveGeneric(event, "PolicyLapsed");

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";

  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let ev = new PolicyLapsedEvent(id);
  ev.deployment = deployment;
  ev.policyId = event.params.policyId;
  ev.timestamp = event.block.timestamp;
  ev.transactionHash = event.transaction.hash;
  ev.save();
  let policy = Policy.load(deployment + "-" + event.params.policyId.toString());
  if (policy != null) {
    let rm = RiskManager.bind(event.address);
    snapshotPool(rm, event, BigInt.fromString(policy.pool.split("-")[1]));
  }
}
export function handleBaseYieldAdapterSet(event: BaseYieldAdapterSet): void { saveGeneric(event, "BaseYieldAdapterSet"); }
export function handleSystemValueSynced(event: SystemValueSynced): void { saveGeneric(event, "SystemValueSynced"); }
export function handleAdapterCallFailed(event: AdapterCallFailed): void { saveGeneric(event, "AdapterCallFailed"); }
export function handleRiskManagerSet(event: RiskManagerSet): void { saveGeneric(event, "RiskManagerSet"); }
export function handlePremiumRewardsClaimed(event: PremiumRewardsClaimed): void { saveGeneric(event, "PremiumRewardsClaimed"); }
export function handleDistressedAssetRewardsClaimed(event: DistressedAssetRewardsClaimed): void { saveGeneric(event, "DistressedAssetRewardsClaimed"); }

// CatInsurancePool events
export function handleAdapterChanged(event: AdapterChanged): void { saveGeneric(event, "AdapterChanged"); }
export function handleCatLiquidityDeposited(event: CatLiquidityDeposited): void { saveGeneric(event, "CatLiquidityDeposited"); }
export function handleCatLiquidityWithdrawn(event: CatLiquidityWithdrawn): void { saveGeneric(event, "CatLiquidityWithdrawn"); }
export function handleCoverPoolAddressSet(event: CoverPoolAddressSet): void { saveGeneric(event, "CoverPoolAddressSet"); }
export function handleDepositToAdapter(event: DepositToAdapter): void { saveGeneric(event, "DepositToAdapter"); }
export function handleDrawFromFund(event: DrawFromFund): void { saveGeneric(event, "DrawFromFund"); }
export function handleProtocolAssetReceivedForDistribution(event: ProtocolAssetReceivedForDistribution): void { saveGeneric(event, "ProtocolAssetReceivedForDistribution"); }
export function handleProtocolAssetRewardsClaimed(event: ProtocolAssetRewardsClaimed): void { saveGeneric(event, "ProtocolAssetRewardsClaimed"); }
export function handleUsdcPremiumReceived(event: UsdcPremiumReceived): void { saveGeneric(event, "UsdcPremiumReceived"); }

// PolicyNFT events
export function handlePolicyPremiumAccountUpdated(event: PolicyPremiumAccountUpdated): void { saveGeneric(event, "PolicyPremiumAccountUpdated"); }
export function handleTransfer(event: Transfer): void {
  saveGeneric(event, "Transfer");

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";

  let policy = Policy.load(deployment + "-" + event.params.tokenId.toString());
  if (policy != null) {
    policy.owner = event.params.to;
    policy.save();
  }
}

export function handleRiskManagerOwnershipTransferred(
  event: RiskManagerOwnershipTransferred
): void {
  saveGeneric(event, "OwnershipTransferred");
  saveOwner(event, event.params.newOwner);
}

export function handleCatInsurancePoolOwnershipTransferred(
  event: CatInsurancePoolOwnershipTransferred
): void {
  saveGeneric(event, "OwnershipTransferred");
  saveOwner(event, event.params.newOwner);
}

export function handleCapitalPoolOwnershipTransferred(
  event: CapitalPoolOwnershipTransferred
): void {
  saveGeneric(event, "OwnershipTransferred");
  saveOwner(event, event.params.newOwner);
}

export function handlePolicyNFTOwnershipTransferred(
  event: PolicyNFTOwnershipTransferred
): void {
  saveGeneric(event, "OwnershipTransferred");
  saveOwner(event, event.params.newOwner);
}

export function handlePoolRegistryOwnershipTransferred(
  event: PoolRegistryOwnershipTransferred
): void {
  saveGeneric(event, "OwnershipTransferred");
  saveOwner(event, event.params.newOwner);
}

export function handleRiskManagerAddressSet(event: RiskManagerAddressSet): void {
  saveGeneric(event, "RiskManagerAddressSet");
}

export function handleFundsWithdrawn(event: FundsWithdrawn): void {
  saveGeneric(event, "FundsWithdrawn");
}

export function handleCapitalPoolAddressSet(
  event: CapitalPoolAddressSet
): void {
  saveGeneric(event, "CapitalPoolAddressSet");
}

export function handleProposalCreated(event: ProposalCreated): void {
  saveGeneric(event, "ProposalCreated");

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";

  let id = deployment + "-" + event.params.proposalId.toString();
  let p = new GovernanceProposal(id);
  p.deployment = deployment;
  p.proposer = event.params.proposer;
  p.poolId = event.params.poolId;
  p.pauseState = event.params.pauseState;
  p.votingDeadline = event.params.votingDeadline;
  p.executed = false;
  p.passed = false;
  p.forVotes = BigInt.fromI32(0);
  p.againstVotes = BigInt.fromI32(0);
  p.abstainVotes = BigInt.fromI32(0);
  p.save();
}

export function handleVoted(event: Voted): void {
  saveGeneric(event, "Voted");

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";

  let proposalId = deployment + "-" + event.params.proposalId.toString();
  let voteId = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let v = new GovernanceVote(voteId);
  v.deployment = deployment;
  v.proposal = proposalId;
  v.voter = event.params.voter;
  v.vote = event.params.vote;
  v.weight = event.params.weight;
  v.save();

  let p = GovernanceProposal.load(proposalId);
  if (p != null) {
    if (event.params.vote == 1) {
      p.forVotes = p.forVotes.plus(event.params.weight);
    } else if (event.params.vote == 0) {
      p.againstVotes = p.againstVotes.plus(event.params.weight);
    } else {
      p.abstainVotes = p.abstainVotes.plus(event.params.weight);
    }
    p.save();
  }
}

export function handleProposalExecuted(event: ProposalExecuted): void {
  saveGeneric(event, "ProposalExecuted");

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";

  let id = deployment + "-" + event.params.proposalId.toString();
  let p = GovernanceProposal.load(id);
  if (p != null) {
    p.executed = true;
    p.passed = event.params.passed;
    p.save();
  }
}

export function handleBondResolved(event: BondResolved): void {
  saveGeneric(event, "BondResolved");
}

export function handleRewardClaimed(event: RewardClaimed): void {
  saveGeneric(event, "RewardClaimed");
}

export function handlePolicyManagerAddressSet(event: PolicyManagerAddressSet): void {
  saveGeneric(event, "PolicyManagerAddressSet");
}

export function handleRewardDistributorSet(event: RewardDistributorSet): void {
  saveGeneric(event, "RewardDistributorSet");
}

export function handlePMAddressesSet(event: PMAddressesSet): void {
  saveGeneric(event, "AddressesSet");
}

export function handleCatPremiumShareSet(event: CatPremiumShareSet): void {
  saveGeneric(event, "CatPremiumShareSet");
}

export function handleCatPoolSet(event: CatPoolSet): void {
  saveGeneric(event, "CatPoolSet");
}
