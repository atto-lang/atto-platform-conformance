import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = JSON.parse(readFileSync(new URL('../contracts/erl-otp-strict-aot-v1.json', import.meta.url), 'utf8'));
const targets = ['java', 'llvm', 'net', 'wasm', 'forge'];
const unique = values => new Set(values).size === values.length;

test('strict AOT contract does not claim guest parity from source fixtures', () => {
  assert.equal(contract.status, 'candidate-not-executed');
  assert.deepEqual(contract.backends, targets);
  assert.equal(contract.strictAot.runtimeJitAllowed, false);
  assert.equal(contract.strictAot.interpreterFallbackAllowed, false);
  assert.equal(contract.strictAot.reflectionDispatchAllowed, false);
  assert.equal(contract.strictAot.runtimeGuestCompilerAllowed, false);
  assert.equal(contract.strictAot.unsupportedFeature, 'reject-before-executable-artifact');
  assert.equal(contract.functionClauseMatching.status, 'DEFERRED');
  assert.equal(contract.functionClauseMatching.admission, 'reject-until-implemented');
});

test('AttoLang operators are not replaced by Erlang or C operators', () => {
  assert.equal(contract.operatorPolicy.equality, 'eq');
  assert.equal(contract.operatorPolicy.inequalityCanonical, 'neq');
  assert.deepEqual(contract.operatorPolicy.inequalityAlias, ['!eq']);
  assert.equal(contract.operatorPolicy.assignmentIsPatternMatch, false);
  assert.equal(contract.operatorPolicy.noImplicitNumericCoercion, true);
  for (const forbidden of ['==', '!=', '=:=', '=/=']) {
    assert.ok(contract.operatorPolicy.invalid.includes(forbidden), forbidden);
  }
});

test('feature inventory has distinct IDs and explicit AOT lowering, targets, evidence', () => {
  assert.ok(contract.features.length >= 18);
  assert.ok(unique(contract.features.map(feature => feature.id)));
  for (const feature of contract.features) {
    assert.ok(['language', 'runtime', 'library'].includes(feature.layer));
    assert.ok(['P0', 'P1', 'P2'].includes(feature.priority));
    assert.ok(feature.aotLowering.length > 20, feature.id);
    assert.deepEqual(feature.backends, targets);
    assert.equal(feature.evidence, 'NOT_EXECUTED', feature.id);
  }
});

test('semantic vectors are distinct, typed, non-promoting and cover P0 failure cases', () => {
  assert.ok(unique(contract.vectors.map(vector => vector.id)));
  const featureIds = new Set(contract.features.map(feature => feature.id));
  const byId = new Map(contract.vectors.map(vector => [vector.id, vector]));
  for (const vector of contract.vectors) {
    assert.ok(featureIds.has(vector.feature), vector.id);
    assert.deepEqual(vector.backends, targets);
    assert.equal(vector.evidence, 'NOT_EXECUTED', vector.id);
    assert.ok(['compile', 'runtime_trace', 'aot_policy'].includes(vector.kind));
    assert.ok(vector.expected && Object.keys(vector.expected).length > 0);
    if (vector.kind === 'compile') {
      assert.ok(vector.source.startsWith('fnc main() -> bool as'), vector.id);
      assert.ok(['accept', 'reject'].includes(vector.expected.compilation), vector.id);
      if (vector.expected.compilation === 'reject') {
        assert.ok(vector.expected.diagnosticClass, vector.id);
      }
    }
  }
  for (const id of ['eq.same_int', 'neq.different_int', 'not_eq_alias.different_int', 'eq.no_implicit_float',
    'eq.reject_c_style', 'neq.reject_c_style', 'selective_receive.keep_unmatched',
    'supervision_restart.one_for_all', 'binary_pattern_decode.short_input',
    'aot.no_interpreter_fallback']) {
    assert.ok(byId.has(id), id);
  }
  const covered = new Set(contract.vectors.map(v => v.feature));
  for (const feature of contract.features) assert.ok(covered.has(feature.id), 'missing oracle for ' + feature.id);
  assert.ok(contract.vectors.some(v => v.kind === 'compile' && v.expected.compilation === 'accept'));
  assert.ok(contract.vectors.some(v => v.kind === 'compile' && v.expected.compilation === 'reject'));
});

test('every strict AOT proof requires actual executed guest evidence', () => {
  for (const evidence of ['exact-head-sha', 'tree-sha', 'compiler-digest',
    'fixture-digest', 'executable-guest-steps', 'negative-diagnostics',
    'aot-fallback-rejection', 'independent-review']) {
    assert.ok(contract.evidencePolicy.required.includes(evidence));
  }
  assert.ok(contract.evidencePolicy.noPromotionFrom.includes('zero-step-ci'));
  assert.ok(contract.evidencePolicy.noPromotionFrom.includes('host-only'));
});
