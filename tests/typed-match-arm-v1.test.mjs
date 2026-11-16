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
  assert.ok(manifest.cases.length >= 4);
  assert.equal(new Set(manifest.cases.map(x => x.id)).size, manifest.cases.length);
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
      assert.match(source, /on\s+\w+(?:\([^)]*\))?\s*:\s*int\s*->/);
    } else {
      assert.equal(item.expect.kind, 'diagnostic');
      assert.ok(source.includes('// expect-error: ' + item.expect.code), item.id);
    }
  }
});

test('never turn missing guest compiler receipts into backend passes', () => {
  for (const backend of ['rust-wasm', 'java', 'llvm', 'dotnet']) {
    assert.equal(manifest.backends[backend], 'NOT_EXECUTED');
  }
});
