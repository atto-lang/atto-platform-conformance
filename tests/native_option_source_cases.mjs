// SOURCE ONLY. Git-blob checks do not execute either Atto compiler or guest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const contract = JSON.parse(readFileSync(root + 'contracts/native-option-int-guest-v1.json', 'utf8'));
test('native Option<int> contract has three 42-exit source fixtures', () => {
  assert.equal(contract.claim, 'TARGET_ONLY_NOT_GUEST_VERIFIED');
  assert.equal(contract.cases.length, 3);
  assert.equal(Object.keys(contract.backends).length, 11);
  for (const c of contract.cases) {
    assert.match(c.source, /^fixtures\/native-option-int-v1\/[-a-z]+\.atto$/);
    const bytes = readFileSync(root + c.source);
    const hash = createHash('sha1')
      .update(Buffer.from('blob ' + bytes.length + '\0', 'utf8'))
      .update(bytes).digest('hex');
    assert.equal(hash, c.git_blob_sha, c.id + ': source blob changed');
    assert.equal(c.expect.kind, 'guest_exit');
    assert.equal(c.expect.exit_code, 42);
    assert.equal(c.status, 'TARGET_ONLY');
  }
});
test('source-only native Option evidence cannot certify a backend', () => {
  for (const backend of Object.values(contract.backends)) {
    assert.equal(backend.status, 'NOT_EXECUTED');
    assert.equal(backend.compiler_guest_receipt, null);
  }
  assert.equal(contract.candidate.guest_target, 'Linux x86_64 ELF, Clang O0/O2, no GC/heap');
  assert.match(contract.scope, /does not certify Result<int,Error>/);
});
