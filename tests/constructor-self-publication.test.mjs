import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const registry = JSON.parse(readFileSync(new URL('contracts/constructor-self-publication-v1.json', root), 'utf8'));

test('constructor self-publication safety registry identifies independent backend claims', () => {
  assert.equal(registry.schema, 'atto.out-of-line-constructor-self-publication.v1');
  assert.equal(registry.status, 'RUST_NATIVE_COMPILER_GUEST_SCOPED_PASS');
  assert.match(registry.source_merge_sha, /^[0-9a-f]{40}$/);
  assert.equal(registry.required_cases.length, 2);
  assert.equal(new Set(registry.required_cases.map(x => x.id)).size, 2);
  assert.equal(registry.backend_status['rs-native-guest'], 'VERIFIED');
  assert.ok(Object.entries(registry.backend_status).every(([backend, status]) =>
    backend === 'rs-native-guest' || status === 'NOT_EXECUTED'));
});
test('under-construction self cannot be published or method-dispatched in portable negative sources', () => {
  for (const c of registry.required_cases) {
    assert.equal(c.kind, 'fail');
    assert.equal(c.expected_error, 'E_OWNERSHIP');
    const s = readFileSync(new URL(c.path, root), 'utf8');
    assert.ok(s.startsWith('// expect-error: E_OWNERSHIP'));
    assert.ok(s.includes('constructor'));
    assert.ok(s.includes('pub fnc main()'));
    assert.ok(s.length < 10000);
  }
  const escaped = readFileSync(new URL(registry.required_cases[0].path, root), 'utf8');
  const called = readFileSync(new URL(registry.required_cases[1].path, root), 'utf8');
  assert.match(escaped, /publish\(self\)/);
  assert.match(called, /self\.get_value\(\)/);
  const valid = readFileSync(new URL(registry.existing_valid_initializer, root), 'utf8');
  assert.match(valid, /self\.value = initial/);
  assert.match(valid, /expect-exit: 42/);
});

test('compiled guest receipt is pinned and independent backends cannot inherit it', () => {
  const e = registry.guest_evidence;
  assert.equal(e.scope, 'NATIVE_RUST_COMPILER_TO_WASM_GUEST_PLUS_COMPILE_NEGATIVES');
  for (const sha of [e.source_head_sha, e.source_merged_sha, e.carrier_commit])
    assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(e.run_id, 44444993654);
  assert.equal(e.job_id, 135294863519);
  assert.equal(e.result, 'SUCCESS');
  assert.equal(e.source_blobs_verified_before_after, 49);
  assert.deepEqual(e.rust_focused_tests, {pass:10,fail:0});
  assert.equal(e.positive_wasm_guests.count, 4);
  assert.equal(e.positive_wasm_guests.expected_result, 42);
  assert.match(e.positive_wasm_guests.three_spelling_wasm_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(e.portable_negative_guests,
    {count:2,expected_error:'E_OWNERSHIP',emitted_artifacts:0});
  assert.deepEqual(e.source_only_node_tests, {pass:2,fail:0});
  assert.ok(e.excluded_backends.includes('rs-browser-hosted'));
  assert.equal(e.excluded_backends.length, 8);
});
