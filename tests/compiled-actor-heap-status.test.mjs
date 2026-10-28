import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const status = JSON.parse(readFileSync(new URL('../fixtures/actor-memory/compiled-guest-v1/backends.json', import.meta.url), 'utf8'));
test('the unexecuted shared guest fixture may not self-certify any backend', () => {
  assert.deepEqual(Object.keys(status).sort(), ['backends','hostTestsAreGuestEvidence','schemaVersion','scope','selfAttestedTraceIsGuestEvidence','sourceGitBlobSha1','verifiedGuestBackends']);
  assert.equal(status.schemaVersion,1);
  assert.equal(status.scope,'compiled-actor-private-heaps-v1');
  assert.equal(status.sourceGitBlobSha1,'016733b1fbc8bdfbde7414a15b877a190dd92806');
  assert.deepEqual(status.verifiedGuestBackends,[]);
  assert.deepEqual(Object.keys(status.backends).sort(),['forge','java','llvm','net','wasm']);
  assert.ok(Object.values(status.backends).every(x=>x==='UNSUPPORTED_OR_NOT_VERIFIED'));
  assert.equal(status.hostTestsAreGuestEvidence,false);
  assert.equal(status.selfAttestedTraceIsGuestEvidence,false);
});
