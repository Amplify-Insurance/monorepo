import { test, assert, clearStore } from 'matchstick-as/assembly/index'
import { Address, BigInt } from '@graphprotocol/graph-ts'
import { handleWithdrawalRequested } from '../src/mapping'
import { createWithdrawalRequestedEvent } from './utils'

test('handleWithdrawalRequested logs GenericEvent', () => {
  clearStore()
  const user = Address.fromString('0x0000000000000000000000000000000000000001')
  const event = createWithdrawalRequestedEvent(user, BigInt.fromI32(5), BigInt.fromI32(123))
  handleWithdrawalRequested(event)
  assert.entityCount('GenericEvent', 1)
  assert.fieldEquals(
    'GenericEvent',
    event.transaction.hash.toHex() + '-' + event.logIndex.toString(),
    'eventName',
    'WithdrawalRequested'
  )
})
