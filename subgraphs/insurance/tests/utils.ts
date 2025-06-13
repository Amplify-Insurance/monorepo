import { newMockEvent } from 'matchstick-as/assembly/index'
import { ethereum, Address, BigInt } from '@graphprotocol/graph-ts'
import { Deposit } from '../generated/CapitalPool/CapitalPool'

export function createDepositEvent(user: Address, amount: BigInt, shares: BigInt, choice: i32): Deposit {
  let event = changetype<Deposit>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam('user', ethereum.Value.fromAddress(user)))
  event.parameters.push(new ethereum.EventParam('amount', ethereum.Value.fromUnsignedBigInt(amount)))
  event.parameters.push(new ethereum.EventParam('sharesMinted', ethereum.Value.fromUnsignedBigInt(shares)))
  event.parameters.push(new ethereum.EventParam('yieldChoice', ethereum.Value.fromI32(choice)))
  return event
}

import { PolicyCreated, ClaimProcessed } from '../generated/RiskManager/RiskManager'

export function createPolicyCreatedEvent(
  user: Address,
  policyId: BigInt,
  poolId: BigInt,
  coverageAmount: BigInt,
  premiumPaid: BigInt
): PolicyCreated {
  let event = changetype<PolicyCreated>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam('user', ethereum.Value.fromAddress(user)))
  event.parameters.push(new ethereum.EventParam('policyId', ethereum.Value.fromUnsignedBigInt(policyId)))
  event.parameters.push(new ethereum.EventParam('poolId', ethereum.Value.fromUnsignedBigInt(poolId)))
  event.parameters.push(new ethereum.EventParam('coverageAmount', ethereum.Value.fromUnsignedBigInt(coverageAmount)))
  event.parameters.push(new ethereum.EventParam('premiumPaid', ethereum.Value.fromUnsignedBigInt(premiumPaid)))
  return event
}

import { Transfer } from '../generated/PolicyNFT/PolicyNFT'

export function createTransferEvent(
  from: Address,
  to: Address,
  tokenId: BigInt,
): Transfer {
  let event = changetype<Transfer>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam('from', ethereum.Value.fromAddress(from)))
  event.parameters.push(new ethereum.EventParam('to', ethereum.Value.fromAddress(to)))
  event.parameters.push(new ethereum.EventParam('tokenId', ethereum.Value.fromUnsignedBigInt(tokenId)))
  return event
}

import { PoolAdded } from '../generated/RiskManager/RiskManager'

export function createPoolAddedEvent(
  poolId: BigInt,
  protocolToken: Address,
  protocolCovered: i32,
): PoolAdded {
  let event = changetype<PoolAdded>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam('poolId', ethereum.Value.fromUnsignedBigInt(poolId)))
  event.parameters.push(new ethereum.EventParam('protocolToken', ethereum.Value.fromAddress(protocolToken)))
  event.parameters.push(new ethereum.EventParam('protocolCovered', ethereum.Value.fromI32(protocolCovered)))
  return event
}

import { WithdrawalRequested } from '../generated/CapitalPool/CapitalPool'

export function createWithdrawalRequestedEvent(
  user: Address,
  sharesToBurn: BigInt,
  timestamp: BigInt
): WithdrawalRequested {
  let event = changetype<WithdrawalRequested>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam('user', ethereum.Value.fromAddress(user)))
  event.parameters.push(new ethereum.EventParam('sharesToBurn', ethereum.Value.fromUnsignedBigInt(sharesToBurn)))
  event.parameters.push(new ethereum.EventParam('timestamp', ethereum.Value.fromUnsignedBigInt(timestamp)))
  return event
}

export function createClaimProcessedEvent(
  policyId: BigInt,
  poolId: BigInt,
  claimant: Address,
  netPayout: BigInt,
  contract: Address
): ClaimProcessed {
  let event = changetype<ClaimProcessed>(newMockEvent())
  event.address = contract
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam('policyId', ethereum.Value.fromUnsignedBigInt(policyId)))
  event.parameters.push(new ethereum.EventParam('poolId', ethereum.Value.fromUnsignedBigInt(poolId)))
  event.parameters.push(new ethereum.EventParam('claimant', ethereum.Value.fromAddress(claimant)))
  event.parameters.push(new ethereum.EventParam('netPayoutToClaimant', ethereum.Value.fromUnsignedBigInt(netPayout)))
  return event
}

import { PolicyLapsed, PremiumPaid } from '../generated/RiskManager/RiskManager'

export function createPolicyLapsedEvent(policyId: BigInt): PolicyLapsed {
  let event = changetype<PolicyLapsed>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam('policyId', ethereum.Value.fromUnsignedBigInt(policyId)))
  return event
}

export function createPremiumPaidEvent(
  policyId: BigInt,
  poolId: BigInt,
  amountPaid: BigInt,
  catAmount: BigInt,
  poolIncome: BigInt
): PremiumPaid {
  let event = changetype<PremiumPaid>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam('policyId', ethereum.Value.fromUnsignedBigInt(policyId)))
  event.parameters.push(new ethereum.EventParam('poolId', ethereum.Value.fromUnsignedBigInt(poolId)))
  event.parameters.push(new ethereum.EventParam('amountPaid', ethereum.Value.fromUnsignedBigInt(amountPaid)))
  event.parameters.push(new ethereum.EventParam('catAmount', ethereum.Value.fromUnsignedBigInt(catAmount)))
  event.parameters.push(new ethereum.EventParam('poolIncome', ethereum.Value.fromUnsignedBigInt(poolIncome)))
  return event
}

import { OwnershipTransferred as RMOwnershipTransferred } from '../generated/RiskManager/RiskManager'
import { ProposalCreated, Voted, ProposalExecuted } from '../generated/Committee/Committee'

export function createOwnershipTransferredEvent(
  previousOwner: Address,
  newOwner: Address,
  contract: Address
): RMOwnershipTransferred {
  let event = changetype<RMOwnershipTransferred>(newMockEvent())
  event.address = contract
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam('previousOwner', ethereum.Value.fromAddress(previousOwner)))
  event.parameters.push(new ethereum.EventParam('newOwner', ethereum.Value.fromAddress(newOwner)))
  return event
}

export function createProposalCreatedEvent(
  proposalId: BigInt,
  proposer: Address,
  poolId: BigInt,
  pauseState: boolean,
  deadline: BigInt,
): ProposalCreated {
  let event = changetype<ProposalCreated>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam('proposalId', ethereum.Value.fromUnsignedBigInt(proposalId)))
  event.parameters.push(new ethereum.EventParam('proposer', ethereum.Value.fromAddress(proposer)))
  event.parameters.push(new ethereum.EventParam('poolId', ethereum.Value.fromUnsignedBigInt(poolId)))
  event.parameters.push(new ethereum.EventParam('pauseState', ethereum.Value.fromBoolean(pauseState)))
  event.parameters.push(new ethereum.EventParam('votingDeadline', ethereum.Value.fromUnsignedBigInt(deadline)))
  return event
}

export function createVotedEvent(
  proposalId: BigInt,
  voter: Address,
  vote: i32,
  weight: BigInt,
): Voted {
  let event = changetype<Voted>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam('proposalId', ethereum.Value.fromUnsignedBigInt(proposalId)))
  event.parameters.push(new ethereum.EventParam('voter', ethereum.Value.fromAddress(voter)))
  event.parameters.push(new ethereum.EventParam('vote', ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(vote))))
  event.parameters.push(new ethereum.EventParam('weight', ethereum.Value.fromUnsignedBigInt(weight)))
  return event
}

export function createProposalExecutedEvent(
  proposalId: BigInt,
  passed: boolean,
): ProposalExecuted {
  let event = changetype<ProposalExecuted>(newMockEvent())
  event.parameters = new Array()
  event.parameters.push(new ethereum.EventParam('proposalId', ethereum.Value.fromUnsignedBigInt(proposalId)))
  event.parameters.push(new ethereum.EventParam('passed', ethereum.Value.fromBoolean(passed)))
  return event
}
