// This module validates receipt SHAPE only. It does not authenticate hashes,
// JUnit reports, GitHub runner steps, a JIT's machine code, or a native binary.
const sha256 = /^[0-9a-f]{64}$/;
const javaGuestCases = new Set([
  'identicalScalarSoaSourceCompilesAndReturnsZeroFromRealJitGuest',
  'incorrectGuestChecksumIsDetectedByActualCompiledExecution'
]);

/** Checks how a PASSED guest substantiates its execution profile. */
export function validateDopPositiveExecutionProfile(receipt) {
  const errors = [];
  const need = (value, reason) => { if (!value) errors.push(reason); };
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return ['profile-receipt-object'];
  }
  if (receipt.executionProfile === 'jit') {
    // A JIT has no stable native guest executable to hash. Do not fake one.
    need(receipt.backend === 'java', 'jit-java-only-v1');
    need(receipt.executionStage === 'managed-guest', 'jit-managed-guest-stage');
    need(receipt.guestArtifactSha256 === null, 'jit-no-native-guest-artifact');
    need(receipt.jitEvidence !== null && typeof receipt.jitEvidence === 'object' &&
      !Array.isArray(receipt.jitEvidence), 'jit-evidence-object');
    const ev = receipt.jitEvidence;
    need(sha256.test(ev?.runtimeBinarySha256 ?? ''), 'jit-runtime-binary-sha256');
    need(sha256.test(ev?.junitReportSha256 ?? ''), 'jit-junit-report-sha256');
    need(ev?.reportClass === 'dev.oreslang.DopScalarGuestParityTest',
      'jit-source-guest-report-class');
    const cases = ev?.guestCases;
    need(Array.isArray(cases) && cases.length === javaGuestCases.size &&
      new Set(cases).size === javaGuestCases.size &&
      cases.every(name => javaGuestCases.has(name)), 'jit-exact-two-guest-cases');
    need(receipt.executedTests === 2 && receipt.discoveredTests === 2,
      'jit-exact-two-guest-test-count');
  } else {
    need(receipt.executionProfile === 'aot' || receipt.executionProfile === undefined,
      'unknown-execution-profile');
    // Preserve existing AOT/native and managed module artifact evidence.
    need(sha256.test(receipt.guestArtifactSha256 ?? ''), 'guest-artifact-sha256');
    need(receipt.jitEvidence == null, 'aot-no-jit-evidence');
  }
  return errors;
}
