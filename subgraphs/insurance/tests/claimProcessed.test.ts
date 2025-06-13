import { test, assert, clearStore } from 'matchstick-as/assembly/index'
import { Address, BigInt } from '@graphprotocol/graph-ts'
import { handleClaimProcessed } from '../src/mapping'
import { createClaimProcessedEvent } from './utils'

test('handleClaimProcessed creates Claim and GenericEvent', () => {
  clearStore()
  const rm = Address.fromString('0x0000000000000000000000000000000000000010')
  const claimant = Address.fromString('0x0000000000000000000000000000000000000020')
  const event = createClaimProcessedEvent(
    BigInt.fromI32(1),
    BigInt.fromI32(2),
    claimant,
    BigInt.fromI32(90),
    rm
  )
  handleClaimProcessed(event)
  const id = event.transaction.hash.toHex() + '-' + event.logIndex.toString()
  assert.entityCount('Claim', 1)
  assert.fieldEquals('Claim', id, 'policyId', '1')
  assert.fieldEquals('Claim', id, 'poolId', '2')
  assert.fieldEquals('Claim', id, 'claimant', claimant.toHex())
  assert.fieldEquals('Claim', id, 'netPayoutToClaimant', '90')
  assert.fieldEquals('Claim', id, 'coverage', '0')
  assert.fieldEquals('Claim', id, 'claimFee', '0')
  assert.fieldEquals('Claim', id, 'protocolTokenAmountReceived', '0')
  assert.entityCount('GenericEvent', 1)
})
