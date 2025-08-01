import { ethereum, BigInt, Address, dataSource, store } from "@graphprotocol/graph-ts";
import { GenericEvent, Pool, Underwriter, Policy, ContractOwner, PoolUtilizationSnapshot, Claim, GovernanceProposal, GovernanceVote, PolicyCreatedEvent, PolicyLapsedEvent, PremiumPaidEvent } from "../generated/schema";
import {
  CapitalAllocated,
  CapitalDeallocated,
  AddressesSet,
  CommitteeSet,
  UnderwriterLiquidated,
  PolicyCreated,
  PolicyLapsed,
  PremiumPaid,
  ClaimProcessed,
  OwnershipTransferred as RiskManagerOwnershipTransferred
} from "../generated/RiskManagerV2/RiskManager";
import { RiskManager } from "../generated/RiskManagerV2/RiskManager";
import {
  CapitalAllocated as UMCapitalAllocated,
  CapitalDeallocated as UMCapitalDeallocated,
  AddressesSet as UMAddressesSet,
  CommitteeSet as UMCommitteeSet,
  UnderwriterLiquidated as UMUnderwriterLiquidated,
  PolicyCreated as UMPolicyCreated,
  PolicyLapsed as UMPolicyLapsed,
  PremiumPaid as UMPremiumPaid,
  ClaimProcessed as UMClaimProcessed,
  OwnershipTransferred as UMOwnershipTransferred
} from "../generated/UnderwriterManager/RiskManager";
import {
  CapitalAllocated as NewRMCapitalAllocated,
  CapitalDeallocated as NewRMCapitalDeallocated,
  AddressesSet as NewRMAddressesSet,
  CommitteeSet as NewRMCommitteeSet,
  UnderwriterLiquidated as NewRMUnderwriterLiquidated,
  PolicyCreated as NewRMPolicyCreated,
  PolicyLapsed as NewRMPolicyLapsed,
  PremiumPaid as NewRMPremiumPaid,
  ClaimProcessed as NewRMClaimProcessed,
  OwnershipTransferred as NewRMOwnershipTransferred
} from "../generated/RiskManager/RiskManager";
import {
  CapitalAllocated as PCCapitalAllocated,
  CapitalDeallocated as PCCapitalDeallocated,
  AddressesSet as PCAddressesSet,
  CommitteeSet as PCCommitteeSet,
  UnderwriterLiquidated as PCUnderwriterLiquidated,
  PolicyCreated as PCPolicyCreated,
  PolicyLapsed as PCPolicyLapsed,
  PremiumPaid as PCPremiumPaid,
  ClaimProcessed as PCClaimProcessed,
  OwnershipTransferred as PCOwnershipTransferred
} from "../generated/ProtocolConfigurator/RiskManager";
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
  OwnershipTransferred as BackstopPoolOwnershipTransferred,
  ProtocolAssetReceivedForDistribution,
  ProtocolAssetRewardsClaimed,
  UsdcPremiumReceived,
  PolicyManagerAddressSet,
  RewardDistributorSet
} from "../generated/BackstopPool/BackstopPool";
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
  // ABI for getPoolInfo is unavailable so snapshot functionality is disabled
  return null;
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
export function handleCapitalAllocatedUM(event: UMCapitalAllocated): void {
  handleCapitalAllocated(changetype<CapitalAllocated>(event));
}
export function handleCapitalAllocatedNew(event: NewRMCapitalAllocated): void {
  handleCapitalAllocated(changetype<CapitalAllocated>(event));
}
export function handleCapitalAllocatedPC(event: PCCapitalAllocated): void {
  handleCapitalAllocated(changetype<CapitalAllocated>(event));
}
export function handleCapitalDeallocated(event: CapitalDeallocated): void { saveGeneric(event, "CapitalDeallocated"); }
export function handleCapitalDeallocatedUM(event: UMCapitalDeallocated): void { handleCapitalDeallocated(changetype<CapitalDeallocated>(event)); }
export function handleCapitalDeallocatedNew(event: NewRMCapitalDeallocated): void { handleCapitalDeallocated(changetype<CapitalDeallocated>(event)); }
export function handleCapitalDeallocatedPC(event: PCCapitalDeallocated): void { handleCapitalDeallocated(changetype<CapitalDeallocated>(event)); }
export function handleAddressesSet(event: AddressesSet): void { saveGeneric(event, "AddressesSet"); }
export function handleAddressesSetUM(event: UMAddressesSet): void { handleAddressesSet(changetype<AddressesSet>(event)); }
export function handleAddressesSetNew(event: NewRMAddressesSet): void { handleAddressesSet(changetype<AddressesSet>(event)); }
export function handleAddressesSetPC(event: PCAddressesSet): void { handleAddressesSet(changetype<AddressesSet>(event)); }
export function handleCommitteeSet(event: CommitteeSet): void { saveGeneric(event, "CommitteeSet"); }
export function handleCommitteeSetUM(event: UMCommitteeSet): void { handleCommitteeSet(changetype<CommitteeSet>(event)); }
export function handleCommitteeSetNew(event: NewRMCommitteeSet): void { handleCommitteeSet(changetype<CommitteeSet>(event)); }
export function handleCommitteeSetPC(event: PCCommitteeSet): void { handleCommitteeSet(changetype<CommitteeSet>(event)); }
export function handleUnderwriterLiquidated(event: UnderwriterLiquidated): void { saveGeneric(event, "UnderwriterLiquidated"); }
export function handleUnderwriterLiquidatedUM(event: UMUnderwriterLiquidated): void { handleUnderwriterLiquidated(changetype<UnderwriterLiquidated>(event)); }
export function handleUnderwriterLiquidatedNew(event: NewRMUnderwriterLiquidated): void { handleUnderwriterLiquidated(changetype<UnderwriterLiquidated>(event)); }
export function handleUnderwriterLiquidatedPC(event: PCUnderwriterLiquidated): void { handleUnderwriterLiquidated(changetype<UnderwriterLiquidated>(event)); }
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
export function handleRiskManagerOwnershipTransferredUM(event: UMOwnershipTransferred): void {
  handleRiskManagerOwnershipTransferred(changetype<RiskManagerOwnershipTransferred>(event));
}
export function handleRiskManagerOwnershipTransferredNew(event: NewRMOwnershipTransferred): void {
  handleRiskManagerOwnershipTransferred(changetype<RiskManagerOwnershipTransferred>(event));
}
export function handleRiskManagerOwnershipTransferredPC(event: PCOwnershipTransferred): void {
  handleRiskManagerOwnershipTransferred(changetype<RiskManagerOwnershipTransferred>(event));
}

export function handleBackstopPoolOwnershipTransferred(
  event: BackstopPoolOwnershipTransferred
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

export function handlePolicyCreated(event: PolicyCreated): void {
  saveGeneric(event, "PolicyCreated");

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";

  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let e = new PolicyCreatedEvent(id);
  e.deployment = deployment;
  e.policyId = event.params.policyId;
  e.poolId = event.params.poolId;
  e.user = event.params.user;
  e.coverage = event.params.coverageAmount;
  e.timestamp = event.block.timestamp;
  e.transactionHash = event.transaction.hash;
  e.save();
}
export function handlePolicyCreatedUM(event: UMPolicyCreated): void {
  handlePolicyCreated(changetype<PolicyCreated>(event));
}
export function handlePolicyCreatedNew(event: NewRMPolicyCreated): void {
  handlePolicyCreated(changetype<PolicyCreated>(event));
}
export function handlePolicyCreatedPC(event: PCPolicyCreated): void {
  handlePolicyCreated(changetype<PolicyCreated>(event));
}

export function handlePolicyLapsed(event: PolicyLapsed): void {
  saveGeneric(event, "PolicyLapsed");

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";

  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let e = new PolicyLapsedEvent(id);
  e.deployment = deployment;
  e.policyId = event.params.policyId;
  e.timestamp = event.block.timestamp;
  e.transactionHash = event.transaction.hash;
  e.save();
}
export function handlePolicyLapsedUM(event: UMPolicyLapsed): void {
  handlePolicyLapsed(changetype<PolicyLapsed>(event));
}
export function handlePolicyLapsedNew(event: NewRMPolicyLapsed): void {
  handlePolicyLapsed(changetype<PolicyLapsed>(event));
}
export function handlePolicyLapsedPC(event: PCPolicyLapsed): void {
  handlePolicyLapsed(changetype<PolicyLapsed>(event));
}

export function handlePremiumPaid(event: PremiumPaid): void {
  saveGeneric(event, "PremiumPaid");

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";

  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let e = new PremiumPaidEvent(id);
  e.deployment = deployment;
  e.policyId = event.params.policyId;
  e.poolId = event.params.poolId;
  e.amountPaid = event.params.amountPaid;
  e.catAmount = event.params.catAmount;
  e.poolIncome = event.params.poolIncome;
  e.timestamp = event.block.timestamp;
  e.transactionHash = event.transaction.hash;
  e.save();
}
export function handlePremiumPaidUM(event: UMPremiumPaid): void {
  handlePremiumPaid(changetype<PremiumPaid>(event));
}
export function handlePremiumPaidNew(event: NewRMPremiumPaid): void {
  handlePremiumPaid(changetype<PremiumPaid>(event));
}
export function handlePremiumPaidPC(event: PCPremiumPaid): void {
  handlePremiumPaid(changetype<PremiumPaid>(event));
}

export function handleClaimProcessed(event: ClaimProcessed): void {
  saveGeneric(event, "ClaimProcessed");

  let ctx = dataSource.context();
  let deployment = ctx.getString("deployment");
  if (deployment == null) deployment = "default";

  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let c = new Claim(id);
  c.deployment = deployment;
  c.policyId = event.params.policyId;
  c.poolId = event.params.poolId;
  c.claimant = event.params.claimant;
  let policy = Policy.load(deployment + "-" + event.params.policyId.toString());
  c.coverage = policy ? policy.coverageAmount : BigInt.fromI32(0);
  c.netPayoutToClaimant = event.params.netPayoutToClaimant;
  c.claimFee = event.params.claimFee;
  c.protocolTokenAmountReceived = event.params.protocolTokenAmountReceived;
  c.timestamp = event.block.timestamp;
  c.transactionHash = event.transaction.hash;
  c.save();
}
export function handleClaimProcessedUM(event: UMClaimProcessed): void {
  handleClaimProcessed(changetype<ClaimProcessed>(event));
}
export function handleClaimProcessedNew(event: NewRMClaimProcessed): void {
  handleClaimProcessed(changetype<ClaimProcessed>(event));
}
export function handleClaimProcessedPC(event: PCClaimProcessed): void {
  handleClaimProcessed(changetype<ClaimProcessed>(event));
}
