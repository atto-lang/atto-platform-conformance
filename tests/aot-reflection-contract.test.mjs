import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyManifest, verifyReceipt } from '../bin/verify-aot-reflection-receipt.mjs';

const manifest = JSON.parse(readFileSync(new URL('../contracts/aot-reflection-v1.json', import.meta.url), 'utf8'));
const gitSha = 'a'.repeat(40);
const digest = 'b'.repeat(64);

function candidateClaim() {
  return {
    contract: manifest.contract,
    backend: 'java',
    status: 'native-aot-claim',
    headSha: gitSha,
    treeSha: gitSha,
    compilerBinarySha256: digest,
    artifactSha256: digest,
    fixtureManifestSha256: digest,
    metadataSectionSha256: digest,
    reviewUrl: 'https://github.com/example/review/1',
    job: { runnerId: 42, runAttempt: 1, steps: [{ name: 'compile native guest', conclusion: 'success' }] },
    build: {
      sourceTreeMatched: true,
      compilerProvenanceChecked: true,
      compilerGuestExecuted: true,
      aotArtifactExecuted: true,
      noJitFallback: true,
      retentionInspected: true,
      targetTriple: 'x86_64-linux-gnu',
      compilerInvocation: '/pinned/atto-compiler /source/file.ores',
      executionInvocation: '/pinned/build/atto-guest',
      provenanceUrl: 'https://github.com/example/actions/runs/1'
    },
    results: manifest.cases.map(c => ({
      id: c.id,
      result: 'PASS',
      stage: {
        'compile-and-run': 'guest-aot',
        'runtime-deny': 'guest-aot',
        'compile-reject': 'compiler-rejection',
        'artifact-inspection': 'artifact-audit',
        'build-metadata': 'build-audit'
      }[c.kind],
      fixtureSha256: digest,
      witnesses: [...c.mustProve],
      ...(c.kind === 'compile-reject' ? { noOutputArtifact: true } : {}),
      ...(c.kind === 'runtime-deny' ? { denialObserved: true } : {}),
      ...(c.kind === 'artifact-inspection' ? { inspectionSha256: digest } : {}),
      ...(c.kind === 'build-metadata' ? { comparisonSha256: digest } : {})
    }))
  };
}

test('32 unique AOT oracles cover all five target backends and remain NOT_EXECUTED', () => {
  assert.deepEqual(verifyManifest(manifest), []);
  assert.equal(manifest.cases.length, 32);
  assert.deepEqual([...new Set(manifest.cases.map(c => c.kind))].sort(), [
    'artifact-inspection', 'build-metadata', 'compile-and-run', 'compile-reject', 'runtime-deny'
  ]);
});

test('even a complete self-declared receipt is never authenticated or promoted', () => {
  assert.deepEqual(verifyReceipt(manifest, candidateClaim()), {
    classification: 'SHAPE_VALID_UNATTESTED', errors: []
  });
});

test('zero-step workflow and runner admission failure reject', () => {
  const claim = candidateClaim();
  claim.job.runnerId = 0;
  claim.job.steps = [];
  const result = verifyReceipt(manifest, claim);
  assert.equal(result.classification, 'INVALID');
  assert.ok(result.errors.some(x => x.includes('runner')));
  assert.ok(result.errors.some(x => x.includes('stepful')));
});

test('steps=null is not execution', () => {
  const claim = candidateClaim();
  claim.job.steps = null;
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});

test('host-only primitive is not native guest proof', () => {
  const claim = candidateClaim();
  claim.build.compilerGuestExecuted = false;
  claim.build.aotArtifactExecuted = false;
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});

test('JIT fallback and unverified compiler provenance reject', () => {
  const claim = candidateClaim();
  claim.build.noJitFallback = false;
  claim.build.compilerProvenanceChecked = false;
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});

test('a missing case and a duplicate case are refused', () => {
  const missing = candidateClaim();
  missing.results.pop();
  assert.equal(verifyReceipt(manifest, missing).classification, 'INVALID');
  const duplicate = candidateClaim();
  duplicate.results[0] = { ...duplicate.results[1] };
  assert.equal(verifyReceipt(manifest, duplicate).classification, 'INVALID');
});

test('forged runtime denial and missing source witnesses reject', () => {
  const claim = candidateClaim();
  const denial = claim.results.find(x => x.id === 'tenant.foreign_denied');
  denial.denialObserved = false;
  denial.witnesses = [];
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});

test('compile rejection without proof of no artifact rejects', () => {
  const claim = candidateClaim();
  claim.results.find(x => x.id === 'runtime_eval.forbidden').noOutputArtifact = false;
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});

test('binary inspection and deterministic build require independent artifact digests', () => {
  const claim = candidateClaim();
  claim.results.find(x => x.id === 'retention.unused_stripped').inspectionSha256 = '';
  claim.results.find(x => x.id === 'metadata.deterministic').comparisonSha256 = '';
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});

test('malformed hashes and alien backends reject', () => {
  const claim = candidateClaim();
  claim.backend = 'js';
  claim.artifactSha256 = 'invalid';
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});

test('contract must not prelabel unexecuted oracles as passing', () => {
  const changed = structuredClone(manifest);
  changed.cases[0].evidence = 'PASS';
  assert.ok(verifyManifest(changed).some(x => x.includes('fabricated')));
});

test('missing compiler invocation or independent review fails closed', () => {
  const claim = candidateClaim();
  claim.build.compilerInvocation = '';
  claim.reviewUrl = '';
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});
