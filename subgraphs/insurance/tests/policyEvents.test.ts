import { test, assert, clearStore } from 'matchstick-as/assembly/index'
import { Address, BigInt } from '@graphprotocol/graph-ts'
import { Policy } from '../generated/schema'
import {
  handlePolicyCreated,
  handlePolicyLapsed,
  handlePremiumPaid,
  handleClaimProcessed
} from '../src/mapping'
import {
  createPolicyCreatedEvent,
  createPolicyLapsedEvent,
  createPremiumPaidEvent,
  createClaimProcessedEvent
} from './utils'

const ZERO_ADDRESS = Address.fromString('0x0000000000000000000000000000000000000001')

test('handlePolicyCreated stores event', () => {
  clearStore()
  let event = createPolicyCreatedEvent(ZERO_ADDRESS, BigInt.fromI32(1), BigInt.fromI32(2), BigInt.fromI32(100), BigInt.fromI32(10))
  handlePolicyCreated(event)
  let id = event.transaction.hash.toHex() + '-' + event.logIndex.toString()
  assert.entityCount('PolicyCreatedEvent', 1)
  assert.fieldEquals('PolicyCreatedEvent', id, 'policyId', '1')
  assert.entityCount('GenericEvent', 1)
})

test('handlePolicyLapsed stores event', () => {
  clearStore()
  let event = createPolicyLapsedEvent(BigInt.fromI32(1))
  handlePolicyLapsed(event)
  let id = event.transaction.hash.toHex() + '-' + event.logIndex.toString()
  assert.entityCount('PolicyLapsedEvent', 1)
  assert.fieldEquals('PolicyLapsedEvent', id, 'policyId', '1')
})

test('handlePremiumPaid stores event', () => {
  clearStore()
  let event = createPremiumPaidEvent(BigInt.fromI32(1), BigInt.fromI32(2), BigInt.fromI32(5), BigInt.fromI32(1), BigInt.fromI32(4))
  handlePremiumPaid(event)
  let id = event.transaction.hash.toHex() + '-' + event.logIndex.toString()
  assert.entityCount('PremiumPaidEvent', 1)
  assert.fieldEquals('PremiumPaidEvent', id, 'amountPaid', '5')
})

test('handleClaimProcessed stores Claim', () => {
  clearStore()
  let policy = new Policy('default-1')
  policy.deployment = 'default'
  policy.owner = ZERO_ADDRESS
  policy.pool = 'default-2'
  policy.coverageAmount = BigInt.fromI32(10)
  policy.premiumPaid = BigInt.fromI32(0)
  policy.premiumRateBps = BigInt.fromI32(0)
  policy.save()

  let event = createClaimProcessedEvent(BigInt.fromI32(1), BigInt.fromI32(2), ZERO_ADDRESS, BigInt.fromI32(8), ZERO_ADDRESS)
  handleClaimProcessed(event)
  let id = event.transaction.hash.toHex() + '-' + event.logIndex.toString()
  assert.entityCount('Claim', 1)
  assert.fieldEquals('Claim', id, 'coverage', '10')
})
