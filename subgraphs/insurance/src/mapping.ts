import { ethereum, BigInt, Address, dataSource, store } from "@graphprotocol/graph-ts";
import { GenericEvent, Pool, Underwriter, Policy, ContractOwner, PoolUtilizationSnapshot, Claim, GovernanceProposal, GovernanceVote } from "../generated/schema";
import {
  CapitalAllocated,
  CapitalDeallocated,
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
import {
  Staked,
  Unstaked,
  CommitteeAddressSet
} from "../generated/Staking/Staking";

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
export function handleBaseYieldAdapterSet(event: BaseYieldAdapterSet): void { saveGeneric(event, "BaseYieldAdapterSet"); }
export function handleSystemValueSynced(event: SystemValueSynced): void { saveGeneric(event, "SystemValueSynced"); }
export function handleAdapterCallFailed(event: AdapterCallFailed): void { saveGeneric(event, "AdapterCallFailed"); }
export function handleRiskManagerSet(event: RiskManagerSet): void { saveGeneric(event, "RiskManagerSet"); }
export function handlePolicyPremiumAccountUpdated(event: PolicyPremiumAccountUpdated): void { saveGeneric(event, "PolicyPremiumAccountUpdated"); }

export function handleTransfer(event: Transfer): void {
  saveGeneric(event, "Transfer");

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";

  if (event.params.from.equals(Address.zero())) {
    let nft = PolicyNFT.bind(event.address);
    let res = nft.try_getPolicy(event.params.tokenId);
    if (!res.reverted) {
      let p = res.value;
      let id = deployment + "-" + event.params.tokenId.toString();
      let policy = new Policy(id);
      policy.deployment = deployment;
      policy.owner = event.params.to;
      policy.pool = deployment + "-" + p.poolId.toString();
      policy.coverageAmount = p.coverage;
      policy.premiumPaid = p.premiumDeposit;
      policy.premiumRateBps = BigInt.fromI32(0);
      policy.save();
    }
    return;
  }

  if (event.params.to.equals(Address.zero())) {
    store.remove("Policy", deployment + "-" + event.params.tokenId.toString());
    return;
  }

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

export function handleStaked(event: Staked): void {
  saveGeneric(event, "Staked");
}

export function handleUnstaked(event: Unstaked): void {
  saveGeneric(event, "Unstaked");
}

export function handleCommitteeAddressSet(event: CommitteeAddressSet): void {
  saveGeneric(event, "CommitteeAddressSet");
}
