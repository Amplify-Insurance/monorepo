import { test, assert, clearStore } from 'matchstick-as/assembly/index'
import { Address, BigInt } from '@graphprotocol/graph-ts'
import { Policy } from '../generated/schema'
import { handleTransfer } from '../src/mapping'
import { createTransferEvent } from './utils'

test('handleTransfer updates Policy owner and logs event', () => {
  clearStore()
  let oldOwner = Address.fromString('0x0000000000000000000000000000000000000001')
  let newOwner = Address.fromString('0x0000000000000000000000000000000000000002')
  let policy = new Policy('1')
  policy.owner = oldOwner
  policy.pool = '0'
  policy.coverageAmount = BigInt.fromI32(0)
  policy.premiumPaid = BigInt.fromI32(0)
  policy.save()

  let event = createTransferEvent(oldOwner, newOwner, BigInt.fromI32(1))
  handleTransfer(event)

  assert.fieldEquals('Policy', '1', 'owner', newOwner.toHex())
  assert.entityCount('GenericEvent', 1)
})
