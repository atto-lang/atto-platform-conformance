import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyManifest, verifyReceipt } from '../bin/verify-aot-reflection-receipt.mjs';

const manifest = JSON.parse(readFileSync(new URL('../contracts/aot-reflection-v1.json', import.meta.url), 'utf8'));
const gitSha = 'a'.repeat(40);
const digest = 'b'.repeat(64);

function candidateClaim() {
  return {
    contract: manifest.contract,
    backend: 'java',
    status: 'native-aot-claim',
    scope: 'complete',
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
      ...(c.kind === 'compile-reject' ?
        { noOutputArtifact: true, compilerExitCode: 1, diagnosticClass: 'unsupported_aot_reflection' } : {}),
      ...(c.kind === 'runtime-deny' ? { denialObserved: true } : {}),
      ...(c.kind === 'artifact-inspection' ?
        { inspectionSha256: digest, inspectedArtifactSha256: digest } : {}),
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

test('milestone can prove a strict subset without laundering full parity', () => {
  const claim = candidateClaim();
  claim.scope = 'milestone';
  claim.milestoneId = 'type-of-bootstrap';
  claim.results = claim.results.filter(x => ['type_of.closed_nominal', 'aot.native_execution'].includes(x.id));
  assert.deepEqual(verifyReceipt(manifest, claim), {
    classification: 'MILESTONE_SHAPE_VALID_UNATTESTED', errors: []
  });
});

test('milestone without a real guest oracle cannot pass even structural validation', () => {
  const claim = candidateClaim();
  claim.scope = 'milestone';
  claim.milestoneId = 'negative-only';
  claim.results = claim.results.filter(x => x.id === 'runtime_eval.forbidden');
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});

test('unknown milestone and omitted milestone identity fail closed', () => {
  const claim = candidateClaim();
  claim.scope = 'external';
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
  claim.scope = 'milestone';
  claim.results = claim.results.slice(0, 1);
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});

test('compiler rejection requires exit 1 and stable diagnostic', () => {
  const claim = candidateClaim();
  const entry = claim.results.find(x => x.id === 'runtime_eval.forbidden');
  entry.compilerExitCode = 127;
  entry.diagnosticClass = '';
  const r = verifyReceipt(manifest, claim);
  assert.equal(r.classification, 'INVALID');
  assert.ok(r.errors.some(x => x.includes('stable compiler rejection')));
});

test('artifact inspection must bind to the artifact actually claimed', () => {
  const claim = candidateClaim();
  claim.results.find(x => x.id === 'retention.unused_stripped').inspectedArtifactSha256 = 'c'.repeat(64);
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});

test('CLI never returns successful native-proof exit code without explicit lint-only mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atto-reflection-receipt-'));
  try {
    const path = join(dir, 'receipt.json');
    writeFileSync(path, JSON.stringify(candidateClaim()));
    const cmd = new URL('../bin/verify-aot-reflection-receipt.mjs', import.meta.url);
    const checked = spawnSync(process.execPath, [cmd.pathname, path], { encoding: 'utf8' });
    assert.equal(checked.status, 1, checked.stderr);
    assert.match(checked.stdout, /SHAPE_VALID_UNATTESTED/);
    const lint = spawnSync(process.execPath, [cmd.pathname, path, '--lint-only'], { encoding: 'utf8' });
    assert.equal(lint.status, 0, lint.stderr + lint.stdout);
    assert.match(lint.stdout, /SHAPE_VALID_UNATTESTED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test('receipt scope must be explicit rather than implicitly full parity', () => {
  const claim = candidateClaim();
  delete claim.scope;
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});

test('null and primitive case results cannot crash the verifier', () => {
  for (const malformed of [null, 17, 'forged', []]) {
    const claim = candidateClaim();
    claim.results[0] = malformed;
    const actual = verifyReceipt(manifest, claim);
    assert.equal(actual.classification, 'INVALID');
  }
});

test('case-level backend substitution fails closed', () => {
  const claim = candidateClaim();
  claim.results[0].backend = 'llvm';
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});

test('malformed job and build envelopes fail without throwing', () => {
  for (const malformed of [null, [], 'forged']) {
    const claim = candidateClaim();
    claim.job = malformed;
    claim.build = malformed;
    assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
  }
});

test('optional manifest digest when supplied must be SHA256-shaped', () => {
  const claim = candidateClaim();
  claim.manifestSha256 = 'unverified';
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});

test('invalid and null manifests return INVALID instead of throwing', () => {
  for (const invalid of [null, [], 'malformed']) {
    assert.equal(verifyReceipt(invalid, candidateClaim()).classification, 'INVALID');
  }
});

test('invalid oracle entries fail validation without a crash', () => {
  for (const invalid of [null, 10, 'forged', []]) {
    const candidate = structuredClone(manifest);
    candidate.cases[0] = invalid;
    assert.equal(verifyReceipt(candidate, candidateClaim()).classification, 'INVALID');
  }
});

test('null and primitive workflow steps are rejected without throwing', () => {
  for (const invalid of [null, 7, 'forged', []]) {
    const candidate = candidateClaim();
    candidate.job.steps.push(invalid);
    assert.equal(verifyReceipt(manifest, candidate).classification, 'INVALID');
  }
});


test('unexpected manifest backend cannot mint a new parity lane', () => {
  const candidate = structuredClone(manifest);
  candidate.backends.unreviewed = 'unreviewed backend';
  assert.ok(verifyManifest(candidate).some(x => x.includes('exact backend')));
  const claim = candidateClaim();
  claim.backend = 'unreviewed';
  assert.equal(verifyReceipt(candidate, claim).classification, 'INVALID');
});

test('replacing a required security oracle with another ID is forbidden', () => {
  const candidate = structuredClone(manifest);
  candidate.cases.find(c => c.id === 'tenant.foreign_denied').id = 'tenant.synthetic_pass';
  const errors = verifyManifest(candidate);
  assert.ok(errors.some(x => x.includes('unknown or remapped canonical oracle')));
  assert.ok(errors.some(x => x.includes('missing canonical oracle')));
  assert.equal(verifyReceipt(candidate, candidateClaim()).classification, 'INVALID');
});

test('an existing oracle ID cannot silently change its required kind', () => {
  const candidate = structuredClone(manifest);
  candidate.cases.find(c => c.id === 'runtime_eval.forbidden').kind = 'compile-and-run';
  assert.ok(verifyManifest(candidate).some(x => x.includes('remapped canonical oracle')));
});

test('witness schema disallows non-string and malformed proof names', () => {
  for (const malformed of [null, 42, {}, 'x', 'not a stable witness name']) {
    const candidate = structuredClone(manifest);
    candidate.cases[0].mustProve = [malformed];
    assert.ok(verifyManifest(candidate).some(x => x.includes('invalid witness set')));
  }
});

test('backend set must be an exact map with nonblank descriptions', () => {
  for (const invalid of [null, [], { ...manifest.backends, wasm: ' ' }]) {
    const candidate = structuredClone(manifest);
    candidate.backends = invalid;
    assert.ok(verifyManifest(candidate).some(x => x.includes('backend')));
  }
});

test('canonical witness substitution cannot weaken tenant or ownership negatives', () => {
  for (const id of ['tenant.foreign_denied', 'actor_state.unauthorized', 'field_reference.no_escape']) {
    const candidate = structuredClone(manifest);
    const item = candidate.cases.find(c => c.id === id);
    item.mustProve = ['synthetic-noop'];
    assert.ok(verifyManifest(candidate).some(x => x.includes('canonical oracle witnesses changed')));
    assert.equal(verifyReceipt(candidate, candidateClaim()).classification, 'INVALID');
  }
});

test('milestone cannot be satisfied by runtime denials without native execution', () => {
  const claim = candidateClaim();
  claim.scope = 'milestone';
  claim.milestoneId = 'denial-only';
  claim.results = claim.results.filter(x => x.id === 'tenant.foreign_denied');
  const verified = verifyReceipt(manifest, claim);
  assert.equal(verified.classification, 'INVALID');
  assert.ok(verified.errors.some(x => x.includes('native execution')));
});

test('milestone cannot claim only the native-execution oracle without a feature', () => {
  const claim = candidateClaim();
  claim.scope = 'milestone';
  claim.milestoneId = 'execution-no-feature';
  claim.results = claim.results.filter(x => x.id === 'aot.native_execution');
  const verified = verifyReceipt(manifest, claim);
  assert.equal(verified.classification, 'INVALID');
  assert.ok(verified.errors.some(x => x.includes('positive compiled feature')));
});

test('positive feature without native execution cannot claim a milestone', () => {
  const claim = candidateClaim();
  claim.scope = 'milestone';
  claim.milestoneId = 'feature-without-native';
  claim.results = claim.results.filter(x => x.id === 'type_of.closed_nominal');
  assert.equal(verifyReceipt(manifest, claim).classification, 'INVALID');
});
