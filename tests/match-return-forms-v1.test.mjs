// Source-integrity and unexecuted-status gate only. NOT compiled guest evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'contracts/match-return-forms-v1.json'), 'utf8'));
const expectedBackends = [
  'atto-source.rs', 'atto-source.wasm', 'atto-source.java',
  'atto-source.llvm', 'atto-source.net', 'atto-source.forge',
  'atto-source.cranelift', 'atto-source.js', 'atto-source.atto',
  'atto-source.hdl', 'atto-source.realtime',
];

function blobSha(bytes) {
  return createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0'))
    .update(bytes)
    .digest('hex');
}

test('match-return fixtures are immutable, complete and byte-pinned', () => {
  assert.equal(manifest.schema, 'attolang.match-return-forms.v1');
  assert.equal(manifest.status, 'CANDIDATE_NOT_CROSS_BACKEND_CERTIFIED');
  assert.deepEqual(manifest.cases.map(c => c.id), [
    'return-block', 'caret-block', 'nonexhaustive-guard', 'fallthrough-block'
  ]);
  assert.equal(new Set(manifest.cases.map(c => c.path)).size, manifest.cases.length);
  const sources = new Map();
  for (const item of manifest.cases) {
    assert.match(item.git_blob_sha1, /^[0-9a-f]{40}$/);
    assert.match(item.path, /^fixtures\/match-return-forms-v1\/(pass|fail)\/[a-z-]+\.atto$/);
    const abs = resolve(root, item.path);
    assert.ok(abs.startsWith(root + sep), 'source outside repository');
    const bytes = readFileSync(abs);
    assert.equal(blobSha(bytes), item.git_blob_sha1, item.id + ': source Git blob mismatch');
    const src = bytes.toString('utf8');
    sources.set(item.id, src);
    if (item.expect.kind === 'guest') {
      assert.equal(item.expect.exit, 0);
      assert.equal(item.expect.stdout, '2\n2\n');
      assert.match(src, /\/\/ expect-exit: 0/);
      assert.equal((src.match(/\/\/ expect-stdout: 2/g) || []).length, 2);
      assert.match(src, /on n when n > 1/);
      assert.match(src, /on _ ->/);
      assert.match(src, /on 0 ->/);
      assert.match(src, /on 1 ->/);
      assert.match(src, /stdio\.println\(classify\(7\)\)/);
      assert.match(src, /stdio\.println\(xyx\(7\)\)/);
    } else {
      assert.equal(item.expect.kind, 'diagnostic');
      assert.ok(item.expect.no_guest);
      assert.ok(src.includes('// expect-error: ' + item.expect.code));
    }
  }
  assert.match(sources.get('return-block'), /return match value over/);
  assert.match(sources.get('caret-block'), /\^ match value over/);
  for (const id of ['return-block', 'caret-block']) {
    const src = sources.get(id);
    assert.match(src, /on 0 -> \{ return 0; \}/);
    assert.match(src, /on n when n > 1 -> 2,/);
  }
  assert.match(sources.get('fallthrough-block'), /on 0 -> \{ val seen = 0; \}/);
});

test('unproven compiler parity is never marked passed by host fixture checks', () => {
  assert.deepEqual(Object.keys(manifest.backends), expectedBackends);
  assert.match(manifest.source.head_at_fixture_import, /^[a-f0-9]{40}$/);
  assert.equal(manifest.source.verification, 'NOT_EXECUTED_ON_THIS_HEAD');
  for (const [backend, result] of Object.entries(manifest.backends)) {
    assert.equal(result.status, 'NOT_EXECUTED', backend);
    assert.equal(result.source_sha, null, backend);
    assert.equal(result.guest_receipt, null, backend);
  }
  assert.match(manifest.backends['atto-source.wasm'].compiler_implementation, /^adapter/);
  assert.match(manifest.backends['atto-source.realtime'].compiler_implementation, /^runtime-only/);
});
