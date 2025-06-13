import { test, assert, clearStore } from 'matchstick-as/assembly/index'
import { Address, BigInt } from '@graphprotocol/graph-ts'
import { handleProposalCreated, handleVoted, handleProposalExecuted } from '../src/mapping'
import { createProposalCreatedEvent, createVotedEvent, createProposalExecutedEvent } from './utils'

test('handleProposalCreated creates proposal', () => {
  clearStore()
  let event = createProposalCreatedEvent(BigInt.fromI32(1), Address.fromString('0x0000000000000000000000000000000000000001'), BigInt.fromI32(42), true, BigInt.fromI32(100))
  handleProposalCreated(event)
  assert.entityCount('GovernanceProposal', 1)
  assert.fieldEquals('GovernanceProposal', '1', 'proposer', '0x0000000000000000000000000000000000000001')
  assert.fieldEquals('GovernanceProposal', '1', 'poolId', '42')
  assert.entityCount('GenericEvent', 1)
})

test('handleVoted updates proposal vote counts', () => {
  clearStore()
  let create = createProposalCreatedEvent(BigInt.fromI32(1), Address.fromString('0x0000000000000000000000000000000000000001'), BigInt.fromI32(1), false, BigInt.fromI32(10))
  handleProposalCreated(create)
  let vote = createVotedEvent(BigInt.fromI32(1), Address.fromString('0x0000000000000000000000000000000000000002'), 1, BigInt.fromI32(50))
  handleVoted(vote)
  assert.entityCount('GovernanceVote', 1)
  assert.fieldEquals('GovernanceProposal', '1', 'forVotes', '50')
})

test('handleProposalExecuted sets result', () => {
  clearStore()
  let create = createProposalCreatedEvent(BigInt.fromI32(1), Address.fromString('0x0000000000000000000000000000000000000001'), BigInt.fromI32(1), false, BigInt.fromI32(10))
  handleProposalCreated(create)
  let exec = createProposalExecutedEvent(BigInt.fromI32(1), true)
  handleProposalExecuted(exec)
  assert.fieldEquals('GovernanceProposal', '1', 'executed', 'true')
  assert.fieldEquals('GovernanceProposal', '1', 'passed', 'true')
})
