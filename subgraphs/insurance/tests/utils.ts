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

import { PolicyCreated } from '../generated/RiskManager/RiskManager'

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
