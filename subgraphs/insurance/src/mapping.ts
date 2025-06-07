import { ethereum, BigInt, Address } from "@graphprotocol/graph-ts";
import { GenericEvent, Pool, Underwriter, Policy, ContractOwner } from "../generated/schema";
import {
  AdapterCallFailed,
  BaseYieldAdapterSet,
  CapitalPledgedToPoolChanged,
  CatPremiumBpsUpdated,
  ClaimProcessed,
  CommitteeUpdated,
  DistressedAssetRewardsClaimed,
  OwnershipTransferred as CoverPoolOwnershipTransferred,
  IncidentReported,
  PolicyCreated,
  PolicyLapsed,
  PoolAdded,
  PremiumPaid,
  PremiumRewardsClaimed,
  SystemValueSynced,
  UnderwriterDeposit,
  UnderwriterLoss,
  WithdrawalExecuted,
  WithdrawalRequested
} from "../generated/CoverPool/CoverPool";
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
  UsdcPremiumReceived
} from "../generated/CatInsurancePool/CatInsurancePool";
import {
  PolicyLastPaidUpdated,
  Transfer,
  OwnershipTransferred as PolicyNFTOwnershipTransferred
} from "../generated/PolicyNFT/PolicyNFT";

function saveGeneric(event: ethereum.Event, name: string): void {
  let id = event.transaction.hash.toHex() + "-" + event.logIndex.toString();
  let entity = new GenericEvent(id);
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
  owner.owner = newOwner;
  owner.save();
}

// CoverPool events
export function handlePoolAdded(event: PoolAdded): void {
  saveGeneric(event, "PoolAdded");

  let poolId = event.params.poolId.toString();
  let pool = new Pool(poolId);
  pool.underlyingAsset = event.params.underlyingAsset;
  pool.protocolToken = event.params.protocolToken;
  pool.protocolCovered = event.params.protocolCovered;
  pool.save();
}

export function handleUnderwriterDeposit(event: UnderwriterDeposit): void {
  saveGeneric(event, "UnderwriterDeposit");

  let id = event.params.user.toHex();
  let u = Underwriter.load(id);
  if (u == null) {
    u = new Underwriter(id);
    u.totalDeposited = BigInt.fromI32(0);
    u.masterShares = BigInt.fromI32(0);
  }
  u.totalDeposited = u.totalDeposited.plus(event.params.amountDeposited);
  u.masterShares = u.masterShares.plus(event.params.masterSharesMinted);
  u.save();
}
export function handleWithdrawalRequested(event: WithdrawalRequested): void { saveGeneric(event, "WithdrawalRequested"); }
export function handleWithdrawalExecuted(event: WithdrawalExecuted): void { saveGeneric(event, "WithdrawalExecuted"); }
export function handlePremiumPaid(event: PremiumPaid): void { saveGeneric(event, "PremiumPaid"); }
export function handleClaimProcessed(event: ClaimProcessed): void { saveGeneric(event, "ClaimProcessed"); }
export function handleUnderwriterLoss(event: UnderwriterLoss): void { saveGeneric(event, "UnderwriterLoss"); }
export function handleCapitalPledgedToPoolChanged(event: CapitalPledgedToPoolChanged): void { saveGeneric(event, "CapitalPledgedToPoolChanged"); }
export function handlePolicyCreated(event: PolicyCreated): void {
  saveGeneric(event, "PolicyCreated");

  let policyId = event.params.policyId.toString();
  let policy = new Policy(policyId);
  policy.owner = event.params.user;
  policy.pool = event.params.poolId.toString();
  policy.coverageAmount = event.params.coverageAmount;
  policy.premiumPaid = event.params.premiumPaid;
  policy.save();
}
export function handleIncidentReported(event: IncidentReported): void { saveGeneric(event, "IncidentReported"); }
export function handlePolicyLapsed(event: PolicyLapsed): void { saveGeneric(event, "PolicyLapsed"); }
export function handleCatPremiumBpsUpdated(event: CatPremiumBpsUpdated): void { saveGeneric(event, "CatPremiumBpsUpdated"); }
export function handleBaseYieldAdapterSet(event: BaseYieldAdapterSet): void { saveGeneric(event, "BaseYieldAdapterSet"); }
export function handleCommitteeUpdated(event: CommitteeUpdated): void { saveGeneric(event, "CommitteeUpdated"); }
export function handleSystemValueSynced(event: SystemValueSynced): void { saveGeneric(event, "SystemValueSynced"); }
export function handleAdapterCallFailed(event: AdapterCallFailed): void { saveGeneric(event, "AdapterCallFailed"); }
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
export function handlePolicyLastPaidUpdated(event: PolicyLastPaidUpdated): void { saveGeneric(event, "PolicyLastPaidUpdated"); }
export function handleTransfer(event: Transfer): void {
  saveGeneric(event, "Transfer");

  let policy = Policy.load(event.params.tokenId.toString());
  if (policy != null) {
    policy.owner = event.params.to;
    policy.save();
  }
}

export function handleCoverPoolOwnershipTransferred(
  event: CoverPoolOwnershipTransferred
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

export function handlePolicyNFTOwnershipTransferred(
  event: PolicyNFTOwnershipTransferred
): void {
  saveGeneric(event, "OwnershipTransferred");
  saveOwner(event, event.params.newOwner);
}
