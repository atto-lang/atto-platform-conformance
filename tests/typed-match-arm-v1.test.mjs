// Source-identity and evidence-state gate only. It does not compile guest programs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'contracts/typed-match-arm-v1.json'), 'utf8'));

function gitBlobSha1(bytes) {
  const prefix = Buffer.from('blob ' + bytes.length + '\0');
  return createHash('sha1').update(prefix).update(bytes).digest('hex');
}

test('typed-match-arm registry pins unchanged actual Git-source blobs', () => {
  assert.equal(manifest.schema, 'attolang.typed-match-arm.v1');
  assert.equal(manifest.status, 'CANDIDATE_NOT_CROSS_BACKEND_CERTIFIED');
  assert.ok(manifest.cases.length >= 12);
  assert.equal(new Set(manifest.cases.map(x => x.id)).size, manifest.cases.length);
  assert.equal(new Set(manifest.cases.map(x => x.path)).size, manifest.cases.length);
  assert.ok(manifest.cases.some(x => x.id.startsWith('switch-') && x.expect.kind === 'exit'));
  assert.ok(manifest.cases.some(x => x.id.startsWith('switch-') && x.expect.kind === 'diagnostic'));
  for (const item of manifest.cases) {
    assert.match(item.git_blob_sha1, /^[0-9a-f]{40}$/);
    assert.ok(item.path.startsWith('fixtures/typed-match-arm-v1/'));
    const absolute = resolve(root, item.path);
    assert.ok(absolute.startsWith(root + sep), 'fixture must stay inside repo');
    const bytes = readFileSync(absolute);
    assert.equal(gitBlobSha1(bytes), item.git_blob_sha1, item.id + ': blob drift');
    const source = bytes.toString('utf8');
    if (item.expect.kind === 'exit') {
      assert.ok(source.includes('// expect-exit: ' + item.expect.value), item.id);
      assert.match(source, /(?:on|case)\s+\w+(?:\([^)]*\))?\s*:\s*int\s*->/);
      if (item.id.startsWith('switch-')) {
        assert.match(source, /\bswitch\s*<int>/, item.id + ': typed switch expression');
        assert.match(source, /\bcase\s+/, item.id + ': canonical case label');
      }
    } else {
      assert.equal(item.expect.kind, 'diagnostic');
      assert.ok(source.includes('// expect-error: ' + item.expect.code), item.id);
    }
  }
});

test('scoped Rust/Wasm PASS must cite executed guests; other backends remain unverified', () => {
  assert.equal(manifest.backends['rust-wasm'], 'PASS');
  const proof = manifest.execution_receipts?.['rust-wasm'];
  assert.ok(proof, 'a PASS requires an explicit immutable execution receipt');
  assert.equal(proof.status, 'PASS');
  assert.match(proof.source_commit, /^[a-f0-9]{40}$/);
  assert.match(proof.carrier_commit, /^[a-f0-9]{40}$/);
  assert.equal(proof.source_commit, manifest.source.async_compiler_commit);
  assert.equal(proof.source_git_blobs_verified, 50);
  assert.ok(Number.isSafeInteger(proof.workflow_run_id) && proof.workflow_run_id > 0);
  assert.ok(Number.isSafeInteger(proof.workflow_job_id) && proof.workflow_job_id > 0);
  assert.deepEqual(proof.native_rust_tests, { passed: 35, failed: 0 });
  assert.equal(proof.guest_fixtures.passed, manifest.cases.length);
  assert.equal(proof.guest_fixtures.failed, 0);
  assert.equal(proof.guest_fixtures.positive_exit_42,
    manifest.cases.filter(x => x.expect.kind === 'exit').length);
  assert.equal(proof.guest_fixtures.negative_without_artifact,
    manifest.cases.filter(x => x.expect.kind === 'diagnostic').length);
  assert.match(proof.chromium_jspi, /^PASS:/);
  assert.equal(proof.task_captures, 'UNSUPPORTED');
  for (const backend of ['java', 'llvm', 'dotnet']) {
    assert.equal(manifest.backends[backend], 'NOT_EXECUTED');
    assert.equal(manifest.execution_receipts?.[backend], undefined);
  }
});
