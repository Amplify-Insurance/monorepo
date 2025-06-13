import { test, assert, clearStore } from 'matchstick-as/assembly/index'
import { BigInt } from '@graphprotocol/graph-ts'
import { handlePolicyLapsed } from '../src/mapping'
import { createPolicyLapsedEvent } from './utils'

test('handlePolicyLapsed creates event', () => {
  clearStore()
  let event = createPolicyLapsedEvent(BigInt.fromI32(1))
  handlePolicyLapsed(event)
  assert.entityCount('PolicyLapsedEvent', 1)
  assert.fieldEquals(
    'PolicyLapsedEvent',
    event.transaction.hash.toHex() + '-' + event.logIndex.toString(),
    'policyId',
    '1'
  )
})
