import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = JSON.parse(readFileSync(
  new URL('../contracts/actor-projected-state-receivers-v1.json', import.meta.url),
  'utf8'
));

test('projected actor receiver contract is bounded and unverified', () => {
  assert.equal(contract.schema, 'atto.actor.projection.receiver.v1');
  assert.equal(contract.status, 'TARGET_NOT_EXECUTED');
  assert.ok(contract.cases.length >= 15);
  assert.equal(new Set(contract.cases.map(c => c.id)).size, contract.cases.length);
  assert.ok(Object.values(contract.backendStatus).every(x => x === 'NOT_EXECUTED'));
  for (const c of contract.cases) {
    assert.equal(c.evidence, 'NOT_EXECUTED', c.id);
    assert.ok(c.sourceUnits || c.irSequence, c.id);
    if (c.expect === 'reject') assert.ok(c.diagnosticClass, c.id);
    if (c.stage === 'target_parser') assert.ok(c.sourceUnits, c.id);
  }
});

test('canonical projection has explicit fields and negative safety coverage', () => {
  assert.equal(contract.canonicalReceiver,
    'mtd (Foo mut self.state.{counter, xyz}) update(): void');
  const ids = new Set(contract.cases.map(c => c.id));
  for (const id of [
    'identity_send_end_readonly',
    'field_single_write',
    'field_group_write',
    'whole_state_write',
    'duplicate_group_field',
    'square_bracket_group',
    'direct_actor_state_access',
    'unauthorized_direct_guard_write',
    'transitive_unverified_effect',
    'overlapping_write_loans',
  ]) assert.ok(ids.has(id), id);
});
