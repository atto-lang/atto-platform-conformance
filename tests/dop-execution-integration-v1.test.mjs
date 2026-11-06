import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDopGuestReceipt} from '../verification/dop-scalar-guest-v1.mjs';

const contract = {contract: 'attolang.dop.scalar-guest/1',
  fixture: {gitBlobSha: 'aedc778e3e8dd2940600f047540c159b0129830a'}};
const hash = 'b'.repeat(64);
const head = 'a'.repeat(40);
const steps = ['checkout-head','compile-guest','execute-guest'].map((id, i) => ({
  id, number: i + 1, conclusion: 'success',
  startedAt: `2026-11-06T10:00:0${i}Z`,
  completedAt: `2026-11-06T10:00:0${i+1}Z`
}));
const base = {contract: contract.contract, backend:'java', executionProfile:'jit',
  caseId:'primitive-columns-atto-guest', status:'PASSED', sourceHeadSha:head,
  checkoutHeadSha:head, sourceTreeSha:head, fixtureGitBlobSha:contract.fixture.gitBlobSha,
  compilerSha256:hash, fixtureSha256:hash, guestArtifactSha256:null,
  toolchain:'JDK 25 / GraalVM JIT', command:'mvn -Dtest=DopScalarGuestParityTest test',
  discoveredTests:2,executedTests:2,guestExecuted:true,executionStage:'managed-guest', guestExitCode:0,
  jitEvidence:{compilerClassTreeSha256:hash,runtimeBinarySha256:hash,junitReportSha256:hash,
    reportClass:'dev.oreslang.DopScalarGuestParityTest',guestCases:[
      'identicalScalarSoaSourceCompilesAndReturnsZeroFromRealJitGuest',
      'incorrectGuestChecksumIsDetectedByActualCompiledExecution'
    ]},
  ciJob:{runId:123,runnerId:456,conclusion:'success',steps}
};
const check = patch => validateDopGuestReceipt({...base,...patch},contract);
test('integrated JIT receipt has a positive synthetic schema control, not an execution attestation', () => {
  assert.deepEqual(check(),[]);
});
test('integrated JIT rejects fake guest artifact and absent JUnit evidence', () => {
  assert.ok(check({guestArtifactSha256:hash}).includes('jit-no-native-guest-artifact'));
  assert.ok(check({jitEvidence:null}).includes('jit-evidence-object'));
});
test('integrated JIT rejects zero-step CI and false guest-executed claims', () => {
  assert.ok(check({ciJob:{...base.ciJob,runnerId:0,steps:[]}}).length);
  assert.ok(check({guestExecuted:false}).includes('guest-process-executed'));
});
test('integrated JIT rejects wrong source blob and negative control not run', () => {
  assert.ok(check({fixtureGitBlobSha:'c'.repeat(40)}).includes('fixture-git-blob-sha'));
  assert.ok(check({jitEvidence:{...base.jitEvidence,guestCases:base.jitEvidence.guestCases.slice(0,1)}})
    .includes('jit-exact-two-guest-cases'));
});
test('existing native AOT receipt retains artifact requirement with explicit profile', () => {
  const aot={...base,backend:'llvm',executionProfile:'aot', executionStage:'native-guest',
    guestArtifactSha256:hash,jitEvidence:null,discoveredTests:1,executedTests:1};
  assert.deepEqual(validateDopGuestReceipt(aot,contract),[]);
  assert.ok(validateDopGuestReceipt({...aot,guestArtifactSha256:null},contract)
    .includes('guest-artifact-sha256'));
});

test('integrated Java JIT cannot use a fake legacy AOT profile and hash', () => {
  const bypass = {...base, executionProfile: undefined, guestArtifactSha256: hash,
    jitEvidence: null};
  assert.ok(validateDopGuestReceipt(bypass, contract).includes('artifact-backend-stage'));
});
test('integrated JIT report must bind the compilerClassTreeSha256 to compilerSha256', () => {
  const bypass = {...base, compilerSha256: 'c'.repeat(64)};
  assert.ok(validateDopGuestReceipt(bypass, contract).includes('jit-compiler-fingerprint-match'));
});
