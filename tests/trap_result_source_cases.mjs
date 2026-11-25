// SOURCE ONLY. Does not run an Atto compiler or guest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const m = JSON.parse(readFileSync(root + 'contracts/trap-result-guest-v1.json', 'utf8'));

const expectedBackends = [
  'atto-source.atto', 'atto-source.cranelift', 'atto-source.forge',
  'atto-source.hdl', 'atto-source.java', 'atto-source.js',
  'atto-source.llvm', 'atto-source.net', 'atto-source.realtime',
  'atto-source.rs', 'atto-source.wasm',
].sort();
const blobSha = bytes => createHash('sha1')
  .update('blob ' + bytes.length + String.fromCharCode(0))
  .update(bytes).digest('hex');

test('all eleven backends remain uncertified for these new fixtures', () => {
  assert.equal(m.claim, 'TARGET_ONLY_NOT_GUEST_VERIFIED');
  assert.deepEqual(Object.keys(m.backends).sort(), expectedBackends);
  for (const [name, row] of Object.entries(m.backends)) {
    assert.ok(name.startsWith('atto-source.'));
    assert.equal(row.status, 'NOT_EXECUTED');
    assert.equal(row.compiler_head, null);
    assert.equal(row.guest_receipt, null);
  }
});
test('source-only target registry is complete and has both outcomes', () => {
  const ids = new Set();
  assert.equal(m.cases.length, 21);
  let positive = 0, negative = 0;
  for (const c of m.cases) {
    assert.ok(!ids.has(c.id)); ids.add(c.id);
    assert.ok(c.source.startsWith('fixtures/trap-result-v1/'));
    assert.ok(c.source.endsWith('.atto'));
    assert.ok(existsSync(root + c.source));
    assert.ok(readFileSync(root + c.source, 'utf8').includes('fnc main(): int'));
    assert.equal(c.status, 'TARGET_ONLY');
    if (c.expect.kind === 'guest_exit') {
      assert.ok(Number.isInteger(c.expect.exit_code));
      positive++;
    } else {
      assert.equal(c.expect.kind, 'compile_reject');
      assert.ok(c.expect.diagnostic.startsWith('E_'));
      assert.equal(c.expect.no_artifact, true);
      negative++;
    }
  }
  assert.equal(positive, 14);
  assert.equal(negative, 7);
  // No undocumented .atto file may sit next to the canonical 21 cases.
  const directory = root + 'fixtures/trap-result-v1/';
  const expectedFiles = m.cases.map(c => c.id + '.atto').sort();
  assert.deepEqual(readdirSync(directory).filter(n => n.endsWith('.atto')).sort(),
    expectedFiles, 'every portable fixture must have a registry row');
  assert.ok(ids.has('parse-id-ok'));
  assert.ok(ids.has('reject-impossible-join'));
  assert.ok(ids.has('reject-obsolete-option-trap-binding'));

});

test('obsolete Option-valued trap is an exact pinned negative, never a v1 positive', () => {
  const path = 'fixtures/trap-result-v1/reject-obsolete-option-trap-binding.atto';
  const data = readFileSync(root + path);
  const sha = createHash('sha1').update('blob ' + data.length + String.fromCharCode(0)).update(data).digest('hex');
  assert.equal(sha, 'c0467b30232d2ecd5487eecb09fd86cedc79cbc0');
  assert.ok(data.toString('utf8').includes('Option<int> = trap (40 + 2)'));
  const caseEntry = m.cases.find(c => c.id === 'reject-obsolete-option-trap-binding');
  assert.equal(caseEntry.source, path);
  assert.equal(caseEntry.expect.kind, 'compile_reject');
  assert.equal(caseEntry.expect.no_artifact, true);
});


test('every canonical fixture is pinned to its exact Git blob across all 11 targets', () => {
  const seenBlobs = new Set();
  for (const c of m.cases) {
    assert.match(c.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(c.source, 'fixtures/trap-result-v1/' + c.id + '.atto');
    assert.match(c.source_blob_sha, /^[a-f0-9]{40}$/);
    const file = root + c.source;
    assert.ok(lstatSync(file).isFile(), 'reject symlink or non-file fixture');
    const bytes = readFileSync(file);
    assert.equal(blobSha(bytes), c.source_blob_sha,
      'tampered, stale or mismatched source blob: ' + c.id);
    const str = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assert.ok(str.endsWith('\n'), 'require canonical final newline');
    assert.ok(!str.includes('\r'), 'no CRLF or hidden CR changes');
    assert.ok(!seenBlobs.has(c.source_blob_sha), 'duplicate source blobs');
    seenBlobs.add(c.source_blob_sha);
    // Each candidate backend must run these exact same bytes. This source-only
    // check is not evidence of successful compiler or guest execution.
    for (const backend of expectedBackends) {
      assert.equal(m.backends[backend].status, 'NOT_EXECUTED');
    }
  }
  assert.equal(seenBlobs.size, 21);
  assert.equal(seenBlobs.size * expectedBackends.length, 231);
});

test('source blob pins detect even a one-byte mutation before compiler admission', () => {
  for (const c of m.cases) {
    const original = readFileSync(root + c.source);
    const modified = Buffer.concat([original, Buffer.from(' ')]);
    assert.notEqual(blobSha(modified), c.source_blob_sha, c.id);
  }
});
