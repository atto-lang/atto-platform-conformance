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
  assert.equal(contract.cases.length, 55);
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
    critical_read_bitwise_and_compound: 'E_READONLY',
    critical_read_bitwise_or_compound: 'E_READONLY',
    critical_read_bitwise_xor_compound: 'E_READONLY',
    critical_read_left_shift_compound: 'E_READONLY',
    critical_read_right_shift_compound: 'E_READONLY',
    critical_read_unsigned_shift_compound: 'E_READONLY',
    critical_write_bitwise_outside_projection: 'E_MUTABILITY',
    critical_write_shift_outside_projection: 'E_MUTABILITY',
  };
  for (const [id, code] of Object.entries(expected)) {
    assert.equal(byId.get(id)?.diagnosticClass, code, id);
    assert.equal(byId.get(id)?.evidence, 'NOT_EXECUTED', id);
  }
  assert.equal(byId.get('nested_control_calls_safe_syntax')?.expect, 'accept_ast_only');
  assert.match(contract.semantics.nestedArgumentGate, /recursively inspected/);
  assert.match(contract.semantics.artifactGate, /no \.wasm output/);
});

test('all bitwise and shift mutations are rejected without typed actor proofs', () => {
  const cases = contract.cases.filter(c => /^(critical_read_(?:bitwise|.*shift)_.*compound|critical_write_(?:bitwise|shift)_outside_projection)$/.test(c.id));
  assert.equal(cases.length, 8);
  for (const item of cases) {
    assert.equal(item.stage, 'target_parser', item.id);
    assert.equal(item.expect, 'reject', item.id);
    assert.equal(item.evidence, 'NOT_EXECUTED', item.id);
    assert.match(item.sourceUnits['src/worker.atto'], /handle_state\(critical-(read|write)/);
    assert.match(item.sourceUnits['src/worker.atto'], /\s(?:&|\||\^|<<|>>|>>>)= 1;/);
  }
});

test('concrete parsed actor state schemas are fail-closed without guest promotion', () => {
  assert.match(contract.semantics.parsedSchema, /not authenticated transitive/);
  const cases = new Map(contract.cases.map(item => [item.id, item]));
  const expected = {
    concrete_schema_known_guarded_fields: ['accept_ast_only', undefined],
    concrete_schema_unknown_receiver_field: ['reject', 'E_STATE_FIELD_UNKNOWN'],
    concrete_schema_readonly_projected_field: ['reject', 'E_MUTABILITY'],
    concrete_schema_unknown_critical_read_field: ['reject', 'E_STATE_FIELD_UNKNOWN'],
  };
  for (const [id, [expect, diagnostic]] of Object.entries(expected)) {
    const item = cases.get(id);
    assert.ok(item, id);
    assert.equal(item.stage, 'parsed_schema_preflight');
    assert.equal(item.expect, expect);
    assert.equal(item.diagnosticClass, diagnostic);
    assert.equal(item.evidence, 'NOT_EXECUTED');
    assert.match(item.sourceUnits['src/worker.atto'], /define actor Foo/);
  }
});


// Source-free authority oracle. This is NOT a compiler, physical state-loan
// runtime, or generated guest receipt. Exercise the policy independently of
// Java/.NET representation so a nested read cannot regain an ancestor's write.
function verifyNestedStateAuthority(allowEscalation = false) {
  let generation = 1;
  const stack = [];
  const begin = writable => {
    const parent = stack.at(-1);
    if (!allowEscalation && writable && parent && !parent.writable)
      throw new Error('E_READONLY');
    const ticket = Object.freeze({generation: generation++, writable});
    stack.push(ticket);
    return ticket;
  };
  const validate = (ticket, write = false) =>
    stack.at(-1) === ticket && (!write || ticket.writable);
  const end = ticket => {
    if (!validate(ticket)) throw new Error('E_LOAN_ORDER');
    stack.pop();
  };
  const outer = begin(true);
  const read = begin(false);
  const nextGeneration = generation;
  assert.throws(() => begin(true), /E_READONLY/);
  assert.equal(generation, nextGeneration);
  assert.equal(validate(read), true);
  assert.equal(validate(read, true), false);
  assert.equal(validate(outer, true), false);
  const readChild = begin(false);
  assert.equal(readChild.generation, nextGeneration);
  assert.throws(() => end(read), /E_LOAN_ORDER/);
  assert.equal(validate(readChild), true);
  end(readChild);
  end(read);
  assert.equal(validate(read), false);
  assert.equal(validate(outer, true), true);
  const writeChild = begin(true);
  assert.equal(validate(writeChild, true), true);
  assert.equal(validate(outer, true), false);
  end(writeChild);
  end(outer);
  const rootRead = begin(false);
  assert.throws(() => begin(true), /E_READONLY/);
  assert.equal(validate(rootRead), true);
  end(rootRead);
  assert.equal(stack.length, 0);
}

test('nested state reborrow authority is monotonic and denial is atomic', () => {
  verifyNestedStateAuthority();
});

test('nested state authority oracle detects the escalation mutation', () => {
  assert.throws(() => verifyNestedStateAuthority(true));
});
