import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const contractUrl = new URL('../contracts/actor-stack-containment-v1.json', import.meta.url);
const expectedBackends = ['forge', 'java', 'llvm', 'net', 'wasm'];
const evidenceKeys = [
  'admission', 'compilerGuest', 'actorSurvival',
  'nativeLowStack', 'supervisorRecovery',
  'actorStackStorage', 'suspendedFrameOwnership', 'actorStackGeneration'
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
    'guardedSynchronousInvocationChargedToActorFrameArena'
  ]) {
    assert.equal(matrix.requirements[key], true,
      'mandatory physical actor-stack safety property: ' + key);
  }
  assert.equal(matrix.requirements.nativeStackOverflowRecoverableOnSharedCarrier, false);
  assert.equal(matrix.requirements.untrustedArbitraryNativeCodeRequiresKillableWorker, true);
  assert.ok(matrix.scenarios.length >= 30);
  assert.match(matrix.javaFrameArenaReference, /\/pull\/2627$/);
  const bootstrap = matrix.frameStorageBootstrap;
  assert.equal(bootstrap.javaHostPrimitive, 'MANAGED_BYTES_ONLY');
  assert.match(bootstrap.javaIntegratedInvocationSourceTaskReference, /\/pull\/2637$/);
  assert.equal(bootstrap.javaIntegratedSourceTaskInvocationStatus, 'AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaIntegratedSourceTaskHostTestsAuthored, 3);
  assert.equal(bootstrap.javaIntegratedActorAttoFixturesCopied, 3);
  assert.equal(bootstrap.javaIntegratedActorAttoCompilerReceipts, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaIntegratedActorNativeStackIsolation, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaQuiescenceCallbackBeforeFrameRetirement, true);
  assert.equal(bootstrap.javaInvocationReusesSourceTaskExecutionId, true);
  assert.match(bootstrap.javaActorSourceTaskReference, /\/pull\/2631$/);
  assert.equal(bootstrap.javaActorSourceTaskFrameBytes, 64);
  assert.equal(bootstrap.javaActorSourceTaskHostTestsAuthored, 8);
  assert.equal(bootstrap.javaActorSourceTaskLease,
    'HOST_SCHEDULER_AWAIT_LEASE_AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaActorSourceTaskCompilerFrames, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaActorSourceTaskNativeStackIsolation, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaActorSourceTaskPhysicalRetirement,
    'HOST_RUNTIME_AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaAuthoredHostTests, 20);
  assert.match(bootstrap.javaInvocationDescriptorReference, /\/pull\/2628$/);
  assert.equal(bootstrap.javaInvocationDescriptorStatus, 'AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaInvocationDescriptorBytes, 16);
  assert.equal(bootstrap.javaSynchronousGuardByteCharge, 32);
  assert.equal(bootstrap.javaGuardFrameNotDuplicated, true);
  assert.equal(bootstrap.javaNewHostInvocationTestsAuthored, 5);
  assert.equal(bootstrap.javaNewAttoActorFixturesAuthored, 3);
  assert.equal(bootstrap.javaNewAttoActorExecution, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaAuthoredLegacyCompilerGuestTests, 1);
  assert.equal(bootstrap.javaLegacyCompilerGuestTestExecuted, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaGuardedInvocationByteFrames,
    'GUARD_WIRED_MANAGED_BYTES_NOT_GUEST_LOCALS');
  assert.equal(bootstrap.javaSynchronousGuardByteCharge, 32);
  assert.equal(bootstrap.javaGuestCallGuardNativeStackStillUsed, true);
  assert.equal(bootstrap.javaLocalIsolatedSmokeAssertions, 19);
  assert.equal(bootstrap.promotionFromHostOnlyAllowed, false);
  for (const dimension of [
    'compilerLoweredGuestFrames', 'suspendedSourceTaskFrames',
    'realNativeStackIsolation', 'nativeAotExecution'
  ]) {
    assert.equal(bootstrap[dimension], 'NOT_EXECUTED',
      'host frame primitive does not prove ' + dimension);
  }
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
  assert.equal(sources.length, 7);
  for (const scenario of sources) {
    const text = await readFile(new URL('../' + scenario.source, import.meta.url), 'utf8');
    assert.match(text, /pub (?:suspends )?routine main\(\): void/);
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
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.compilerLoweredGuestFrames = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.realNativeStackIsolation = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.promotionFromHostOnlyAllowed = true;})));
  assert.throws(() => validatePending(mutate(m => {delete m.frameStorageBootstrap.suspendedSourceTaskFrames;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaHostPrimitive = 'NATIVE_STACK_ISOLATED';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaLegacyCompilerGuestTestExecuted = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {delete m.frameStorageBootstrap.javaAuthoredLegacyCompilerGuestTests;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaGuardedInvocationByteFrames = 'COMPILER_LOCALS_SWITCHED';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaGuestCallGuardNativeStackStillUsed = false;})));
  assert.throws(() => validatePending(mutate(m => {m.requirements.guardedSynchronousInvocationChargedToActorFrameArena = false;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaInvocationDescriptorStatus = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaNewAttoActorExecution = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaGuardFrameNotDuplicated = false;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaInvocationDescriptorBytes = 32;})));
});

test('logical guard is not misrepresented as independent actor stack storage', async () => {
  const matrix = validatePending(await load());
  assert.match(matrix.javaLogicalStackReference, /\/pull\/2624$/);
  assert.match(matrix.note, /None proves compiler-lowered actor stacks/);
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

test('frame byte quotas and generation tests cannot be claimed by authored host models', async () => {
  const matrix = validatePending(await load());
  assert.match(matrix.note, /None proves compiler-lowered actor stacks/);
  const required = new Map([
    ['bounded-actor-frame-bytes', 'actorStackStorage'],
    ['foreign-frame-handle-rejected', 'actorStackGeneration'],
    ['suspended-frame-byte-quotas-retained', 'suspendedFrameOwnership'],
    ['cancelled-frame-zeroize-and-no-double-free', 'suspendedFrameOwnership'],
    ['stale-post-retirement-resume-reject', 'actorStackGeneration']
  ]);
  for (const scenario of matrix.scenarios) {
    if (!required.has(scenario.id)) continue;
    assert.equal(scenario.source, null, 'no fake compiled .atto actor fixture');
    assert.ok(scenario.requiredEvidence.includes(required.get(scenario.id)));
    required.delete(scenario.id);
  }
  assert.deepEqual([...required.keys()], [], 'all required physical frame cases are inventoried');
});

test('guard-linked managed bytes cannot certify compiler-lowered execution frames', async () => {
  const matrix = validatePending(await load());
  const caseName = 'synchronous-guest-guard-byte-reservations';
  const scenario = matrix.scenarios.find(c => c.id === caseName);
  assert.ok(scenario, 'explicit pending guard-to-frame compiler proof');
  assert.equal(scenario.source, null, 'no invented actor .atto execution fixture');
  assert.equal(scenario.kind, 'pending-actor-acceptance');
  assert.ok(scenario.requiredEvidence.includes('compilerGuest'));
  assert.ok(scenario.requiredEvidence.includes('actorStackStorage'));
  assert.equal(matrix.backends.find(b => b.id === 'java').actorStackStorage, 'NOT_EXECUTED');
  assert.equal(matrix.frameStorageBootstrap.compilerLoweredGuestFrames, 'NOT_EXECUTED');
  assert.equal(matrix.frameStorageBootstrap.suspendedSourceTaskFrames, 'NOT_EXECUTED');
  assert.equal(matrix.promotion.certified, false);
});

test('M2 invocation-frame wiring stays pending real actor source execution', async () => {
  const manifest = validatePending(await load());
  const scenario = manifest.scenarios.find(s => s.id === 'evaluator-descriptor-non-tail-and-tail');
  assert.ok(scenario, 'actual source actor call-descriptor proof remains an open requirement');
  assert.equal(scenario.source, null,
    'conformance fixtures cannot pretend the separate Java compiler has executed');
  assert.ok(scenario.requiredEvidence.includes('compilerGuest'));
  assert.ok(scenario.requiredEvidence.includes('actorStackStorage'));
  for (const backend of manifest.backends) {
    assert.equal(backend.compilerGuest, 'NOT_EXECUTED');
    assert.equal(backend.actorStackStorage, 'NOT_EXECUTED');
  }
});

test('source task host-frame leases cannot claim compiler-lowered guest resumes', async () => {
  const original = validatePending(await load());
  const mutate = fn => { const changed = structuredClone(original); fn(changed); return changed; };
  assert.throws(() => validatePending(mutate(
    m => {m.frameStorageBootstrap.javaActorSourceTaskCompilerFrames = 'PASS';})));
  assert.throws(() => validatePending(mutate(
    m => {m.frameStorageBootstrap.javaActorSourceTaskNativeStackIsolation = 'PASS';})));
  assert.throws(() => validatePending(mutate(
    m => {m.frameStorageBootstrap.javaActorSourceTaskFrameBytes = 0;})));
  assert.throws(() => validatePending(mutate(
    m => {m.frameStorageBootstrap.javaActorSourceTaskHostTestsAuthored = 999;})));
  const required = [
    'actor-source-await-retains-charged-frame',
    'actor-source-cooperate-preserves-frame-across-dispatch',
    'actor-source-two-suspended-tasks-independent',
    'actor-source-cancel-physical-quiescence-zeroizes',
    'actor-source-wrong-carrier-and-generation-rejected'
  ];
  for (const id of required) {
    const scenario = original.scenarios.find(s => s.id === id);
    assert.ok(scenario, 'source task scenario must be inventoried: ' + id);
    assert.equal(scenario.source, null, 'no invented compiled .atto actor test result');
    assert.ok(scenario.requiredEvidence.includes('compilerGuest'));
    assert.ok(scenario.requiredEvidence.includes('suspendedFrameOwnership'));
  }
  assert.equal(original.promotion.certified, false);
});

test('integrated actor invocation and SourceTask proof cannot be self-certified', async () => {
  const original = validatePending(await load());
  const mutate = fn => { const modified = structuredClone(original); fn(modified); return modified; };
  assert.throws(() => validatePending(mutate(m => {
    m.frameStorageBootstrap.javaIntegratedActorAttoCompilerReceipts = 'PASS';
  })));
  assert.throws(() => validatePending(mutate(m => {
    m.frameStorageBootstrap.javaIntegratedActorNativeStackIsolation = 'PASS';
  })));
  assert.throws(() => validatePending(mutate(m => {
    m.frameStorageBootstrap.javaInvocationReusesSourceTaskExecutionId = false;
  })));
  assert.throws(() => validatePending(mutate(m => {
    m.frameStorageBootstrap.javaQuiescenceCallbackBeforeFrameRetirement = false;
  })));
  assert.throws(() => validatePending(mutate(m => {
    m.frameStorageBootstrap.javaIntegratedActorAttoFixturesCopied = 0;
  })));
  const authored = [
    ['source-actor-non-tail-frames', '8'],
    ['source-actor-tail-frames', '100000'],
    ['source-actor-sibling-after-budget', 'starting|alive']
  ];
  for (const [name, stdout] of authored) {
    const scenario = original.scenarios.find(s => s.id === name);
    assert.ok(scenario);
    assert.equal(scenario.expectedStdout, stdout);
    assert.match(scenario.source, /^fixtures\/actor-stack-containment-v1\/.*\.atto$/);
    assert.ok(scenario.requiredEvidence.includes('compilerGuest'));
  }
  for (const name of [
    'source-task-invocation-same-execution-id',
    'source-task-quiescence-callback-retains-frames',
    'source-task-invocation-overflow-sibling-survival'
  ]) {
    const scenario = original.scenarios.find(s => s.id === name);
    assert.ok(scenario);
    assert.equal(scenario.source, null);
    assert.equal(scenario.kind, 'pending-actor-acceptance');
  }
  assert.equal(original.promotion.certified, false);
});
