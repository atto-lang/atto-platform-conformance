// Source-only, fail-closed metadata inventory. Never a compiled-guest receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const entry = JSON.parse(read('contracts/std-assertions-v1-source-parity.json'));

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
