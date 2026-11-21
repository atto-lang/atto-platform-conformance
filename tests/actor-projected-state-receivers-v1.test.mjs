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

test('named receiver is alpha-equivalent and safe across the target matrix', () => {
  assert.equal(contract.cases.length, 43);
  assert.match(contract.semantics.receiverBinding, /self is conventional/);
  assert.match(contract.semantics.alphaEquivalence, /write-set identity/);
  const byId = new Map(contract.cases.map(c => [c.id, c]));
  for (const id of [
    'named_this_receiver_control', 'named_typed_alias',
    'named_field_write', 'named_group_write', 'named_whole_state',
    'named_unguarded_state_write', 'named_guard_unauthorized_write',
    'named_receiver_missing_self_alias', 'named_receiver_callback_binder_collision',
    'named_receiver_param_collision', 'named_receiver_local_shadow',
    'named_receiver_not_overload', 'reserved_actor_is_not_receiver_identifier',
  ]) assert.ok(byId.has(id), id);
  assert.equal(byId.get('named_receiver_missing_self_alias').diagnosticClass, 'E_UNBOUND');
  assert.equal(byId.get('named_receiver_not_overload').diagnosticClass, 'E_DUPLICATE');
});

test('nested actor control arguments cannot conceal sealed state or escapes', () => {
  const byId = new Map(contract.cases.map(c => [c.id, c]));
  const expected = {
    nested_send_direct_state: 'E_SEALED',
    nested_send_unknown_method: 'E_UNBOUND',
    nested_send_receiver_escape: 'E_ESCAPE',
    return_receiver_escape: 'E_ESCAPE',
    nested_send_guard_exceeds_write_set: 'E_MUTABILITY',
    critical_write_nested_field: 'E_UNSUPPORTED',
    critical_write_indexed_field: 'E_UNSUPPORTED',
    critical_write_field_call: 'E_UNSUPPORTED',
    discarded_receiver_use: 'E_UNBOUND',
    critical_read_prefix_mutation: 'E_READONLY',
    critical_read_split_compound_mutation: 'E_READONLY',
    critical_write_prefix_outside_projection: 'E_MUTABILITY',
  };
  for (const [id, code] of Object.entries(expected)) {
    assert.equal(byId.get(id)?.diagnosticClass, code, id);
    assert.equal(byId.get(id)?.evidence, 'NOT_EXECUTED', id);
  }
  assert.equal(byId.get('nested_control_calls_safe_syntax')?.expect, 'accept_ast_only');
  assert.match(contract.semantics.nestedArgumentGate, /recursively inspected/);
  assert.match(contract.semantics.artifactGate, /no \.wasm output/);
});
