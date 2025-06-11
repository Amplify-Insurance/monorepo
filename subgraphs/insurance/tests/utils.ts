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
