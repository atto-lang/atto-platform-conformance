// Source-only, fail-closed metadata inventory. Never a compiled-guest receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const entry = JSON.parse(read('contracts/std-assertions-v1-source-parity.json'));

const expectedHeads = {
  "atto-lang/atto-source.java": "8ccb846a0d6b03c5d7608600b7792d6cc8701326",
  "atto-lang/atto-source.net": "ac181b2b0bc16646533a056af873802cfdf17b27",
  "atto-lang/atto-source.llvm": "cee5d69d43e0126decbfa9cea26dff928cd5eca0",
  "atto-lang/atto-source.rs": "fcf18353abe1d7966e1825fae684d6f3af566a73",
  "atto-lang/atto-source.wasm": "b79e54334bac2fd6a870a859de4e47c7d9afbd7c",
  "atto-lang/atto-source.js": "b96053bb11d397a29feeba2c497702ebd98155d4",
  "atto-lang/atto-source.forge": "69dd53cdcb87e727fec61bd09fbad3392abd4ba6",
  "atto-lang/atto-source.cranelift": "7cdf31cc4b0acb7987d787dbc30fb32abc5072a7",
  "atto-lang/atto-source.hdl": "90889f26cd8ab62514975fe5ca5f97f99b350921",
  "atto-lang/atto-source.atto": "ea629f4a20794bdde18c5fe57cbec16be9748283",
  "atto-lang/atto-source.realtime": "0b4f3e777dfd136f7858b76a10e76b653d3313ea"
};
const expectedCases = {
  "true_success": "guest_success",
  "false_success": "guest_success",
  "equal_success": "guest_success",
  "not_equal_success": "guest_success",
  "true_failure": "typed_AssertionError",
  "false_failure": "typed_AssertionError",
  "equal_failure": "typed_AssertionError",
  "not_equal_failure": "typed_AssertionError",
  "user_failure_message": "typed_AssertionError",
  "eq_mixed_numeric": "compile_error",
  "requires_bool": "compile_error",
  "unbound_module": "compile_error",
  "reserved_member_grammar": "compile_success",
  "args_once_left_to_right": "guest_success",
  "retained_in_release_and_aot": "typed_AssertionError",
  "caught_without_actor_supervisor_panic": "typed_AssertionError",
  "test_outcome_returns_failure_data": "guest_success",
  "bounded_diagnostics": "guest_success",
  "hdl_synthesis_reject_or_hosted_simulation": "profile_specific",
  "hard_realtime_reject_or_bounded_typed_effect": "profile_specific"
};

test('exact branch roster and source heads are pinned independently from manifest fields', () => {
  assert.deepEqual(Object.keys(expectedHeads).sort(), entry.targets.map(t => t.repository).sort());
  for (const target of entry.targets) {
    assert.equal(target.head_sha, expectedHeads[target.repository], target.repository);
    assert.equal(target.source_pr.startsWith('https://github.com/' + target.repository + '/pull/'), true);
  }
});

test('every required case retains its independently pinned expected result', () => {
  assert.deepEqual(Object.keys(expectedCases).sort(), entry.cases.map(c => c.id).sort());
  for (const one of entry.cases) {
    assert.equal(one.expect, expectedCases[one.id], one.id);
  }
});

test('all exact source candidates recorded with honest evidence boundary', () => {
  assert.equal(entry.contract, 'atto.std.assert.v1');
  assert.equal(entry.targets.length, 11);
  const names = entry.targets.map(t => t.repository);
  assert.equal(new Set(names).size, names.length);
  for (const t of entry.targets) {
    assert.match(t.repository, /^atto-lang\/atto-source\.[a-z]+$/);
    assert.match(t.source_pr, /^https:\/\/github\.com\/atto-lang\/atto-source\.[a-z]+\/pull\/[0-9]+$/);
    assert.match(t.head_sha, /^[0-9a-f]{40}$/);
    assert.equal(t.source_readback, 'VERIFIED_SOURCE_SHAPE');
    for (const field of ['compiler_typecheck', 'guest_success', 'guest_assertion_error',
                         'guest_negative', 'release_aot', 'atto_test']) {
      assert.equal(t[field], 'NOT_EXECUTED', t.repository + ': ' + field);
    }
  }
});

test('minimum positive, negative, effect, isolation and target profile corpus exists', () => {
  assert.equal(entry.cases.length, 20);
  const id = new Set(entry.cases.map(c => c.id));
  assert.equal(id.size, 20);
  for (const required of ['true_success', 'equal_failure', 'eq_mixed_numeric',
                         'args_once_left_to_right', 'retained_in_release_and_aot',
                         'caught_without_actor_supervisor_panic',
                         'test_outcome_returns_failure_data',
                         'hdl_synthesis_reject_or_hosted_simulation',
                         'hard_realtime_reject_or_bounded_typed_effect']) {
    assert.ok(id.has(required), required);
  }
  const profileCases = entry.cases.filter(c => c.expect === 'profile_specific');
  assert.equal(profileCases.length, 2);
});

test('portable guest fixtures are authored but not credited to a backend', () => {
  for (const name of ['pass', 'fail-unequal', 'reject-mixed-eq']) {
    const src = read('fixtures/std-assertions-v1/' + name + '.atto');
    assert.ok(src.includes('NOT_EXECUTED'));
    assert.ok(src.includes('import module assert from pkg "std.assert"'));
  }
});
