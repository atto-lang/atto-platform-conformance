import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDopPositiveExecutionProfile} from '../verification/dop-execution-profile-v1.mjs';

const hash = 'a'.repeat(64);
const names = ['identicalScalarSoaSourceCompilesAndReturnsZeroFromRealJitGuest',
  'incorrectGuestChecksumIsDetectedByActualCompiledExecution'];
const valid = {
  backend: 'java', executionProfile: 'jit', executionStage: 'managed-guest',
  guestArtifactSha256: null, executedTests: 2, discoveredTests: 2, compilerSha256: hash,
  jitEvidence: {compilerClassTreeSha256: hash, runtimeBinarySha256: hash, junitReportSha256: hash,
    reportClass: 'dev.oreslang.DopScalarGuestParityTest', guestCases: names}
};
const verify = mutation => validateDopPositiveExecutionProfile({...valid, ...mutation});
test('a JIT proof may not claim a nonexistent native guest artifact', () => {
  assert.deepEqual(verify(), []);
  assert.ok(verify({guestArtifactSha256: hash}).includes('jit-no-native-guest-artifact'));
  assert.ok(verify({guestArtifactSha256: undefined}).includes('jit-no-native-guest-artifact'));
});
test('JIT scope is limited to real Java managed guest execution', () => {
  for (const backend of ['llvm', 'wasm', 'forge', 'net'])
    assert.ok(verify({backend}).includes('jit-java-only-v1'));
  assert.ok(verify({executionStage: 'host-model'}).includes('jit-managed-guest-stage'));
  assert.ok(verify({executionStage: 'native-guest'}).includes('jit-managed-guest-stage'));
});
test('JIT must pin runtime binary and JUnit evidence bytes', () => {
  assert.ok(verify({jitEvidence: null}).includes('jit-evidence-object'));
  assert.ok(verify({jitEvidence: {...valid.jitEvidence, runtimeBinarySha256: ''}})
    .includes('jit-runtime-binary-sha256'));
  assert.ok(verify({jitEvidence: {...valid.jitEvidence, junitReportSha256: null}})
    .includes('jit-junit-report-sha256'));
});
test('JIT must name both independently verified positive and negative guest cases', () => {
  const ev = valid.jitEvidence;
  for (const guestCases of [[], [names[0]], [names[0], names[0]],
    [names[0], 'hostReferenceOnly']]) {
    assert.ok(verify({jitEvidence: {...ev, guestCases}}).includes('jit-exact-two-guest-cases'));
  }
  assert.ok(verify({jitEvidence: {...ev, reportClass: 'other.Unverified'}})
    .includes('jit-source-guest-report-class'));
});
test('JIT two-case test count is exact, not skipped or synthetic extra tests', () => {
  assert.ok(verify({executedTests: 1}).includes('jit-exact-two-guest-test-count'));
  assert.ok(verify({discoveredTests: 3}).includes('jit-exact-two-guest-test-count'));
});
test('AOT still requires real guest artifact identity and no spoofed JIT evidence', () => {
  const aot = {...valid, backend: 'llvm', executionProfile: 'aot',
    executionStage: 'native-guest', guestArtifactSha256: hash, jitEvidence: null};
  assert.deepEqual(validateDopPositiveExecutionProfile(aot), []);
  assert.ok(validateDopPositiveExecutionProfile({...aot, guestArtifactSha256: null})
    .includes('guest-artifact-sha256'));
  assert.ok(validateDopPositiveExecutionProfile({...aot, jitEvidence: valid.jitEvidence})
    .includes('aot-no-jit-evidence'));
});
test('unknown or misleading execution profiles are rejected', () => {
  assert.ok(verify({executionProfile: 'host-model'}).includes('unknown-execution-profile'));
  assert.ok(verify({executionProfile: null}).includes('unknown-execution-profile'));
  assert.deepEqual(validateDopPositiveExecutionProfile({executionProfile:'aot',
    backend:'llvm', executionStage:'native-guest', guestArtifactSha256:hash}), []);
});
test('malformed evidence objects cannot crash the validator or pass', () => {
  for (const jitEvidence of [undefined, [], 42, 'self-certified', {}])
    assert.notDeepEqual(verify({jitEvidence}), []);
  assert.deepEqual(validateDopPositiveExecutionProfile(null), ['profile-receipt-object']);
});

test('JIT compiler fingerprint must bind to the class-tree hash in receipt', () => {
  assert.deepEqual(verify(), []);
  assert.ok(verify({compilerSha256: 'c'.repeat(64)}).includes('jit-compiler-fingerprint-match'));
  assert.ok(verify({jitEvidence: {...valid.jitEvidence, compilerClassTreeSha256: null}})
    .includes('jit-compiler-class-tree-sha256'));
  assert.ok(verify({jitEvidence: {...valid.jitEvidence, compilerClassTreeSha256: 'c'.repeat(64)}})
    .includes('jit-compiler-fingerprint-match'));
});
test('managed Java JIT cannot masquerade as legacy artifact-producing AOT', () => {
  const fake = {...valid, executionProfile: undefined, jitEvidence: null,
    guestArtifactSha256: hash};
  assert.ok(validateDopPositiveExecutionProfile(fake).includes('artifact-backend-stage'));
  assert.ok(validateDopPositiveExecutionProfile({...fake, executionProfile:'aot'})
    .includes('artifact-backend-stage'));
  const legitimateNative = {...fake, executionStage:'nativeaot-guest'};
  assert.deepEqual(validateDopPositiveExecutionProfile(legitimateNative), []);
});
test('backend/stage confusion never passes artifact-backed profiles', () => {
  for (const [backend, executionStage] of [
    ['llvm','browser-guest'],['forge','managed-guest'],['wasm','native-guest'],
    ['java','managed-guest'],['net','browser-guest'],['unknown','native-guest']
  ]) {
    const fake = {backend, executionStage, executionProfile:'aot',
      guestArtifactSha256: hash};
    assert.ok(validateDopPositiveExecutionProfile(fake).includes('artifact-backend-stage'),
      backend + '/' + executionStage);
  }
});
