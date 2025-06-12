import { ethereum, BigInt, Address } from "@graphprotocol/graph-ts";
import { GenericEvent, Pool, Underwriter, Policy, ContractOwner, PoolUtilizationSnapshot } from "../generated/schema";
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
  OwnershipTransferred as RiskManagerOwnershipTransferred
} from "../generated/RiskManager/RiskManager";
import { RiskManager } from "../generated/RiskManager/RiskManager";
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
  UsdcPremiumReceived
} from "../generated/CatInsurancePool/CatInsurancePool";
import {
  PolicyPremiumAccountUpdated,
  Transfer,
  RiskManagerAddressSet,
  OwnershipTransferred as PolicyNFTOwnershipTransferred
} from "../generated/PolicyNFT/PolicyNFT";
import {
  FundsWithdrawn,
  CapitalPoolAddressSet
} from "../generated/AaveV3Adapter/YieldAdapter";

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

  let snapId = poolId.toString() + "-" + event.block.number.toString();
  let snap = new PoolUtilizationSnapshot(snapId);
  snap.pool = poolId.toString();
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

  let poolId = event.params.poolId.toString();
  let pool = new Pool(poolId);
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

  let id = event.params.user.toHex();
  let u = Underwriter.load(id);
  if (u == null) {
    u = new Underwriter(id);
    u.totalDeposited = BigInt.fromI32(0);
    u.masterShares = BigInt.fromI32(0);
  }
  u.totalDeposited = u.totalDeposited.plus(event.params.amount);
  u.masterShares = u.masterShares.plus(event.params.sharesMinted);
  u.save();
}
export function handleWithdrawalRequested(event: WithdrawalRequested): void { saveGeneric(event, "WithdrawalRequested"); }
export function handleWithdrawalExecuted(event: WithdrawalExecuted): void { saveGeneric(event, "WithdrawalExecuted"); }
export function handlePremiumPaid(event: PremiumPaid): void { saveGeneric(event, "PremiumPaid"); }
export function handleClaimProcessed(event: ClaimProcessed): void {
  saveGeneric(event, "ClaimProcessed");
  let rm = RiskManager.bind(event.address);
  snapshotPool(rm, event, event.params.poolId);
}
export function handleLossesApplied(event: LossesApplied): void { saveGeneric(event, "LossesApplied"); }
export function handleCapitalAllocated(event: CapitalAllocated): void {
  saveGeneric(event, "CapitalAllocated");
  let rm = RiskManager.bind(event.address);
  snapshotPool(rm, event, event.params.poolId);
}
export function handleCapitalDeallocated(event: CapitalDeallocated): void { saveGeneric(event, "CapitalDeallocated"); }
export function handlePolicyCreated(event: PolicyCreated): void {
  saveGeneric(event, "PolicyCreated");

  let policyId = event.params.policyId.toString();
  let policy = new Policy(policyId);
  policy.owner = event.params.user;
  policy.pool = event.params.poolId.toString();
  policy.coverageAmount = event.params.coverageAmount;
  policy.premiumPaid = event.params.premiumPaid;
  let rm = RiskManager.bind(event.address);
  let rate = snapshotPool(rm, event, event.params.poolId);
  policy.premiumRateBps = rate == null ? BigInt.fromI32(0) : rate as BigInt;
  policy.save();
}
export function handleIncidentReported(event: IncidentReported): void { saveGeneric(event, "IncidentReported"); }
export function handlePolicyLapsed(event: PolicyLapsed): void {
  saveGeneric(event, "PolicyLapsed");
  let policy = Policy.load(event.params.policyId.toString());
  if (policy != null) {
    let rm = RiskManager.bind(event.address);
    snapshotPool(rm, event, BigInt.fromString(policy.pool));
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

  let policy = Policy.load(event.params.tokenId.toString());
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
