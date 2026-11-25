// HOST-ONLY registry audit. A green node:test result here is never compiler evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const base = '../fixtures/signed-any-literal/v1/';
const manifest = JSON.parse(readFileSync(new URL(base + 'manifest.json', import.meta.url), 'utf8'));
const bytes = file => readFileSync(new URL(base + file, import.meta.url));
const gitBlobSha = b => createHash('sha1')
  .update(Buffer.from('blob ' + b.length + '\0'))
  .update(b)
  .digest('hex');

test('HOST-ONLY: signed Any corpus is explicitly NOT compiler-tested', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.scope, 'signed-scalar-literals-in-bounded-monomorphic-Any-v1');
  assert.equal(manifest.cases.length, 10);
  assert.equal(manifest.actualGuestExecution, false);
  assert.equal(manifest.backendParityCertified, false);
  assert.ok(Object.keys(manifest.backendEvidence).length >= 5);
  assert.ok(Object.values(manifest.backendEvidence).every(x => x === 'NOT_EXECUTED'));
  assert.equal(manifest.referenceSource.status, 'DRAFT_UNTESTED');
});

test('HOST-ONLY: all authored fixture blobs match exact Git identities', () => {
  const ids = new Set();
  let positive = 0, negative = 0;
  for (const entry of manifest.cases) {
    assert.match(entry.id, /^[a-z0-9-]+$/);
    assert.equal(ids.has(entry.id), false, 'duplicate case ID ' + entry.id);
    ids.add(entry.id);
    assert.equal(entry.file, entry.id + '.atto');
    assert.match(entry.sourceGitBlobSha1, /^[0-9a-f]{40}$/);
    const input = bytes(entry.file);
    assert.equal(input.includes(0), false);
    assert.ok(input.length > 40 && input.length < 16384);
    assert.equal(gitBlobSha(input), entry.sourceGitBlobSha1, entry.file);
    const text = input.toString('utf8');
    assert.match(text, /val value: Any = /);
    assert.match(text, /pub fnc main\(\): int /);
    if (entry.expect === 'accept') {
      positive++;
      assert.equal(entry.guestMainI64, '42');
      assert.equal(Object.hasOwn(entry, 'diagnosticCode'), false);
    } else {
      negative++;
      assert.equal(entry.expect, 'reject');
      assert.equal(entry.artifactExpected, false);
      assert.match(entry.diagnosticCode, /^E_[A-Z_]+$/);
      assert.equal(Object.hasOwn(entry, 'guestMainI64'), false);
    }
  }
  assert.equal(positive, 6);
  assert.equal(negative, 4);
});
