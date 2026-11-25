import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const folder = '../fixtures/actor-stack-containment-v1/';
const load = file => JSON.parse(readFileSync(new URL(folder + file, import.meta.url), 'utf8'));
const gitBlobSha = bytes => createHash('sha1')
  .update(Buffer.from('blob ' + bytes.length + '\0'))
  .update(bytes).digest('hex');
const backendNames = ['forge', 'java', 'llvm', 'net', 'wasm'];

test('runtime evidence uses exact source heads while every guest remains unverified', () => {
  const matrix = load('backend-runtime-parity-evidence-v1.json');
  assert.equal(matrix.schemaVersion, 1);
  assert.equal(matrix.compiledGuestParity, 'NOT_CERTIFIED');
  assert.equal(matrix.sourceMirrorScope, 'FOCUSED_EXACT_BLOB_SUBSETS_NOT_FULL_TREES');
  assert.deepEqual(Object.keys(matrix.backends).sort(), backendNames);
  assert.equal(matrix.releaseGate.mergeAllowed, false);
  assert.equal(matrix.checkedFrameSubstrate.compilerEmittedGuestFrameChecksRequired, true);
  for (const name of backendNames) {
    const entry = matrix.backends[name];
    assert.match(entry.sourceHead, /^[a-f0-9]{40}$/);
    assert.match(entry.carrier, /^[\w.-]+\/[\w.-]+$/);
    assert.ok(Number.isSafeInteger(entry.runId) && entry.runId > 0);
    assert.ok(Number.isSafeInteger(entry.pr) && entry.pr > 0);
    assert.equal(entry.compiledGuest, 'NOT_EXECUTED',
      name + ': host tests cannot be counted as compiled guest evidence');
    assert.ok(entry.scope.includes('HOST') || entry.scope.includes('NATIVE_CPP'));
    assert.ok(entry.gaps.length > 0, name + ': do not omit remaining guest blockers');
  }
  assert.equal(matrix.backends.wasm.sharedCarrierActorIsolation, 'KNOWN_FAIL');
  assert.equal(matrix.backends.wasm.dedicatedWorkerFallback, 'EXECUTED_PASS');
  assert.equal(matrix.backends.forge.physicalGuardIsolation, 'PROCESS_ONLY');
});

test('the proposed same-carrier guest fixture is pinned and design-only', () => {
  const matrix = load('backend-runtime-parity-evidence-v1.json');
  const contract = load('two-actor-terminal-overflow.contract.json');
  const source = readFileSync(new URL(folder + 'two-actor-terminal-overflow.atto', import.meta.url));
  const actual = gitBlobSha(source);
  assert.equal(actual, matrix.releaseGate.fixtureSourceGitBlobSha1);
  assert.equal(actual, contract.sourceGitBlobSha1);
  assert.equal(contract.designOnly, true);
  assert.equal(contract.certification, 'NOT_CERTIFIED');
  assert.equal(contract.executionEvidence, 'NOT_EXECUTED');
  assert.deepEqual(Object.keys(contract.backends).sort(), backendNames);
  for (const value of Object.values(contract.backends)) {
    assert.equal(value, 'NOT_EXECUTED');
  }
  assert.equal(contract.requiredSetup.sameCarrierRequired, true);
  assert.equal(contract.expected.supervisorTerminalControlNotices, 1);
  assert.equal(contract.expected.peerFinalState, 3);
  assert.equal(contract.expected.peerCarrierSurvives, true);
  assert.equal(contract.expected.actorOnRaiseInvocations, 0);
  assert.equal(contract.expected.actorOnThrowInvocations, 0);
});
