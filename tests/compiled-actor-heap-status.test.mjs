import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const status = JSON.parse(readFileSync(
  new URL('../fixtures/actor-memory/compiled-guest-v1/backends.json', import.meta.url), 'utf8'));

test('the shared compiled guest contract cannot self-certify any backend', () => {
  assert.deepEqual(Object.keys(status).sort(), [
    'backends','hostTestsAreGuestEvidence','negativeCases','schemaVersion','scope',
    'selfAttestedTraceIsGuestEvidence','sourceFreeTestsAreGuestEvidence',
    'sourceGitBlobSha1','sourceSha256','verifiedGuestBackends'
  ]);
  assert.equal(status.schemaVersion, 2);
  assert.equal(status.scope, 'compiled-actor-private-heaps-v2');
  assert.equal(status.sourceGitBlobSha1, '430565092d8a4ff114f601a54b771ef3d42eae58');
  assert.equal(status.sourceSha256, '8a09c21d17e8f78b8964f0bda575301e9953295f5a78386d6a04e6772d4ff211');
  assert.deepEqual(status.verifiedGuestBackends, []);
  assert.deepEqual(Object.keys(status.backends).sort(), ['cranelift','forge','java','llvm','net','wasm']);
  assert.ok(Object.values(status.backends).every(x => x === 'UNSUPPORTED_OR_NOT_VERIFIED'));
  assert.deepEqual(Object.keys(status.negativeCases).sort(), ['foreign-state','read-loan-write']);
  assert.equal(status.negativeCases['foreign-state'].requiredDiagnosticClass, 'FOREIGN_ACTOR_STATE_DENIED');
  assert.equal(status.negativeCases['read-loan-write'].requiredDiagnosticClass, 'WRITE_WITH_READ_LOAN_DENIED');
  assert.equal(status.hostTestsAreGuestEvidence, false);
  assert.equal(status.sourceFreeTestsAreGuestEvidence, false);
  assert.equal(status.selfAttestedTraceIsGuestEvidence, false);
});
