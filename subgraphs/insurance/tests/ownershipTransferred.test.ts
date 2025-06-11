import { test, assert, clearStore } from 'matchstick-as/assembly/index'
import { Address } from '@graphprotocol/graph-ts'
import { handleRiskManagerOwnershipTransferred } from '../src/mapping'
import { createOwnershipTransferredEvent } from './utils'

test('handleRiskManagerOwnershipTransferred stores owner and logs event', () => {
  clearStore()
  const prev = Address.fromString('0x0000000000000000000000000000000000000001')
  const next = Address.fromString('0x0000000000000000000000000000000000000002')
  const rm = Address.fromString('0x0000000000000000000000000000000000000010')
  const event = createOwnershipTransferredEvent(prev, next, rm)
  handleRiskManagerOwnershipTransferred(event)
  assert.entityCount('ContractOwner', 1)
  assert.fieldEquals('ContractOwner', rm.toHex(), 'owner', next.toHex())
  assert.entityCount('GenericEvent', 1)
})
