import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const c = JSON.parse(readFileSync(new URL('contracts/constructor-definite-final-scalars-v3.json', root), 'utf8'));
const gitBlob = source => createHash('sha1')
  .update('blob ' + Buffer.byteLength(source) + '\0').update(source).digest('hex');

test('v3 preserves eight ordinary source cases and expected outputs', () => {
  assert.equal(c.schema, 'atto.constructor-definite-final-scalars.v3');
  assert.equal(c.cases.length, 8);
  assert.equal(c.cases.filter(x => x.kind === 'pass').length, 4);
  assert.equal(new Set(c.cases.map(x => x.id)).size, 8);
  for (const item of c.cases) {
    const source = readFileSync(new URL(item.path, root), 'utf8');
    assert.equal(gitBlob(source), item.git_blob_sha, item.path);
    assert.match(source, /pub final (bool|float|string|Phase) /);
    assert.match(source, /pub fnc main\(\): int/);
    if (item.kind === 'pass') {
      assert.equal(item.expected_exit, 42);
      assert.ok(source.startsWith('// expect-exit: 42'));
    } else {
      assert.equal(item.no_artifact, true);
      assert.ok(source.startsWith('// expect-error: ' + item.expected_error));
    }
  }
});

test('v3 receipt is exact-tree and does not claim unrelated backend parity', () => {
  assert.equal(c.status, 'RUST_NATIVE_AND_WASM32_HOSTED_COMPILERS_EXECUTED');
  const e = c.evidence;
  assert.equal(e.conclusion, 'success');
  assert.equal(e.run_id, 44463703202);
  assert.equal(e.job_id, 135356300153);
  assert.deepEqual(e.rust_tests, { passed: 580, failed: 0, summaries: 72 });
  assert.deepEqual(e.browser_guest_conformance, {
    passed: 561, failed: 0, native_wasm_comparisons: 513
  });
  assert.equal(e.portable_positive_guests, 4);
  assert.equal(e.portable_compile_negative_no_artifact, 4);
  for (const sha of [e.source_pr_head, e.src_tree_sha, e.tests_tree_sha,
    e.carrier_commit, e.site_candidate_class_blob_sha]) {
    assert.match(sha, /^[a-f0-9]{40}$/);
  }
  assert.equal(c.backend_status['rs-native-compiler-to-wasm-guest'], 'VERIFIED');
  assert.equal(c.backend_status['rs-wasm32-hosted-compiler-to-wasm-guest'], 'VERIFIED');
  assert.ok(Object.entries(c.backend_status).every(([key, value]) =>
    key.startsWith('rs-') || value === 'NOT_EXECUTED'));
  assert.equal(e.public_site_release, 'BLOCKED_PINNED_BROWSER_COMPILER_E_UNSUPPORTED');
});
