// SOURCE_ONLY contract validation. Never certifies an Atto compiler guest.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const registry = JSON.parse(readFileSync(new URL('../contracts/std-env-v1/host-snapshot-boundaries-v1.json', import.meta.url), 'utf8'));
const portableBackends = ['java','llvm','net','rs','forge','cranelift','js','wasm','atto','realtime','hdl'];
const cases = Object.fromEntries(registry.cases.map(c => [c.id, c]));
const bytes = c => c.trusted_values.count * (c.trusted_values.ascii_value_bytes ??
  Buffer.byteLength(c.trusted_values.unicode_value.repeat(c.trusted_values.unicode_repetitions), 'utf8'));

test('11 backend profiles remain explicitly unexecuted and nonpromoting', () => {
  assert.equal(registry.schema, 'atto.std-env.host-snapshot-boundaries.v1');
  assert.equal(registry.status, 'SOURCE_ONLY_TARGET');
  assert.equal(registry.evidence_category, 'HOST_ONLY');
  assert.equal(registry.guest_parity_qualified, false);
  assert.deepEqual(Object.keys(registry.backend_status).sort(), portableBackends.sort());
  assert.ok(Object.values(registry.backend_status).every(v => v === 'NOT_EXECUTED'));
  assert.equal(registry.limits.authorized_max_keys, 512);
  assert.equal(registry.limits.value_max_utf8_bytes, 16384);
  assert.equal(registry.limits.aggregate_authorized_utf8_bytes, 1048576);
});

test('exact, overflowing and UTF-8 aggregate oracles are byte accurate', () => {
  const exact = cases.aggregate_exact_1mib;
  const overflow = cases.aggregate_over_by_one;
  const unicode = cases.aggregate_multibyte_utf8_exact;
  assert.equal(bytes(exact), 1048576);
  assert.equal(bytes(overflow) + overflow.extra_value.ascii_value_bytes, 1048577);
  assert.equal(bytes(unicode), 1048576);
  assert.equal(exact.expected, 'ADMIT');
  assert.equal(overflow.expected, 'ENV_INVALID_SNAPSHOT');
  assert.equal(unicode.expected, 'ADMIT');
});

test('coarse/deny bypasses poisoned value before dereference or accounting', () => {
  const denied = cases.aggregate_denied_poisoned_value;
  assert.equal(bytes(denied), 1048576);
  assert.ok(denied.deny.includes(denied.poisoned_value.key));
  assert.equal(denied.poisoned_value.must_not_dereference, true);
  assert.equal(denied.expected, 'ADMIT');
  const coarse = cases.no_coarse_key_enumeration;
  assert.equal(coarse.coarse_env, false);
  assert.equal(coarse.trusted_values.key_metadata_unreadable, true);
  assert.equal(coarse.expected, 'ADMIT_EMPTY');
});

test('negative key-count boundary remains required for every profile', () => {
  assert.equal(cases.authorized_key_count_overflow.trusted_values.count, 513);
  assert.equal(cases.authorized_key_count_overflow.expected, 'ENV_INVALID_SNAPSHOT');
  assert.equal(new Set(registry.cases.map(x=>x.id)).size, registry.cases.length);
  assert.equal(registry.cases.length, 6);
});
