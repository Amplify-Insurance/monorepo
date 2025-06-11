import { test, assert, clearStore } from 'matchstick-as/assembly/index'
import { Address, BigInt } from '@graphprotocol/graph-ts'
import { handleDeposit } from '../src/mapping'
import { createDepositEvent } from './utils'

test('handleDeposit creates Underwriter and GenericEvent', () => {
  clearStore()
  let user = Address.fromString('0x0000000000000000000000000000000000000001')
  let event = createDepositEvent(user, BigInt.fromI32(100), BigInt.fromI32(10), 0)
  handleDeposit(event)
  assert.entityCount('Underwriter', 1)
  assert.fieldEquals('Underwriter', user.toHex(), 'totalDeposited', '100')
  assert.fieldEquals('Underwriter', user.toHex(), 'masterShares', '10')
  assert.entityCount('GenericEvent', 1)
  assert.fieldEquals('GenericEvent', event.transaction.hash.toHex() + '-' + event.logIndex.toString(), 'eventName', 'Deposit')
})
