import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const contractUrl = new URL('../contracts/actor-stack-containment-v1.json', import.meta.url);
const expectedBackends = ['forge', 'java', 'llvm', 'net', 'wasm'];
const evidenceKeys = [
  'admission', 'compilerGuest', 'actorSurvival',
  'nativeLowStack', 'supervisorRecovery',
  'actorStackStorage', 'suspendedFrameOwnership', 'actorStackGeneration',
  'executionContextBinding', 'callbackResumptionSafety', 'taskRootRetirement',\n  'suspendedCallFrameState'
];

async function load() {
  return JSON.parse(await readFile(contractUrl, 'utf8'));
}

// Fail closed until actual exact-head provenance, stepful jobs and compiler
// guest executions are independently verified. A manifest cannot self-certify.
function validatePending(matrix) {
  assert.equal(matrix.schemaVersion, 1);
  assert.equal(matrix.id, 'actor-stack-containment-v1');
  assert.equal(matrix.language, 'AttoLang');
  assert.equal(matrix.canonicalExtension, '.atto');
  assert.deepEqual(matrix.backends.map(item => item.id).sort(), expectedBackends);
  assert.equal(matrix.promotion.certified, false);
  assert.equal(matrix.promotion.zeroStepCountsAsExecuted, false);
  assert.equal(matrix.promotion.sourceFreeCanaryCountsAsGuest, false);
  for (const backend of matrix.backends) {
    assert.equal(backend.exactHeadReceipt, null);
    for (const key of evidenceKeys) {
      assert.equal(backend[key], 'NOT_EXECUTED',
        'cannot claim ' + backend.id + '.' + key + ' without receipt');
    }
  }
  for (const key of [
    'perActorFrameAndByteQuotas',
    'actorFrameStorageIndependentOfCarrier',
    'suspendedContinuationFramesChargedToActor',
    'actorStackGenerationFenced',
    'actorStackPoisonCannotBeGuestCaught',
    'carrierMigrationDoesNotMoveStackOwnership',
    'stackFailureBeforeNativeGuardPage',
    'noNativeSignalOrStackOverflowRecovery',
    'executionContextStableAcrossAwait',
    'actorTaskRootGenerationAuthenticated',
    'callbacksCannotExecuteGuestOnProducerThread',
    'sourceTaskRootsRetiredOnlyAfterPhysicalQuiescence',
    'outstandingTaskRootsPreventActorHeapRetirement',\n    'suspendedCallFramesPreservePcOperandsAndLocals'
  ]) {
    assert.equal(matrix.requirements[key], true,
      'mandatory physical actor-stack safety property: ' + key);
  }
  assert.equal(matrix.requirements.nativeStackOverflowRecoverableOnSharedCarrier, false);
  assert.equal(matrix.requirements.untrustedArbitraryNativeCodeRequiresKillableWorker, true);
  assert.ok(matrix.scenarios.length >= 12);
  const ids = matrix.scenarios.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const scenario of matrix.scenarios) {
    assert.ok(scenario.requiredEvidence.length > 0);
    for (const key of scenario.requiredEvidence) assert.ok(evidenceKeys.includes(key));
    if (scenario.source !== null) {
      assert.match(scenario.source, /^fixtures\/actor-stack-containment-v1\/[\w-]+\.atto$/);
    } else {
      assert.ok(scenario.kind.startsWith('pending-'));
    }
  }
  return matrix;
}

test('five-backend stack containment contract stays explicitly unexecuted', async () => {
  validatePending(await load());
});

test('all authored AttoLang source fixtures exist and have distinct cases', async () => {
  const matrix = validatePending(await load());
  const sources = matrix.scenarios.filter(c => c.source);
  assert.equal(sources.length, 4);
  for (const scenario of sources) {
    const text = await readFile(new URL('../' + scenario.source, import.meta.url), 'utf8');
    assert.match(text, /pub routine main\(\): void/);
    assert.ok(text.length > 40);
  }
});

test('fake pass, duplicate backend, deleted proof and false promotion are rejected', async () => {
  const original = validatePending(await load());
  const mutate = fn => { const changed = structuredClone(original); fn(changed); return changed; };
  assert.throws(() => validatePending(mutate(m => {m.promotion.certified = true;})));
  assert.throws(() => validatePending(mutate(m => {m.backends[0].compilerGuest = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.backends[0].id = m.backends[1].id;})));
  assert.throws(() => validatePending(mutate(m => {delete m.backends[0].nativeLowStack;})));
  assert.throws(() => validatePending(mutate(m => {m.promotion.zeroStepCountsAsExecuted = true;})));
  assert.throws(() => validatePending(mutate(m => {m.scenarios[0].source = 'fixtures/legacy.ores';})));
  assert.throws(() => validatePending(mutate(m => {m.scenarios[4].kind = 'positive';})));
  assert.throws(() => validatePending(mutate(m => {m.backends[0].actorStackStorage = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {delete m.backends[1].suspendedFrameOwnership;})));
  assert.throws(() => validatePending(mutate(m => {m.requirements.actorFrameStorageIndependentOfCarrier = false;})));
  assert.throws(() => validatePending(mutate(m => {m.requirements.actorStackGenerationFenced = false;})));
  assert.throws(() => validatePending(mutate(m => {m.backends[2].callbackResumptionSafety = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {delete m.backends[3].taskRootRetirement;})));
  assert.throws(() => validatePending(mutate(m => {m.requirements.callbacksCannotExecuteGuestOnProducerThread = false;})));
  assert.throws(() => validatePending(mutate(m => {m.requirements.outstandingTaskRootsPreventActorHeapRetirement = false;})));
});

test('logical guard is not misrepresented as independent actor stack storage', async () => {
  const matrix = validatePending(await load());
  assert.match(matrix.javaLogicalStackReference, /\/pull\/2624$/);
  assert.match(matrix.note, /NOT independently allocated execution frames/);
  const required = new Set([
    'independent-actor-stack-quotas',
    'suspend-resume-carrier-migration',
    'stale-actor-incarnation-stack-fence',
    'host-swallowed-budget-exhaustion',
    'native-low-stack-interoperability'
  ]);
  for (const scenario of matrix.scenarios) {
    if (!required.has(scenario.id)) continue;
    required.delete(scenario.id);
    assert.equal(scenario.source, null, 'not yet an executable .atto actor fixture');
    assert.ok(scenario.requiredEvidence.some(key =>
      ['actorStackStorage', 'suspendedFrameOwnership', 'actorStackGeneration'].includes(key)));
  }
  assert.deepEqual([...required], [], 'all pending safety dimensions stay represented');
});

test('actor ExecutionContext, callback, and stack-root lifecycle gates cannot be lost', async () => {
  const matrix = validatePending(await load());
  assert.match(matrix.javaActorTaskBindingReference, /\/pull\/2626$/);
  const required = new Map([
    ['actor-await-sibling-then-resume', 'executionContextBinding'],
    ['producer-callback-cannot-run-guest', 'callbackResumptionSafety'],
    ['cancel-suspended-task-before-quiescence', 'taskRootRetirement'],
    ['late-resume-after-supervisor-restart', 'actorStackGeneration'],
    ['root-leak-must-block-actor-heap-reclaim', 'taskRootRetirement']
  ]);
  for (const scenario of matrix.scenarios) {
    const evidence = required.get(scenario.id);
    if (!evidence) continue;
    assert.equal(scenario.source, null,
      'compiler-backed .atto actor acceptance source is still pending');
    assert.ok(scenario.requiredEvidence.includes(evidence));
    required.delete(scenario.id);
  }
  assert.deepEqual([...required.keys()], []);
});


test('suspended scalar call-frame state is a mandatory pending five-backend gate', async () => {
  const matrix = validatePending(await load());
  const required = new Map([
    ['await-inside-nontail-call-preserves-parent-frame', 'suspendedCallFrameState'],
    ['cancel-inside-nontail-call-runs-cleanup-before-retire', 'suspendedCallFrameState'],
    ['duplicate-resume-cannot-reenter-suspended-call-frame', 'suspendedCallFrameState'],
    ['stale-parent-return-pc-rejected-after-generation-change', 'suspendedCallFrameState']
  ]);
  for (const scenario of matrix.scenarios) {
    const evidence = required.get(scenario.id);
    if (!evidence) continue;
    assert.equal(scenario.source, null,
      'the compiler-backed .atto suspension fixtures are still pending');
    assert.ok(scenario.requiredEvidence.includes(evidence));
    required.delete(scenario.id);
  }
  assert.deepEqual([...required.keys()], []);
  for (const backend of matrix.backends) {
    assert.equal(backend.suspendedCallFrameState, 'NOT_EXECUTED',
      'no backend may claim suspension inside CALL/RET frames without receipts');
  }
});
