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
  assert.ok(matrix.scenarios.length >= 56);
  assert.match(matrix.javaFrameArenaReference, /\/pull\/2627$/);
  const bootstrap = matrix.frameStorageBootstrap;
  assert.equal(bootstrap.javaHostPrimitive, 'MANAGED_BYTES_ONLY');
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
  assert.match(bootstrap.javaTypedScalarFrameReference, /\/pull\/2630$/);
  assert.equal(bootstrap.javaTypedScalarCallData, 'AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaTypedScalarCodecTypes, 8);
  assert.equal(bootstrap.javaTypedScalarSlotBytes, 9);
  assert.equal(bootstrap.javaScalarCallFrameBytePolicy,
    'ONE_FRAME_MIN_32_PLUS_9_BYTES_PER_TYPED_ARGUMENT');
  assert.equal(bootstrap.javaTypedScalarHostTestsAuthored, 7);
  assert.equal(bootstrap.javaTypedScalarLegacyGuestTestsAuthored, 1);
  assert.equal(bootstrap.javaTypedScalarLegacyGuestExecution, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaTypedScalarObjectRootsLowered, false);
  assert.equal(bootstrap.javaTypedScalarReturnContinuationsLowered, false);
  assert.equal(bootstrap.javaTypedScalarTaskContinuationLowered, false);
  assert.equal(bootstrap.javaTypedScalarIndependentNativeStacks, false);
  assert.match(bootstrap.javaSourceTaskScalarIntegrationReference, /\/pull\/2638$/);
  assert.equal(bootstrap.javaSourceTaskScalarStatus,
    'HOST_RUNTIME_AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaSourceTaskScalarMaxValues, 6);
  assert.equal(bootstrap.javaSourceTaskScalarTagBytes, 9);
  assert.equal(bootstrap.javaSourceTaskScalarFrameBytes, 64);
  assert.equal(bootstrap.javaSourceTaskScalarHeaderBytes, 4);
  assert.equal(bootstrap.javaSourceTaskScalarIntegrationJUnitMethodsAuthored, 5);
  assert.equal(bootstrap.javaSourceTaskScalarAutoCompilerLowering, false);
  assert.equal(bootstrap.javaSourceTaskScalarTaskIdentityIsGenerationFenced, true);
  assert.equal(bootstrap.javaSourceTaskScalarRetainedAcrossSuspend,
    'AUTHORED_HOST_MODEL_NOT_EXECUTED');
  assert.equal(bootstrap.javaSourceTaskScalarCompiledAttoActorExecution, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaSourceTaskScalarSourceMailboxNonReentrancy, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaSourceTaskScalarNativeStackIsolation, 'NOT_EXECUTED');
  assert.match(bootstrap.javaCompilerScalarParameterReference, /\/pull\/2642$/);
  assert.equal(bootstrap.javaCompilerScalarParameterStatus, 'AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaCompilerScalarParameterGuestExecution, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaCompilerScalarParameterHostTestsAuthored, 3);
  assert.equal(bootstrap.javaCompilerScalarParameterAttoTestsAuthored, 1);
  assert.equal(bootstrap.javaCompilerScalarParameterMaxValues, 6);
  assert.equal(bootstrap.javaCompilerScalarParameterFromActorBytes, true);
  assert.equal(bootstrap.javaCompilerScalarParameterResumeIntegrity, 'AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaCompilerScalarParameterFrameBytes, 64);
  assert.equal(bootstrap.javaCompilerMutableLocalsLowered, false);
  assert.equal(bootstrap.javaCompilerReturnPcLowered, false);
  assert.equal(bootstrap.javaCompilerStacklessEvaluator, false);
  assert.equal(bootstrap.javaCompilerSourceMailboxNonReentrancy, 'NOT_EXECUTED');
  assert.match(bootstrap.javaCompilerLexicalFrameReference, /\/pull\/2643$/);
  assert.equal(bootstrap.javaCompilerLexicalStatus, 'AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaCompilerLexicalFrameBytes, 64);
  assert.equal(bootstrap.javaCompilerLexicalSharedScalarSlots, 6);
  assert.equal(bootstrap.javaCompilerLexicalHostJUnitAuthored, 6);
  assert.equal(bootstrap.javaCompilerLexicalAttoJUnitAuthored, 1);
  assert.equal(bootstrap.javaCompilerLexicalGuestExecution, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaCompilerLexicalReadsFromActorBytes, true);
  assert.equal(bootstrap.javaCompilerLexicalJvmShadowStillPresent, true);
  assert.equal(bootstrap.javaCompilerLexicalReferenceRootsLowered, false);
  assert.equal(bootstrap.javaCompilerLexicalFrameScopeReclaim, false);
  assert.match(bootstrap.javaCompilerReturnRecordReference, /\/pull\/2643$/);
  assert.equal(bootstrap.javaCompilerReturnRecordHostJUnitAuthored, 4);
  assert.equal(bootstrap.javaCompilerReturnRecordBytes, 48);
  assert.equal(bootstrap.javaCompilerReturnRecordAbiStatus, 'HOST_ABI_AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaCompilerReturnRecordUsedByGuestDispatcher, false);
  assert.equal(bootstrap.javaCompilerReturnPcLowered, false);
  assert.equal(bootstrap.javaCompilerStacklessEvaluator, false);
  assert.equal(bootstrap.javaCompilerNativeActorStackFaultSurvival, 'NOT_EXECUTED');
  assert.match(bootstrap.javaM32HardeningSourceReference, /\/pull\/2643$/);
  assert.match(bootstrap.javaM32HardeningFollowupReference, /\/pull\/2662$/);
  assert.equal(bootstrap.javaM32HardeningStatus, 'AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaM32PhysicalTurnIdentityFenced, true);
  assert.equal(bootstrap.javaM32SchedulerTaskIdentityFenced, true);
  assert.equal(bootstrap.javaM32JvmScalarShadowTaskCaptureAllowed, false);
  assert.equal(bootstrap.javaM32ShadowSnapshotEscapeGuard, 'COPY_AND_MOVE_DENIED');
  assert.equal(bootstrap.javaM32CorruptScalarPayloadHostTestExecuted, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaM32CorruptReturnDescriptorHostTestExecuted, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaM32NewHostJUnitMethodsAuthored, 11);
  assert.equal(bootstrap.javaM32NewHostJUnitMethodsExecuted, 0);
  assert.equal(bootstrap.javaM32HardenedGuestCompilerExecution, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaM32HardenedNativeStackIsolation, 'NOT_EXECUTED');
  assert.match(bootstrap.javaM33EnvSnapshotReference, /\/pull\/2665$/);
  assert.equal(bootstrap.javaM33EnvSnapshotStatus, 'AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaM33EnvSnapshotJUnitMethodsAuthored, 3);
  assert.equal(bootstrap.javaM33EnvSnapshotJUnitMethodsExecuted, 0);
  assert.equal(bootstrap.javaM33EnvSnapshotRetiredReadDenied, true);
  assert.equal(bootstrap.javaM33EnvSnapshotSameTaskAwaitAllowed, 'AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaM33EnvSnapshotCrossTaskReadDenied, true);
  assert.equal(bootstrap.javaM33EnvSnapshotCrossTaskArenaPoisonAllowed, false);
  assert.equal(bootstrap.javaM33EnvSnapshotExactExecutionIdentityFenced, true);
  assert.equal(bootstrap.javaM33EnvReflectionFixtureSignatureRepaired, true);
  assert.equal(bootstrap.javaM33EnvSnapshotCompiledAttoEvidence, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaM33EnvSnapshotActualCallbackParity, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaM33EnvSnapshotIterativeDispatcher, false);
  assert.equal(bootstrap.javaM33EnvSnapshotNativeStackProof, 'NOT_EXECUTED');
  assert.match(bootstrap.javaM33aIterativeSourceReference, /\/pull\/2667$/);
  assert.equal(bootstrap.javaM33aIterativeStatus, 'AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaM33aWholeGraphFailClosed, true);
  assert.equal(bootstrap.javaM33aScalarFnEnabled, true);
  assert.equal(bootstrap.javaM33aActualNonTailGuestDispatcher, 'AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaM33aScalarFrameHeaderBytes, 16);
  assert.equal(bootstrap.javaM33aTypedScalarSlotBytes, 9);
  assert.equal(bootstrap.javaM33aInstructionsPerSafepoint, 128);
  assert.equal(bootstrap.javaM33aHostJUnitAuthored, 33);
  assert.equal(bootstrap.javaM33aParserJUnitAuthored, 16);
  assert.equal(bootstrap.javaM33aAttoJUnitAuthored, 5);
  assert.equal(bootstrap.javaM33aJUnitExecuted, 0);
  assert.equal(bootstrap.javaM33aCompiledAttoGuestEvidence, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaM33aNonScalarJvmFallbackStillRecursive, true);
  assert.equal(bootstrap.javaM33aActorMethodsLowered, false);
  assert.equal(bootstrap.javaM33aClosuresLowered, false);
  assert.equal(bootstrap.javaM33aSuspendedGuestReturnPCsLowered, false);
  assert.equal(bootstrap.javaM33aGeneralReturnRecordAbiConnected, false);
  assert.equal(bootstrap.javaM33aNativeActorStackFaultProof, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaM33aLLVMGuest, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaM33aNETGuest, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaM33aWasmGuest, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaM33aForgeGuest, 'NOT_EXECUTED');
  assert.match(bootstrap.javaM33bSourceReference, /\/pull\/2668$/);
  assert.equal(bootstrap.javaM33bTypedAdmissionStatus, 'AUTHORED_NOT_EXECUTED');
  assert.equal(bootstrap.javaM33bExactPrimitiveKindsGuarded, true);
  assert.equal(bootstrap.javaM33bRebindOnlyExplicitLet, true);
  assert.equal(bootstrap.javaM33bImplicitJvmIntegerWideningAllowed, false);
  assert.equal(bootstrap.javaM33bMixedPrimitiveEqualityAllowed, false);
  assert.equal(bootstrap.javaM33bForgedOperandStackPointerFailsClosed, true);
  assert.equal(bootstrap.javaM33bActorRuntimeHostTestsAuthored, 38);
  assert.equal(bootstrap.javaM33bParserNegativeTestsAuthored, 32);
  assert.equal(bootstrap.javaM33bAttoGuestTestsAuthored, 5);
  assert.equal(bootstrap.javaM33bTotalJUnitTestsAuthored, 75);
  assert.equal(bootstrap.javaM33bJUnitTestsExecuted, 0);
  assert.equal(bootstrap.javaM33bTypedAttoGuestEvidence, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaM33bNativeStackFailureContainment, 'NOT_EXECUTED');
  assert.equal(bootstrap.javaM33bFiveBackendParity, 'NOT_EXECUTED');
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
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaTypedScalarCallData = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaTypedScalarLegacyGuestExecution = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {delete m.frameStorageBootstrap.javaTypedScalarFrameReference;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaTypedScalarObjectRootsLowered = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaTypedScalarReturnContinuationsLowered = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaTypedScalarTaskContinuationLowered = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaTypedScalarIndependentNativeStacks = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaSourceTaskScalarStatus = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaSourceTaskScalarCompiledAttoActorExecution = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaSourceTaskScalarSourceMailboxNonReentrancy = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaSourceTaskScalarNativeStackIsolation = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaSourceTaskScalarAutoCompilerLowering = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaSourceTaskScalarMaxValues = 999;})));
  assert.throws(() => validatePending(mutate(m => {delete m.frameStorageBootstrap.javaSourceTaskScalarIntegrationReference;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaSourceTaskScalarRetainedAcrossSuspend = 'VERIFIED';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerScalarParameterStatus = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerScalarParameterGuestExecution = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerScalarParameterMaxValues = 999;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerMutableLocalsLowered = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerReturnPcLowered = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerStacklessEvaluator = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerSourceMailboxNonReentrancy = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerLexicalStatus = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerLexicalSharedScalarSlots = 999;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerLexicalJvmShadowStillPresent = false;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerLexicalReferenceRootsLowered = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerLexicalFrameScopeReclaim = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerReturnRecordAbiStatus = 'GUEST_PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerReturnRecordUsedByGuestDispatcher = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerNativeActorStackFaultSurvival = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM32HardeningStatus = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM32JvmScalarShadowTaskCaptureAllowed = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM32PhysicalTurnIdentityFenced = false;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM32SchedulerTaskIdentityFenced = false;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM32NewHostJUnitMethodsExecuted = 11;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM32CorruptScalarPayloadHostTestExecuted = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM32CorruptReturnDescriptorHostTestExecuted = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM32HardenedGuestCompilerExecution = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM32HardenedNativeStackIsolation = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {delete m.frameStorageBootstrap.javaM32HardeningFollowupReference;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33EnvSnapshotStatus = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33EnvSnapshotJUnitMethodsExecuted = 3;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33EnvSnapshotCrossTaskReadDenied = false;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33EnvSnapshotCrossTaskArenaPoisonAllowed = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33EnvSnapshotExactExecutionIdentityFenced = false;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33EnvSnapshotRetiredReadDenied = false;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33EnvSnapshotCompiledAttoEvidence = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33EnvSnapshotActualCallbackParity = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33EnvSnapshotIterativeDispatcher = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33EnvSnapshotNativeStackProof = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {delete m.frameStorageBootstrap.javaM33EnvSnapshotReference;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aIterativeStatus = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aJUnitExecuted = 54;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aWholeGraphFailClosed = false;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aScalarFrameHeaderBytes = 0;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aInstructionsPerSafepoint = 1;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aNonScalarJvmFallbackStillRecursive = false;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aActualNonTailGuestDispatcher = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aCompiledAttoGuestEvidence = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aActorMethodsLowered = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aClosuresLowered = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aSuspendedGuestReturnPCsLowered = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aGeneralReturnRecordAbiConnected = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aNativeActorStackFaultProof = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aLLVMGuest = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33aForgeGuest = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {delete m.frameStorageBootstrap.javaM33aIterativeSourceReference;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33bTypedAdmissionStatus = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33bExactPrimitiveKindsGuarded = false;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33bRebindOnlyExplicitLet = false;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33bImplicitJvmIntegerWideningAllowed = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33bMixedPrimitiveEqualityAllowed = true;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33bForgedOperandStackPointerFailsClosed = false;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33bJUnitTestsExecuted = 75;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33bTypedAttoGuestEvidence = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33bNativeStackFailureContainment = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaM33bFiveBackendParity = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {delete m.frameStorageBootstrap.javaM33bSourceReference;})));
  assert.throws(() => validatePending(mutate(m => {delete m.frameStorageBootstrap.javaCompilerReturnRecordReference;})));
  assert.throws(() => validatePending(mutate(m => {m.frameStorageBootstrap.javaCompilerLexicalGuestExecution = 'PASS';})));
  assert.throws(() => validatePending(mutate(m => {delete m.frameStorageBootstrap.javaCompilerScalarParameterReference;})));
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

test('M2.1 scalar call arguments stay distinct from complete guest stack proof', async () => {
  const manifest = validatePending(await load());
  const scenario = manifest.scenarios.find(s => s.id === 'typed-scalar-invocation-actor-owned-data');
  assert.ok(scenario);
  assert.equal(scenario.source, null,
    'authored separate Java .ores test is not an executed canonical .atto receipt');
  assert.equal(scenario.kind, 'pending-actor-acceptance');
  for (const key of ['compilerGuest', 'actorStackStorage', 'actorSurvival']) {
    assert.ok(scenario.requiredEvidence.includes(key));
  }
  for (const backend of manifest.backends) {
    assert.equal(backend.compilerGuest, 'NOT_EXECUTED');
    assert.equal(backend.actorStackStorage, 'NOT_EXECUTED');
  }
  assert.equal(manifest.promotion.certified, false);
});

test('M3 merged SourceTask scalar snapshot remains pending real compiler and mailbox proof', async () => {
  const manifest = validatePending(await load());
  const scenarios = new Map(manifest.scenarios.map(s => [s.id, s]));
  for (const name of [
    'actor-source-task-typed-scalars-retained-across-await',
    'actor-source-task-typed-state-reference-or-oversize-denied'
  ]) {
    const pending = scenarios.get(name);
    assert.ok(pending, 'M3 scenario must be inventoried: ' + name);
    assert.equal(pending.source, null, 'no fabricated compiled .atto fixture');
    assert.ok(pending.requiredEvidence.includes('compilerGuest'));
    assert.ok(pending.requiredEvidence.includes('suspendedFrameOwnership'));
  }
  assert.equal(manifest.frameStorageBootstrap.javaSourceTaskScalarMaxValues, 6);
  assert.equal(manifest.frameStorageBootstrap.javaSourceTaskScalarAutoCompilerLowering, false);
  for (const backend of manifest.backends) {
    assert.equal(backend.compilerGuest, 'NOT_EXECUTED');
    assert.equal(backend.suspendedFrameOwnership, 'NOT_EXECUTED');
    assert.equal(backend.actorStackStorage, 'NOT_EXECUTED');
  }
  assert.equal(manifest.promotion.certified, false);
});

test('M3.1 SourceTask compiler scalar formal arguments require actual .atto evidence', async () => {
  const manifest = validatePending(await load());
  const names = [
    'source-task-scalar-parameters-bound-from-actor-bytes',
    'source-task-scalar-parameter-corruption-fail-stop'
  ];
  for (const name of names) {
    const scenario = manifest.scenarios.find(item => item.id === name);
    assert.ok(scenario, 'missing scalar argument conformance case: ' + name);
    assert.equal(scenario.source, null,
      'authored separate Java compiler fixture is not an executed source receipt');
    assert.ok(scenario.requiredEvidence.includes('compilerGuest'));
    assert.ok(scenario.requiredEvidence.includes('actorStackStorage')
      || scenario.requiredEvidence.includes('actorStackGeneration'));
  }
  for (const backend of manifest.backends) {
    assert.equal(backend.compilerGuest, 'NOT_EXECUTED');
    assert.equal(backend.actorStackStorage, 'NOT_EXECUTED');
  }
  assert.equal(manifest.frameStorageBootstrap.javaCompilerScalarParameterStatus,
    'AUTHORED_NOT_EXECUTED');
  assert.equal(manifest.frameStorageBootstrap.javaCompilerStacklessEvaluator, false);
  assert.equal(manifest.promotion.certified, false);
});

test('M3.2 scalar Env slots and call-return ABI are not stackless guest proof', async () => {
  const manifest = validatePending(await load());
  const required = [
    'actor-source-mutable-lexical-scalar-across-two-cooperates',
    'actor-source-lexical-shadowed-scope-isolation',
    'actor-source-lexical-type-tag-corruption-fail-stop',
    'actor-return-pc-record-not-yet-dispatch-lowered'
  ];
  for (const id of required) {
    const scenario = manifest.scenarios.find(s => s.id === id);
    assert.ok(scenario, 'missing M3.2 scenario: ' + id);
    assert.equal(scenario.source, null, 'no fabricated guest source compiler receipt');
    assert.ok(scenario.requiredEvidence.includes('compilerGuest'));
    assert.ok(scenario.requiredEvidence.includes('actorStackStorage')
      || scenario.requiredEvidence.includes('actorStackGeneration'));
  }
  const frame = manifest.frameStorageBootstrap;
  assert.equal(frame.javaCompilerLexicalFrameBytes, 64);
  assert.equal(frame.javaCompilerLexicalJvmShadowStillPresent, true);
  assert.equal(frame.javaCompilerReturnRecordBytes, 48);
  assert.equal(frame.javaCompilerReturnRecordUsedByGuestDispatcher, false);
  for (const backend of manifest.backends) {
    assert.equal(backend.compilerGuest, 'NOT_EXECUTED');
    assert.equal(backend.actorStackStorage, 'NOT_EXECUTED');
  }
  assert.equal(manifest.promotion.certified, false);
});

test('M3.2 hardening denies same-carrier return reuse and stale scalar Task capture', async () => {
  const manifest = validatePending(await load());
  const scenarios = new Map(manifest.scenarios.map(s => [s.id, s]));
  const ids = [
    'actor-return-record-same-carrier-new-turn-denied',
    'actor-return-record-cross-task-handle-denied',
    'actor-scalar-lexical-detached-task-copy-move-denied',
    'actor-frame-scalar-tag-payload-corruption-fail-stop',
    'actor-scalar-NaN-raw-bits-survive-cooperate'
  ];
  for (const id of ids) {
    const pending = scenarios.get(id);
    assert.ok(pending, 'missing hardening scenario ' + id);
    assert.equal(pending.source, null, 'do not fabricate compiled guest fixture');
    assert.ok(pending.requiredEvidence.includes('compilerGuest'));
  }
  const bridge = manifest.frameStorageBootstrap;
  assert.equal(bridge.javaM32JvmScalarShadowTaskCaptureAllowed, false);
  assert.equal(bridge.javaM32PhysicalTurnIdentityFenced, true);
  assert.equal(bridge.javaM32SchedulerTaskIdentityFenced, true);
  assert.equal(bridge.javaM32NewHostJUnitMethodsAuthored, 11);
  assert.equal(bridge.javaM32NewHostJUnitMethodsExecuted, 0);
  for (const backend of manifest.backends) {
    assert.equal(backend.compilerGuest, 'NOT_EXECUTED');
    assert.equal(backend.actorStackStorage, 'NOT_EXECUTED');
  }
  assert.equal(manifest.promotion.certified, false);
});

test('M3.3 Env snapshot is task-identity fenced but has no guest callback parity', async () => {
  const matrix = validatePending(await load());
  const names = [
    'actor-env-snapshot-same-source-task-across-await',
    'actor-env-snapshot-other-source-task-same-actor-denied',
    'actor-env-snapshot-after-owner-retirement-denied',
    'actor-env-snapshot-corrupt-execution-owner-denied'
  ];
  for (const name of names) {
    const scenario = matrix.scenarios.find(s => s.id === name);
    assert.ok(scenario, 'missing M3.3 task snapshot proof: ' + name);
    assert.equal(scenario.source, null, 'no invented compiler-guest fixture receipt');
    assert.ok(scenario.requiredEvidence.includes('compilerGuest'));
  }
  const b = matrix.frameStorageBootstrap;
  assert.equal(b.javaM33EnvSnapshotExactExecutionIdentityFenced, true);
  assert.equal(b.javaM33EnvSnapshotRetiredReadDenied, true);
  assert.equal(b.javaM33EnvSnapshotCrossTaskArenaPoisonAllowed, false);
  assert.equal(b.javaM33EnvSnapshotJUnitMethodsExecuted, 0);
  assert.equal(b.javaM33EnvSnapshotActualCallbackParity, 'NOT_EXECUTED');
  assert.equal(b.javaM33EnvSnapshotIterativeDispatcher, false);
  for (const backend of matrix.backends) {
    assert.equal(backend.compilerGuest, 'NOT_EXECUTED');
    assert.equal(backend.actorStackStorage, 'NOT_EXECUTED');
  }
  assert.equal(matrix.promotion.certified, false);
});

test('M3.3a iterative scalar call/return is authored, not five-backend guest stack parity', async () => {
  const matrix = validatePending(await load());
  const cases = [
    'actor-scalar-iterative-non-tail-call-return-pcs',
    'actor-scalar-iterative-proper-tail-100k-constant-frames',
    'actor-scalar-iterative-mutual-tail-no-jvm-recursion',
    'actor-scalar-iterative-non-tail-budget-denial',
    'actor-scalar-iterative-overflow-sibling-survives',
    'actor-scalar-iterative-caller-operand-preservation',
    'actor-scalar-iterative-pc-callee-id-corruption-fail-stop',
    'actor-scalar-iterative-unsupported-reference-effect-fallback'
  ];
  for (const name of cases) {
    const scenario = matrix.scenarios.find(s => s.id === name);
    assert.ok(scenario, 'missing M3.3a guest proof: ' + name);
    assert.equal(scenario.source, null, 'authored .atto files are not executed receipts');
    assert.ok(scenario.requiredEvidence.includes('compilerGuest'));
  }
  const b = matrix.frameStorageBootstrap;
  assert.equal(b.javaM33aHostJUnitAuthored, 33);
  assert.equal(b.javaM33aParserJUnitAuthored, 16);
  assert.equal(b.javaM33aAttoJUnitAuthored, 5);
  assert.equal(b.javaM33aJUnitExecuted, 0);
  assert.equal(b.javaM33aInstructionsPerSafepoint, 128);
  assert.equal(b.javaM33aNonScalarJvmFallbackStillRecursive, true);
  assert.equal(b.javaM33aGeneralReturnRecordAbiConnected, false);
  assert.equal(b.javaM33aCompiledAttoGuestEvidence, 'NOT_EXECUTED');
  for (const backend of matrix.backends) {
    assert.equal(backend.compilerGuest, 'NOT_EXECUTED');
    assert.equal(backend.actorStackStorage, 'NOT_EXECUTED');
  }
  assert.equal(matrix.promotion.certified, false);
});

test('M3.3b typed scalar admission remains distinct from executed .atto proof', async () => {
  const matrix = validatePending(await load());
  const cases = [
    'actor-scalar-int-bool-type-admission-must-precede-execution',
    'actor-scalar-val-const-parameter-rebind-rejected',
    'actor-scalar-synthetic-integer-literal-no-implicit-widening',
    'actor-scalar-forged-operand-sp-fail-stop',
    'actor-scalar-mixed-primitive-tags-fail-stop',
    'actor-scalar-exact-boolean-equality-condition'
  ];
  for (const name of cases) {
    const scenario = matrix.scenarios.find(s => s.id === name);
    assert.ok(scenario, 'missing M3.3b proof gate: ' + name);
    assert.equal(scenario.source, null, 'authored tests are not compiler-backed receipts');
    assert.ok(scenario.requiredEvidence.includes('compilerGuest'));
  }
  const data = matrix.frameStorageBootstrap;
  assert.equal(data.javaM33bRebindOnlyExplicitLet, true);
  assert.equal(data.javaM33bImplicitJvmIntegerWideningAllowed, false);
  assert.equal(data.javaM33bMixedPrimitiveEqualityAllowed, false);
  assert.equal(data.javaM33bActorRuntimeHostTestsAuthored, 38);
  assert.equal(data.javaM33bParserNegativeTestsAuthored, 32);
  assert.equal(data.javaM33bAttoGuestTestsAuthored, 5);
  assert.equal(data.javaM33bJUnitTestsExecuted, 0);
  assert.equal(data.javaM33bFiveBackendParity, 'NOT_EXECUTED');
  assert.equal(matrix.promotion.certified, false);
});
