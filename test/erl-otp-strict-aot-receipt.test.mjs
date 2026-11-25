import test from 'node:test';
import assert from 'node:assert/strict';
import { constants, mkdtempSync, writeFileSync, symlinkSync, linkSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectReceipt, validateReceipt, readUntrustedReceipt } from '../bin/verify-erl-otp-aot-receipt.mjs';

const h40 = 'a'.repeat(40), h64 = 'b'.repeat(64);
const manifest = JSON.parse(readFileSync(new URL('../contracts/erl-otp-strict-aot-v1.json', import.meta.url), 'utf8'));
function sourceHashFor(id) {
  const vector = manifest.vectors.find(v => v.id === id);
  assert.ok(vector && typeof vector.source === 'string', 'source-backed fixture required: ' + id);
  return createHash('sha256').update(Buffer.from(vector.source, 'utf8')).digest('hex');
}
function candidate(fixtureId = 'eq.same_int') {
  return {
    contract: 'attolang-erlang-otp-strict-aot-v1',
    backend: 'llvm',
    feature: 'typed_equality',
    status: 'VERIFIED',
    evidenceClass: 'compiler-guest',
    compiler: { repository: 'ores-truffle-oreslang/oreslang-source.llvm',
      headSha: h40, treeSha: h40, binarySha256: h64 },
    fixture: { id: fixtureId, sourceProfile: 'atto-strict-v1', sha256: sourceHashFor(fixtureId) },
    artifact: { sha256: h64 },
    execution: {
      runId: 42, jobId: 43, jobAttempt: 1, executedSteps: 6,
      compilationOutcome: 'accepted', compiledGuest: true, executedGuest: true,
      outputArtifactCreated: true, mode: 'strict-aot',
      jitUsed: false, interpreterFallbackUsed: false, runtimeGuestCompilerUsed: false,
      reflectionDispatchUsed: false, aotFallbackMutationRejected: true, negativeDiagnosticsPassed: true,
      runUrl: 'https://github.com/example/repo/actions/runs/42',
      independentReviewUrl: 'https://github.com/example/repo/pull/4#pullrequestreview-55',
    },
  };
}
function negativeCandidate() {
  const r = candidate('eq.no_implicit_float');
  r.execution.compilationOutcome = 'rejected';
  r.execution.compiledGuest = false;
  r.execution.executedGuest = false;
  r.execution.outputArtifactCreated = false;
  r.execution.observedDiagnosticClass = 'incompatible_equality_types';
  delete r.artifact;
  return r;
}

test('a perfect self-reported JSON is NEVER an independent guest proof', () => {
  for (const r of [candidate(), negativeCandidate()]) {
    const v = validateReceipt(r);
    assert.equal(v.structurallyValid, true, v.errors.join(', '));
    assert.equal(v.ok, false, 'no promotion without attestation');
    assert.equal(v.verified, false);
    assert.equal(v.classification, 'STRUCTURAL_ONLY_NOT_ATTESTED');
    assert.deepEqual(inspectReceipt(r), v);
  }
});

test('rejected fixture cannot pretend it ran or published an artifact', () => {
  const changes = [
    r => { r.execution.compilationOutcome = 'accepted'; },
    r => { r.execution.compiledGuest = true; },
    r => { r.execution.executedGuest = true; },
    r => { r.execution.outputArtifactCreated = true; },
    r => { r.artifact = { sha256: h64 }; },
    r => { r.execution.observedDiagnosticClass = 'wrong_class'; },
  ];
  for (const change of changes) {
    const r = negativeCandidate(); change(r);
    assert.equal(validateReceipt(r).structurallyValid, false, change.toString());
  }
});

test('accepted fixture cannot pretend it rejected or omit executable proof', () => {
  const changes = [
    r => { r.execution.compilationOutcome = 'rejected'; },
    r => { r.execution.compiledGuest = false; },
    r => { r.execution.executedGuest = false; },
    r => { r.execution.outputArtifactCreated = false; },
    r => { delete r.artifact; },
  ];
  for (const change of changes) {
    const r = candidate(); change(r);
    assert.equal(validateReceipt(r).structurallyValid, false, change.toString());
  }
});

test('rejection mutation suite denies forged statuses and broken AOT invariants', () => {
  const mutations = [
    r => { r.execution.executedSteps = 0; },
    r => { r.execution.executedSteps = null; },
    r => { r.evidenceClass = 'host-only'; },
    r => { r.compiler.headSha = 'bad'; },
    r => { r.compiler.treeSha = ''; },
    r => { r.compiler.binarySha256 = ''; },
    r => { r.fixture.sha256 = ''; },
    r => { r.execution.mode = 'hybrid'; },
    r => { r.execution.interpreterFallbackUsed = true; },
    r => { delete r.execution.jitUsed; },
    r => { r.execution.runtimeGuestCompilerUsed = true; },
    r => { r.execution.reflectionDispatchUsed = true; },
    r => { r.execution.aotFallbackMutationRejected = false; },
    r => { r.execution.negativeDiagnosticsPassed = false; },
    r => { r.execution.runId = 0; },
    r => { r.execution.jobAttempt = null; },
    r => { r.execution.runUrl = 'https://github.com/example/repo/actions/runs/41'; },
    r => { r.execution.runUrl = 'https://github.com/example/repo/actions/runs/42?forged=1'; },
    r => { r.execution.independentReviewUrl = 'https://github.com/example/repo/pull/4'; },
    r => { r.backend = 'js'; },
    r => { r.status = 'NOT_EXECUTED'; },
    r => { r.feature = 'unknown_future'; },
    r => { r.fixture.id = 'not_a_vector'; },
    r => { r.fixture.id = 'aot.no_interpreter_fallback'; },
  ];
  for (const mutate of mutations) {
    const r = candidate(); mutate(r);
    const v = validateReceipt(r);
    assert.equal(v.structurallyValid, false, mutate.toString());
    assert.equal(v.ok, false);
    assert.ok(v.errors.length > 0);
  }
});

test('a well-shaped but forged source digest fails before attestation', () => {
  const r = candidate();
  r.fixture.sha256 = h64;
  assert.equal(validateReceipt(r).structurallyValid, false);
});

test('prose-only runtime/policy scenarios cannot impersonate executable fixtures', () => {
  const scenarios = [
    ['selective_receive.keep_unmatched', 'selective_receive'],
    ['supervision_restart.one_for_one', 'supervision_restart'],
    ['aot.no_interpreter_fallback', 'finite_closures'],
  ];
  for (const [id, feature] of scenarios) {
    const r = candidate();
    r.feature = feature;
    r.fixture.id = id; // Even perfectly shaped user-supplied hashes are not executable source.
    const result = validateReceipt(r);
    assert.equal(result.structurallyValid, false, id);
    assert.match(result.errors.join(' / '), /no executable guest source/);
  }
});

test('null, array and primitive receipts fail closed', () => {
  for (const value of [null, undefined, [], 'PASS', 1]) {
    const v = validateReceipt(value);
    assert.equal(v.structurallyValid, false);
    assert.equal(v.ok, false);
  }
});

test('path reader never follows symlinks or permits hardlink aliases', { skip: constants.O_NOFOLLOW === undefined },
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'atto-aot-receipt-'));
    try {
      const target = join(dir, 'receipt.json');
      writeFileSync(target, JSON.stringify(candidate()));
      assert.deepEqual(readUntrustedReceipt(target), candidate());
      const symlink = join(dir, 'link.json');
      symlinkSync(target, symlink);
      assert.throws(() => readUntrustedReceipt(symlink));
      const hardlink = join(dir, 'hardlink.json');
      linkSync(target, hardlink);
      assert.throws(() => readUntrustedReceipt(target));
      assert.throws(() => readUntrustedReceipt(hardlink));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
);
