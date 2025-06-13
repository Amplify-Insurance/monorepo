import { test, assert, clearStore } from 'matchstick-as/assembly/index'
import { BigInt } from '@graphprotocol/graph-ts'
import { handlePremiumPaid } from '../src/mapping'
import { createPremiumPaidEvent } from './utils'

test('handlePremiumPaid creates event', () => {
  clearStore()
  let event = createPremiumPaidEvent(
    BigInt.fromI32(1),
    BigInt.fromI32(2),
    BigInt.fromI32(50),
    BigInt.fromI32(5),
    BigInt.fromI32(45)
  )
  handlePremiumPaid(event)
  assert.entityCount('PremiumPaidEvent', 1)
  assert.fieldEquals(
    'PremiumPaidEvent',
    event.transaction.hash.toHex() + '-' + event.logIndex.toString(),
    'amountPaid',
    '50'
  )
})

