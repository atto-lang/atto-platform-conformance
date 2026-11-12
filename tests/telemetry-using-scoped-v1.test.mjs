import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Source/contract integrity ONLY. Neither a Node test nor this checker can
// certify AttoLang guest compilation, span lifecycle or cross-backend parity.
const root = new URL('../', import.meta.url);
const contract = JSON.parse(
  readFileSync(new URL('contracts/telemetry-using-scoped-v1.json', root), 'utf8')
);

function source(fixture) {
  const relative = fixture.path;
  if (!/^fixtures\/telemetry-using-v1\/using-span-[a-z-]+\.atto$/.test(relative)) {
    throw new Error('invalid fixture path');
  }
  const bytes = readFileSync(new URL(relative, root));
  const blob = createHash('sha1').update(
    Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
  assert.equal(blob, fixture.gitBlobSha1, 'unexpected source blob ' + relative);
  return bytes.toString('utf8');
}

test('source-owned six-fixture snapshot is immutable and non-promotable', () => {
  assert.equal(contract.contract, 'telemetry-using-scoped-v1');
  assert.equal(contract.status, 'candidate-unattested');
  assert.equal(contract.executionEvidence.status, 'NOT_EXECUTED');
  assert.deepEqual(contract.executionEvidence.verifiedRuns, []);
  assert.equal(contract.fixtures.length, 6);
  assert.equal(new Set(contract.fixtures.map(f => f.path)).size, 6);
  assert.equal(contract.acceptance.requiresCompilerBackedGuest, true);
  assert.equal(contract.acceptance.requiresExecutedSteps, true);
  assert.equal(contract.acceptance.requiresExactHeadShaTree, true);
  assert.equal(contract.acceptance.hostOnlyReferenceTestsSufficient, false);
  assert.equal(contract.acceptance.sourceOnlyTestsSufficient, false);
  assert.equal(contract.acceptance.zeroStepRunCountsAsExecuted, false);
  assert.equal(contract.acceptance.forbidSyntheticPromotion, true);
  for (const fixture of contract.fixtures) {
    assert.match(fixture.gitBlobSha1, /^[a-f0-9]{40}$/);
    assert.match(source(fixture), /using (telemetry|custom)\.span\(/);
  }
});

test('executed host smoke does not promote an unexecuted AttoLang guest', () => {
  const host = contract.hostSubstrateEvidence;
  assert.equal(host.status, 'HOST_ONLY_EXECUTED_LOCALLY_NOT_GUEST');
  assert.match(host.result, /^LOGICAL_TRACE_SCOPE_PASS assertions=29$/);
  assert.match(host.exactSourceBlob, /^[a-f0-9]{40}$/);
  assert.match(host.exactTestBlob, /^[a-f0-9]{40}$/);
  assert.ok(host.doesNotCover.includes('actual_guest_compilation'));
  assert.ok(host.doesNotCover.includes('jit_reinstrumentation'));
  assert.equal(contract.executionEvidence.status, 'NOT_EXECUTED');
  assert.deepEqual(contract.executionEvidence.verifiedRuns, []);
});

test('funded CI executes exact-source host and parser but never promotes guest evidence', () => {
  const result = contract.fundedHostValidation;
  assert.equal(result.status, 'PASS_EXECUTED_HOST_AND_PRODUCTION_PARSER_ONLY');
  assert.equal(result.workflowConclusion, 'success');
  assert.equal(result.executedSteps, 12);
  assert.match(result.sourceHead, /^[a-f0-9]{40}$/);
  assert.match(result.sourceTree, /^[a-f0-9]{40}$/);
  assert.match(result.fundedMirrorHead, /^[a-f0-9]{40}$/);
  assert.equal(result.noCrossOrgToken, true);
  assert.equal(result.noSecrets, true);
  assert.match(result.mirrorScope, /^11 exact source Git blobs, not/);
  assert.equal(result.runtime.repetitions * result.runtime.assertionsPerRun, 800);
  assert.equal(result.parser.repetitions * result.parser.assertionsPerRun, 112);
  assert.equal(result.negativeMutation.result, 'EXPECTED_ASSERTION_FAILURE_DETECTED');
  assert.equal(result.executionEvidenceGuestStill, 'NOT_EXECUTED');
  assert.equal(contract.executionEvidence.status, 'NOT_EXECUTED');
  assert.deepEqual(contract.executionEvidence.verifiedRuns, []);
});

test('GraalVM25 parser import/capture receipts remain strictly separate from guest evidence', () => {
  const run = contract.fundedImportParserValidation;
  assert.equal(run.status, 'PASS_EXECUTED_EXACT_SOURCE_PARSER_ONLY');
  assert.equal(run.graalVersion, '25.3');
  assert.equal(run.sourceBlobsVerified, 9);
  assert.equal(run.repetitions * run.assertionsPerRun, 405);
  assert.equal(run.totalAssertions, 405);
  assert.equal(run.guestExecutionStatus, 'NOT_EXECUTED');
  assert.equal(contract.executionEvidence.status, 'NOT_EXECUTED');
  assert.deepEqual(contract.executionEvidence.verifiedRuns, []);
  assert.match(run.negativeMutation, /EXPECTED_ASSERTION_FAILURE/);
  assert.match(contract.language.importRequirement, /ImportRules.validate rejects/);
  assert.match(contract.fixtures.find(f => f.path.endsWith('using-span-import.atto')).currentJava,
    /PARSER_ACCEPT_IMPORT_RULES_REJECT/);
});

test('scoped span semantics retain await ownership, negative alias and spoof rejection', () => {
  assert.equal(contract.language.maySuspend, true);
  assert.equal(contract.language.nonSendableSpan, true);
  assert.match(contract.language.stateLoans, /reject await/);
  const fixtures = new Map(contract.fixtures.map(f => [f.path.split('/').at(-1), f]));
  assert.equal(fixtures.get('using-span-invalid-alias.atto').future, 'PARSER_REJECT');
  assert.equal(fixtures.get('using-span-forged-resource.atto').future, 'TYPECHECK_REJECT');
  assert.match(source(fixtures.get('using-span-await.atto')), /await fs\.exists/);
  assert.match(source(fixtures.get('using-span-import.atto')), /use std\.telemetry as telemetry;/);
  assert.equal(contract.acceptance.requiresTrustedTelemetryModuleImport, true);
  assert.match(contract.language.importRequirement, /Parser currently only supports/);
  assert.match(source(fixtures.get('using-span-nested.atto')),
    /using telemetry\.span\("child"\) as inner/);
});

test('structural checks do not impersonate compiler or CI receipts', () => {
  const copy = structuredClone(contract);
  copy.executionEvidence.status = 'PASS';
  assert.notEqual(copy.executionEvidence.status, 'NOT_EXECUTED');
  // Any future receipt verifier must validate exact toolchain, SHA, actual
  // guest execution, nonzero steps and raw OTLP correlation before promotion.
  assert.equal(copy.acceptance.requiresRealGuestExitAndSpanReceipts, true);
  assert.equal(copy.acceptance.requiresAsyncCarrierMigrationEvidence, true);
});
