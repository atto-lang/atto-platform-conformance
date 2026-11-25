import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAotExecutionEvidence as classify } from '../lib/aot-execution-evidence-v2.mjs';

// Synthetic records exercise the structural gate only. Passing these tests
// never proves a compiled AttoLang guest executed or that GC was eliminated.
const commit = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const hash = 'c'.repeat(64);
const expected = { sourceCommit: commit, sourceTree: tree };
const clone = value => structuredClone(value);
const inspect = value => classify(value, expected);

function receipt(backend = 'llvm', mode = 'full-aot') {
  return {
    schema: 'atto.aot-execution-evidence.v2', backend, mode, status: 'EXECUTED',
    trust: 'trusted', isolation: 'isolated', sourceCommit: commit, sourceTree: tree,
    sourceProgramSha256: hash, compilerSha256: hash,
    artifact: { kind: backend === 'wasm' ? 'closed-guest-wasm-module' :
      'linked-native-guest-executable', sha256: hash },
    closure: { macrosEliminated: true, importsResolved: true, genericsClosed: true,
      actorHandlersClosed: true, asyncContinuationsClosed: true,
      dispatchClosed: true, effectsChecked: true, ownershipChecked: true,
      runtimeCompilerAbsent: true },
    execution: { jobId: 451, runnerName: 'sample-runner', completedSteps: 6,
      guestEntrypointRan: true, guestOutputSha256: hash,
      guestInterpreterUsed: false, runtimeGuestCompilerUsed: false,
      runtimeGuestJitUsed: false, aotBaselineRanWithoutJit: true }
  };
}
function unexecuted() {
  const x = receipt();
  x.status = 'NOT_EXECUTED';
  x.sourceProgramSha256 = null;
  x.compilerSha256 = null;
  x.artifact = { kind: 'none', sha256: null };
  x.execution = { jobId: null, runnerName: null, completedSteps: 0,
    guestEntrypointRan: false, guestOutputSha256: null,
    guestInterpreterUsed: false, runtimeGuestCompilerUsed: false,
    runtimeGuestJitUsed: false, aotBaselineRanWithoutJit: false };
  return x;
}

test('every backend and supported profile remains structurally reviewed, never release-qualified', () => {
  for (const backend of ['java', 'llvm', 'net', 'wasm', 'cranelift']) {
    for (const mode of ['full-aot', 'hybrid', 'jit']) {
      const x = receipt(backend, mode);
      if (mode === 'jit') {
        x.artifact.kind = 'jit-only-guest';
        x.execution.aotBaselineRanWithoutJit = false;
      }
      const result = inspect(x);
      assert.equal(result.structurallyValid, true, backend + ':' + mode);
      assert.equal(result.releaseQualified, false, backend + ':' + mode);
      assert.equal(result.ok, false, backend + ':' + mode);
      assert.match(result.classification, /STRUCTURAL_REVIEW_REQUIRED$/);
    }
  }
});

test('unexecuted and unsupported source records never claim admission or a guest artifact', () => {
  for (const status of ['NOT_EXECUTED', 'UNSUPPORTED']) {
    const x = unexecuted(); x.status = status;
    assert.equal(inspect(x).classification, status);
    assert.equal(inspect(x).releaseQualified, false);
  }
});

const zeroStepSpoofs = [
  ['jobId', x => { x.execution.jobId = 100; }],
  ['runnerName', x => { x.execution.runnerName = 'fake-runner'; }],
  ['completedSteps', x => { x.execution.completedSteps = 1; }],
  ['guestEntrypointRan', x => { x.execution.guestEntrypointRan = true; }],
  ['guestOutputSha256', x => { x.execution.guestOutputSha256 = hash; }],
  ['sourceProgramSha256', x => { x.sourceProgramSha256 = hash; }],
  ['compilerSha256', x => { x.compilerSha256 = hash; }],
  ['artifactKind', x => { x.artifact.kind = 'linked-native-guest-executable'; }],
  ['artifactSha256', x => { x.artifact.sha256 = hash; }],
  ['JIT baseline', x => { x.execution.aotBaselineRanWithoutJit = true; }],
  ['interpreter', x => { x.execution.guestInterpreterUsed = true; }],
  ['guest runtime compiler', x => { x.execution.runtimeGuestCompilerUsed = true; }],
  ['guest runtime JIT', x => { x.execution.runtimeGuestJitUsed = true; }],
];
for (const [name, mutate] of zeroStepSpoofs) {
  test('zero-step status rejects forged ' + name, () => {
    const x = unexecuted(); mutate(x);
    assert.equal(inspect(x).classification, 'INVALID');
  });
}

test('a compiler failure with real steps is distinct from a runner admission failure', () => {
  const x = receipt(); x.status = 'FAILED';
  assert.equal(inspect(x).classification, 'EXECUTED_FAILED_NO_AOT_CREDIT');
  for (const mutate of [
    y => { y.execution.completedSteps = 0; },
    y => { y.execution.jobId = null; },
    y => { y.execution.runnerName = null; },
  ]) {
    const y = clone(x); mutate(y);
    assert.equal(inspect(y).classification, 'INVALID');
  }
});

for (const [field, value] of [
  ['sourceCommit', 'd'.repeat(40)],
  ['sourceTree', 'd'.repeat(40)],
  ['sourceProgramSha256', '0'.repeat(64)],
  ['compilerSha256', 'C'.repeat(64)],
  ['backend', 'forge'],
  ['mode', 'nativeaot-host-only'],
  ['status', 'PASS'],
]) {
  test('invalid provenance/profile cannot be promoted: ' + field, () => {
    const x = receipt(); x[field] = value;
    assert.equal(inspect(x).classification, 'INVALID');
  });
}

for (const field of [
  'macrosEliminated', 'importsResolved', 'genericsClosed',
  'actorHandlersClosed', 'asyncContinuationsClosed', 'dispatchClosed',
  'effectsChecked', 'ownershipChecked', 'runtimeCompilerAbsent',
]) {
  test('sealed AOT rejects missing static closure proof: ' + field, () => {
    const x = receipt(); x.closure[field] = false;
    assert.equal(inspect(x).classification, 'INVALID');
  });
}

for (const field of ['guestInterpreterUsed', 'runtimeGuestCompilerUsed', 'runtimeGuestJitUsed']) {
  test('sealed AOT rejects hidden fallback: ' + field, () => {
    const x = receipt(); x.execution[field] = true;
    assert.equal(inspect(x).classification, 'INVALID');
  });
}

test('JIT-only host or native image cannot spoof a sealed guest executable', () => {
  for (const kind of ['native-host-runtime', 'relocatable-guest-object', 'jit-only-guest', 'none']) {
    const x = receipt(); x.artifact.kind = kind;
    assert.equal(inspect(x).classification, 'INVALID', kind);
  }
  const wasm = receipt('wasm'); wasm.artifact.kind = 'linked-native-guest-executable';
  assert.equal(inspect(wasm).classification, 'INVALID');
});

test('forged evidence keys and prototype or getter traps fail closed', () => {
  const extra = receipt(); extra.releaseQualified = true;
  assert.equal(inspect(extra).classification, 'INVALID');
  const hidden = receipt(); Object.defineProperty(hidden.execution, 'completedSteps', {
    enumerable: true, get() { throw new Error('unexpected getter'); }
  });
  assert.equal(inspect(hidden).classification, 'INVALID');
  const inherited = Object.create(receipt());
  assert.equal(inspect(inherited).classification, 'INVALID');
  const proxy = new Proxy(receipt(), { getPrototypeOf() { throw Error('trap'); } });
  assert.equal(inspect(proxy).classification, 'INVALID');
});
