import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inspectMediaReplayGuestReceipt } from '../lib/media-replay-receipts-v1.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const inventory = read('../contracts/media-replay-native-receipts-v1.json');
const alignment = read('../contracts/media-replay-native-source-alignment-v1.json');
function fixture(backend = 'java') {
  const entry = alignment.backends.find((b) => b.name === backend);
  const stdout = inventory.ordered_labels.map((label) => 'REPLAY-PASS|' + label).concat(inventory.terminal).join('\n') + '\n';
  return { backend, repository: entry.repo, sourceCommit: entry.head,
    sourceBlobSha: alignment.source_code_blob_sha, fixtureBlobSha: entry.test_blob_sha,
    compilerBinarySha256: 'a'.repeat(64), guestBinarySha256: 'b'.repeat(64),
    workflowRunId: 1, workflowJobId: 2, steps: [
      { id: 'checkout', status: 'completed', conclusion: 'success' },
      { id: 'compile_guest', status: 'completed', conclusion: 'success' },
      { id: 'execute_guest', status: 'completed', conclusion: 'success' },
    ], runtimeExitCode: 0, runtimeSignal: null, guestExecuted: true, checkOnly: false,
    workflowConclusion: 'success', stdout, stderr: '',
    stdoutSha256: createHash('sha256').update(stdout).digest('hex') };
}
const check = (report) => inspectMediaReplayGuestReceipt(report, inventory, alignment);
test('fixture has 80 distinct source-pinned guest receipts', () => {
  assert.equal(inventory.ordered_labels.length, 80);
  assert.equal(new Set(inventory.ordered_labels).size, 80);
  assert.equal(alignment.backends.length, 5);
});
test('malformed, duplicate, and tampered 80-receipt inventories fail closed', () => {
  const valid = fixture();
  const duplicate = structuredClone(inventory);
  duplicate.ordered_labels[79] = duplicate.ordered_labels[0];
  assert.equal(inspectMediaReplayGuestReceipt(valid, duplicate, alignment).error, 'INVALID_INVENTORY');
  const short = structuredClone(inventory);
  short.ordered_labels.pop();
  assert.equal(inspectMediaReplayGuestReceipt(valid, short, alignment).error, 'INVALID_INVENTORY');
  const malformed = structuredClone(inventory);
  malformed.ordered_labels[1] = '';
  assert.equal(inspectMediaReplayGuestReceipt(valid, malformed, alignment).error, 'INVALID_INVENTORY');
  const wrongPrefix = structuredClone(inventory);
  wrongPrefix.receipt_prefix = 'HOST-PASS|';
  assert.equal(inspectMediaReplayGuestReceipt(valid, wrongPrefix, alignment).error, 'INVALID_INVENTORY');
  const wrongTerminal = structuredClone(inventory);
  wrongTerminal.terminal = 'HOST-DONE';
  assert.equal(inspectMediaReplayGuestReceipt(valid, wrongTerminal, alignment).error, 'INVALID_INVENTORY');
});
test('synthetic receipt shape is recognized for each backend; never called CI evidence', () => {
  for (const backend of alignment.backends) {
    const result = check(fixture(backend.name));
    assert.equal(result.ok, true);
    assert.equal(result.value.provenance, 'SHAPE_ONLY_NOT_AUTHENTICATED');
  }
});
test('zero-step or missing compile step is not a guest pass', () => {
  const a = fixture(); a.steps = [];
  assert.equal(check(a).error, 'ZERO_STEP_OR_MISSING_JOB');
  const b = fixture(); b.steps[1].conclusion = 'skipped';
  assert.equal(check(b).error, 'MISSING_EXECUTED_STEP');
});
test('duplicate, conflicting and skipped required CI steps fail closed', () => {
  for (const stepId of ['checkout', 'compile_guest', 'execute_guest']) {
    const duplicate = fixture();
    duplicate.steps.push({ id: stepId, status: 'completed', conclusion: 'success' });
    assert.equal(check(duplicate).error, 'MISSING_EXECUTED_STEP');
    const conflicting = fixture();
    conflicting.steps.push({ id: stepId, status: 'completed', conclusion: 'failure' });
    assert.equal(check(conflicting).error, 'MISSING_EXECUTED_STEP');
    const skipped = fixture();
    skipped.steps.find((step) => step.id === stepId).status = 'queued';
    assert.equal(check(skipped).error, 'MISSING_EXECUTED_STEP');
  }
});
test('wrong compiler source SHA or fixture SHA fails', () => {
  const a = fixture(); a.sourceCommit = 'f'.repeat(40);
  assert.equal(check(a).error, 'UNPINNED_SOURCE');
  const b = fixture(); b.fixtureBlobSha = 'e'.repeat(40);
  assert.equal(check(b).error, 'UNPINNED_SOURCE');
});
test('host-only and check-only reports are not executable guest success', () => {
  const a = fixture(); a.guestExecuted = false;
  assert.equal(check(a).error, 'NO_SUCCESSFUL_GUEST_EXECUTION');
  const b = fixture(); b.checkOnly = true;
  assert.equal(check(b).error, 'NO_SUCCESSFUL_GUEST_EXECUTION');
});
test('fake, duplicate and shuffled receipts fail even when output hash is internally consistent', () => {
  const a = fixture(); a.stdout = a.stdout.replace('REPLAY-PASS|capacity', 'REPLAY-PASS|missing');
  a.stdoutSha256 = createHash('sha256').update(a.stdout).digest('hex');
  assert.equal(check(a).error, 'GUEST_RECEIPT_MISMATCH');
  const b = fixture(); b.stdout += 'REPLAY-PASS|capacity\n';
  b.stdoutSha256 = createHash('sha256').update(b.stdout).digest('hex');
  assert.equal(check(b).error, 'GUEST_RECEIPT_MISMATCH');
});
test('stdout hash and stderr are both bound', () => {
  const a = fixture(); a.stdoutSha256 = '1'.repeat(64);
  assert.equal(check(a).error, 'UNBOUND_OUTPUT');
  const b = fixture(); b.stderr = 'fatal';
  assert.equal(check(b).error, 'UNBOUND_OUTPUT');
});
test('wrong branch backend and nonzero exit are refused', () => {
  const a = fixture(); a.backend = 'forge';
  assert.equal(check(a).error, 'UNKNOWN_BACKEND');
  const b = fixture(); b.runtimeExitCode = 1;
  assert.equal(check(b).error, 'NO_SUCCESSFUL_GUEST_EXECUTION');
});
