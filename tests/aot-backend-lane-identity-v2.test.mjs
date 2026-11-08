import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyAotExecutionEvidenceForBackend as classify,
  classifyAotExecutionEvidence as legacyClassify} from '../lib/aot-execution-evidence-v2.mjs';

// Local/host structural regression only. Synthetic records are never
// independent compiler execution, no-GC, or release attestations.
const sourceCommit = 'a'.repeat(40);
const sourceTree = 'b'.repeat(40);
const digest = 'c'.repeat(64);
const backends = ['java', 'llvm', 'net', 'wasm', 'forge', 'cranelift'];
const sourceSelector = {sourceCommit, sourceTree};
const expectedFor = backend => ({...sourceSelector, backend});
function receipt(backend) {
  return {
    schema: 'atto.aot-execution-evidence.v2', backend,
    mode: 'full-aot', status: 'EXECUTED', trust: 'trusted', isolation: 'isolated',
    sourceCommit, sourceTree,
    sourceProgramSha256: digest, compilerSha256: digest,
    artifact: {
      kind: backend === 'wasm' ? 'closed-guest-wasm-module' : 'linked-native-guest-executable',
      sha256: digest
    },
    closure: {macrosEliminated: true, importsResolved: true,
      genericsClosed: true, actorHandlersClosed: true,
      asyncContinuationsClosed: true, dispatchClosed: true,
      effectsChecked: true, ownershipChecked: true, runtimeCompilerAbsent: true},
    execution: {jobId: 11, runnerName: 'synthetic-structural-only', completedSteps: 4,
      guestEntrypointRan: true, guestOutputSha256: digest, guestInterpreterUsed: false,
      runtimeGuestCompilerUsed: false, runtimeGuestJitUsed: false,
      aotBaselineRanWithoutJit: true}
  };
}

for (const backend of backends) {
  test(backend + ': exact independent backend lane is structural, never release-qualified', () => {
    const result = classify(receipt(backend), expectedFor(backend));
    assert.equal(result.classification, 'AOT_STRUCTURAL_REVIEW_REQUIRED');
    assert.equal(result.structurallyValid, true);
    assert.equal(result.ok, false);
    assert.equal(result.releaseQualified, false);
  });
  for (const wrong of backends.filter(other => other !== backend)) {
    test(backend + ': source-matched receipt cannot impersonate ' + wrong, () => {
      const result = classify(receipt(backend), expectedFor(wrong));
      assert.equal(result.classification, 'INVALID');
      assert.equal(result.releaseQualified, false);
      assert.ok(result.errors.some(e => e.includes('backend lane')));
    });
  }
}

test('Forge and Cranelift are separate structural backends, not aliases', () => {
  for (const backend of ['forge', 'cranelift']) {
    const result = classify(receipt(backend), expectedFor(backend));
    assert.equal(result.classification, 'AOT_STRUCTURAL_REVIEW_REQUIRED');
    const wrong = backend === 'forge' ? 'cranelift' : 'forge';
    assert.equal(classify(receipt(backend), expectedFor(wrong)).classification, 'INVALID');
  }
});

test('legacy source-only selector remains compatible but never attests backend', () => {
  for (const backend of backends) {
    const output = legacyClassify(receipt(backend), sourceSelector);
    assert.equal(output.classification, 'AOT_STRUCTURAL_REVIEW_REQUIRED');
    assert.equal(output.releaseQualified, false);
  }
});

for (const [name, change] of [
  ['missing backend', x => {delete x.backend;}],
  ['invalid backend alias', x => {x.backend = 'forge/cranelift';}],
  ['backend casing', x => {x.backend = 'Forge';}],
  ['unexpected metadata', x => {x.trusted = true;}],
  ['wrong head', x => {x.sourceCommit = 'd'.repeat(40);}],
  ['wrong tree', x => {x.sourceTree = 'd'.repeat(40);}],
  ['inherited selector', x => Object.create(x)],
  ['malicious accessor', x => Object.defineProperty(x, 'backend', {
    enumerable: true, get() {throw new Error('getter trap');}
  })],
]) {
  test('trusted source/backend selector rejects ' + name, () => {
    const x = expectedFor('forge');
    const altered = change(x) ?? x;
    assert.equal(classify(receipt('forge'), altered).classification, 'INVALID');
  });
}

test('unregistered backend labels cannot claim structural success', () => {
  for (const bogus of ['js', 'rust', 'java-graalvm', 'forge-cranelift', 'host', '', 'FORGE']) {
    assert.equal(classify(receipt(bogus), expectedFor('forge')).classification, 'INVALID', bogus);
  }
});

test('Wasm module does not masquerade as independent native backend artifact', () => {
  const v = receipt('forge'); v.artifact.kind = 'closed-guest-wasm-module';
  assert.equal(classify(v, expectedFor('forge')).classification, 'INVALID');
  const w = receipt('wasm'); w.artifact.kind = 'linked-native-guest-executable';
  assert.equal(classify(w, expectedFor('wasm')).classification, 'INVALID');
});

for (const [name, pick] of [
  ['receipt root', x => x],
  ['artifact record', x => x.artifact],
  ['closure record', x => x.closure],
  ['execution record', x => x.execution],
]) {
  test(name + ': hidden symbol metadata is rejected', () => {
    const x = receipt('forge');
    Object.defineProperty(pick(x), Symbol('fake-release'), {value: true});
    assert.equal(classify(x, expectedFor('forge')).classification, 'INVALID');
  });
  test(name + ': non-enumerable metadata is rejected', () => {
    const x = receipt('forge');
    Object.defineProperty(pick(x), 'hiddenRelease', {value: true});
    assert.equal(classify(x, expectedFor('forge')).classification, 'INVALID');
  });
}

for (const [name, pick, key] of [
  ['receipt root', x => x, 'backend'],
  ['artifact record', x => x.artifact, 'sha256'],
  ['closure record', x => x.closure, 'ownershipChecked'],
  ['execution record', x => x.execution, 'completedSteps'],
]) {
  test(name + ': required non-enumerable data field is rejected', () => {
    const x = receipt('forge');
    const target = pick(x);
    Object.defineProperty(target, key, {
      value: target[key], enumerable: false, writable: true, configurable: true
    });
    assert.equal(classify(x, expectedFor('forge')).classification, 'INVALID');
  });
}

test('trusted selector cannot contain hidden or symbol properties', () => {
  for (const name of ['hidden', 'symbol']) {
    const selector = expectedFor('forge');
    Object.defineProperty(selector, name === 'symbol' ? Symbol('fake') : 'hidden', {value: 1});
    assert.equal(classify(receipt('forge'), selector).classification, 'INVALID');
  }
});

test('malicious ownKeys proxy traps never escape classification', () => {
  const evilReceipt = new Proxy(receipt('forge'), {
    ownKeys() {throw new Error('ownKeys trap');}
  });
  const evilSelector = new Proxy(expectedFor('forge'), {
    ownKeys() {throw new Error('ownKeys trap');}
  });
  assert.equal(classify(evilReceipt, expectedFor('forge')).classification, 'INVALID');
  assert.equal(classify(receipt('forge'), evilSelector).classification, 'INVALID');
});

test('ordinary frozen canonical JSON data retains structural compatibility', () => {
  const x = receipt('forge');
  Object.freeze(x.artifact);
  Object.freeze(x.closure);
  Object.freeze(x.execution);
  Object.freeze(x);
  const selector = Object.freeze(expectedFor('forge'));
  const result = classify(x, selector);
  assert.equal(result.classification, 'AOT_STRUCTURAL_REVIEW_REQUIRED');
  assert.equal(result.releaseQualified, false);
});
