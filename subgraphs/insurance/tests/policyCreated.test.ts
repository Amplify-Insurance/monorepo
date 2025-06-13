import { test, assert, clearStore } from 'matchstick-as/assembly/index'
import { Address, BigInt } from '@graphprotocol/graph-ts'
import { handlePolicyCreated } from '../src/mapping'
import { createPolicyCreatedEvent } from './utils'

test('handlePolicyCreated creates Policy and events', () => {
  clearStore()
  let user = Address.fromString('0x0000000000000000000000000000000000000002')
  let event = createPolicyCreatedEvent(
    user,
    BigInt.fromI32(1),
    BigInt.fromI32(42),
    BigInt.fromI32(1000),
    BigInt.fromI32(50)
  )
  handlePolicyCreated(event)
  assert.entityCount('Policy', 1)
  assert.fieldEquals('Policy', '1', 'owner', user.toHex())
  assert.fieldEquals('Policy', '1', 'pool', '42')
  assert.fieldEquals('Policy', '1', 'coverageAmount', '1000')
  assert.fieldEquals('Policy', '1', 'premiumPaid', '50')
  assert.entityCount('GenericEvent', 1)
  assert.fieldEquals(
    'GenericEvent',
    event.transaction.hash.toHex() + '-' + event.logIndex.toString(),
    'eventName',
    'PolicyCreated'
  )
  assert.entityCount('PolicyCreatedEvent', 1)
  assert.fieldEquals(
    'PolicyCreatedEvent',
    event.transaction.hash.toHex() + '-' + event.logIndex.toString(),
    'policyId',
    '1'
  )
})
