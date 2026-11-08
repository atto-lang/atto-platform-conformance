import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyAotExecutionEvidenceForBackend as classify} from '../lib/aot-execution-evidence-v2.mjs';

// Purely synthetic records: these tests do not attest a real runner, a compiler
// or an AOT guest executable. All results remain non-release-qualified.
const commit = 'a'.repeat(40), tree = 'b'.repeat(40), hash = 'c'.repeat(64);
const backend = 'forge';
const expected = () => ({sourceCommit: commit, sourceTree: tree, backend});
const closureKeys = ['macrosEliminated', 'importsResolved', 'genericsClosed',
  'actorHandlersClosed', 'asyncContinuationsClosed', 'dispatchClosed',
  'effectsChecked', 'ownershipChecked', 'runtimeCompilerAbsent'];
const closure = flag => Object.fromEntries(closureKeys.map(k => [k, flag]));
function receipt(mode = 'full-aot') {
  return {
    schema:'atto.aot-execution-evidence.v2',
    backend, mode, status:'EXECUTED', trust:'trusted', isolation:'isolated',
    sourceCommit:commit, sourceTree:tree, sourceProgramSha256:hash,
    compilerSha256:hash, artifact:{kind:'linked-native-guest-executable',sha256:hash},
    closure:closure(true),
    execution:{jobId:10,runnerName:'source-owner-runner',completedSteps:5,
      guestEntrypointRan:true,guestOutputSha256:hash,guestInterpreterUsed:false,
      runtimeGuestCompilerUsed:false,runtimeGuestJitUsed:false,
      aotBaselineRanWithoutJit:true}
  };
}
function unexecuted(status = 'NOT_EXECUTED') {
  const x = receipt();
  x.status = status;
  x.sourceProgramSha256 = null;
  x.compilerSha256 = null;
  x.artifact = {kind:'none',sha256:null};
  x.closure = closure(false);
  x.execution = {jobId:null,runnerName:null,completedSteps:0,
    guestEntrypointRan:false,guestOutputSha256:null,guestInterpreterUsed:false,
    runtimeGuestCompilerUsed:false,runtimeGuestJitUsed:false,
    aotBaselineRanWithoutJit:false};
  return x;
}
const verdict = (x, selector = expected()) => classify(x, selector);

for (const status of ['NOT_EXECUTED', 'UNSUPPORTED']) {
  test(status + ': canonical zero-step record remains unqualified', () => {
    const r = verdict(unexecuted(status));
    assert.equal(r.classification, status);
    assert.equal(r.ok, false);
    assert.equal(r.releaseQualified, false);
  });
  for (const field of closureKeys) {
    test(status + ': forged closure claim is invalid: ' + field, () => {
      const x = unexecuted(status);
      x.closure[field] = true;
      const r = verdict(x);
      assert.equal(r.classification, 'INVALID');
      assert.equal(r.releaseQualified, false);
      assert.ok(r.errors.some(e => e.includes('unexecuted case')));
    });
  }
}

for (const field of ['sourceCommit', 'sourceTree']) {
  test('all-zero ' + field + ' is not a real Git identity, even if selector agrees', () => {
    const x = receipt();
    const selector = expected();
    x[field] = '0'.repeat(40);
    selector[field] = '0'.repeat(40);
    assert.equal(verdict(x, selector).classification, 'INVALID');
  });
  test('zero Git identity on trusted selector cannot validate a normal receipt: ' + field, () => {
    const selector = expected();
    selector[field] = '0'.repeat(40);
    assert.equal(verdict(receipt(), selector).classification, 'INVALID');
  });
}

test('a JIT-only receipt with real JIT declared remains structural only', () => {
  const x = receipt('jit');
  x.artifact.kind = 'jit-only-guest';
  x.execution.runtimeGuestJitUsed = true;
  x.execution.aotBaselineRanWithoutJit = false;
  x.closure = closure(false);
  const r = verdict(x);
  assert.equal(r.classification, 'JIT_ONLY_STRUCTURAL_REVIEW_REQUIRED');
  assert.equal(r.releaseQualified, false);
  assert.equal(r.ok, false);
});

for (const [label, change] of [
  ['undeclared JIT execution', x => {x.execution.runtimeGuestJitUsed = false;}],
  ['fake JIT-off AOT baseline', x => {x.execution.aotBaselineRanWithoutJit = true;}],
  ['unlinked native-host image', x => {x.artifact.kind = 'native-host-runtime';}],
  ['closed guest Wasm instead of JIT-only', x => {x.artifact.kind = 'closed-guest-wasm-module';}]
]) {
  test('JIT-only cannot claim ' + label, () => {
    const x = receipt('jit');
    x.artifact.kind = 'jit-only-guest';
    x.execution.runtimeGuestJitUsed = true;
    x.execution.aotBaselineRanWithoutJit = false;
    change(x);
    assert.equal(verdict(x).classification, 'INVALID');
  });
}

test('hybrid with a real claimed JIT-off AOT baseline remains structural only', () => {
  const x = receipt('hybrid');
  x.execution.runtimeGuestJitUsed = true;
  const r = verdict(x);
  assert.equal(r.classification, 'HYBRID_STRUCTURAL_REVIEW_REQUIRED');
  assert.equal(r.releaseQualified, false);
});

for (const invalidName of ['', ' runner', 'runner ', ' run ', '\nrunner',
  'runner\nname', 'runner\rname', 'runner\tname', 'runner\u0000', 'runner\u007f',
  'x'.repeat(161)]) {
  test('runner identity rejects missing/control/uncanonical name ' + JSON.stringify(invalidName), () => {
    const x = receipt();
    x.execution.runnerName = invalidName;
    assert.equal(verdict(x).classification, 'INVALID');
  });
}

test('readable named runner with interior spaces is accepted structurally', () => {
  const x = receipt();
  x.execution.runnerName = 'Atto Source Worker 1';
  const r = verdict(x);
  assert.equal(r.classification, 'AOT_STRUCTURAL_REVIEW_REQUIRED');
  assert.equal(r.releaseQualified, false);
});

test('failed admitted compiler job is not a completed AOT guest run', () => {
  const x = receipt();
  x.status = 'FAILED';
  const r = verdict(x);
  assert.equal(r.classification, 'EXECUTED_FAILED_NO_AOT_CREDIT');
  assert.equal(r.releaseQualified, false);
  x.execution.completedSteps = 0;
  assert.equal(verdict(x).classification, 'INVALID');
});
