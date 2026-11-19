import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const c = JSON.parse(readFileSync(new URL('contracts/class-constructor-self-publication-v2.json', root), 'utf8'));

test('inline constructor portable contract remains explicitly source scoped', () => {
  assert.equal(c.schema, 'atto.class-constructor-self-publication.v2');
  assert.equal(c.status, 'RUST_NATIVE_GUEST_SCOPED_PASS');
  assert.match(c.compiler_source_merge_sha, /^[0-9a-f]{40}$/);
  assert.deepEqual(c.cases.map(x => x.id),
    ['inline_self_escape','inline_method_before_publication','inline_initialized_counter']);
  assert.equal(c.backend_status['rs-native-host'], 'VERIFIED');
  assert.ok(Object.entries(c.backend_status).every(([backend, status]) =>
    backend === 'rs-native-host' || status === 'NOT_EXECUTED'));
});
test('inline class constructor positives and negative fixture contents are well formed', () => {
  for (const item of c.cases) {
    const s = readFileSync(new URL(item.path, root), 'utf8');
    assert.ok(s.includes('constructor(int initial)'));
    assert.ok(s.includes('pub fnc main()'));
    if (item.kind === 'reject') {
      assert.ok(s.startsWith('// expect-error: E_OWNERSHIP'));
      assert.equal(item.code, 'E_OWNERSHIP');
      assert.equal(item.artifact, 'NONE');
    } else {
      assert.ok(s.startsWith('// expect-exit: 42'));
      assert.equal(item.expected_exit, 42);
    }
  }
  assert.match(readFileSync(new URL(c.cases[0].path, root), 'utf8'), /publish\(self\)/);
  assert.match(readFileSync(new URL(c.cases[1].path, root), 'utf8'), /self\.peek\(\)/);
  assert.match(readFileSync(new URL(c.cases[2].path, root), 'utf8'), /self\.value = initial/);
});

test('native-hosted compiled guest evidence cannot be misreported as independent backend parity', () => {
  const e = c.native_guest_evidence;
  assert.equal(e.scope, 'NATIVE_RUST_COMPILER_TO_PORTABLE_WASM_GUEST');
  for (const sha of [e.compiler_merge_sha,e.compiler_tested_head_sha,e.carrier_commit])
    assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(e.run_id, 44447969540);
  assert.equal(e.job_id, 135304645719);
  assert.equal(e.conclusion,'success');
  assert.equal(e.exact_github_source_blobs_verified_before_after,48);
  assert.deepEqual(e.rust_constructor_tests,{passed:12,failed:0});
  assert.deepEqual(e.node_portable_registry_tests,{passed:2,failed:0});
  assert.deepEqual(e.inline_negative_fixtures,
    {checked:2,diagnostic:'E_OWNERSHIP',emitted_wasm:0});
  assert.deepEqual(e.inline_positive_fixture,{checked:1,guest_exit:42});
  assert.equal(e.independent_backend_exclusion.length,8);
  assert.ok(e.independent_backend_exclusion.includes('rs-browser-hosted'));
});
