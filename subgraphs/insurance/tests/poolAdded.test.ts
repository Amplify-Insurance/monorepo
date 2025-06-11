import { test, assert, clearStore } from 'matchstick-as/assembly/index'
import { Address, BigInt } from '@graphprotocol/graph-ts'
import { handlePoolAdded } from '../src/mapping'
import { createPoolAddedEvent } from './utils'

test('handlePoolAdded creates Pool and GenericEvent', () => {
  clearStore()
  let poolId = BigInt.fromI32(3)
  let token = Address.fromString('0x0000000000000000000000000000000000000010')
  let event = createPoolAddedEvent(poolId, token, 5)
  handlePoolAdded(event)

  assert.entityCount('Pool', 1)
  assert.fieldEquals('Pool', poolId.toString(), 'protocolToken', token.toHex())
  assert.fieldEquals('Pool', poolId.toString(), 'protocolCovered', '5')
  assert.entityCount('GenericEvent', 1)
})
