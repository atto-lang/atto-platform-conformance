import test from 'node:test';
import assert from 'node:assert/strict';
import {validateParityIndex, loadParityIndex, REQUIRED_BACKENDS, REQUIRED_WORKSTREAMS} from '../lib/eleven-backend-parity-v1.mjs';
const base = loadParityIndex();
const clone = () => structuredClone(base);
const denied = (mutate, name) => test(name, () => {
  const item = clone();
  mutate(item);
  assert.throws(() => validateParityIndex(item), /ELEVEN_BACKEND_PARITY_DENIED/);
});
test('all eleven immutable backend identities and ten cross-contract gates are present', () => {
  const result = validateParityIndex(base);
  assert.deepEqual(result, {backends: 11, workstreams: 10, cells: 110, guest_passes: 0});
  assert.deepEqual(new Set(base.backends.map(b => b.id)), new Set(Object.keys(REQUIRED_BACKENDS)));
  assert.deepEqual(new Set(base.workstreams.map(w => w.id)), new Set(REQUIRED_WORKSTREAMS));
});
denied(x => x.backends.pop(), 'missing backend is rejected');
denied(x => x.backends.push(structuredClone(x.backends[0])), 'duplicate backend is rejected');
denied(x => x.backends[0].repository = 'atto-lang/atto-source.java-evil', 'repository substitution is rejected');
denied(x => x.backends[0].repository_id = '12345', 'immutable repo ID substitution is rejected');
denied(x => x.backends[0].observed_main_sha = 'main', 'non-SHA main snapshot is rejected');
denied(x => x.backends[0].features = {}, 'missing feature coverage is rejected');
denied(x => x.backends[0].features.operator_caret_xor.state = 'passed', 'invented guest pass is rejected');
denied(x => x.backends[0].features.operator_caret_xor.evidence = {run_url:'https://github.com/test'}, 'invented host receipt is rejected');
denied(x => x.backends[0].features.operator_caret_xor.candidate_prs.push('https://github.com/atto-lang/atto-source.llvm/pull/69'), 'wrong backend candidate PR is rejected');
denied(x => x.backends[0].features.operator_caret_xor.candidate_prs.push(x.backends[0].features.operator_caret_xor.candidate_prs[0]), 'duplicate candidate URL is rejected');
denied(x => x.backends[0].release_qualified = true, 'backend release status cannot self-promote');
denied(x => x.release_qualified = true, 'overall release status cannot self-promote');
denied(x => x.workstreams.pop(), 'missing normative workstream is rejected');
denied(x => x.workstreams[0].approval_state = 'ratified', 'unapproved spec promotion is rejected');
denied(x => x.backends[0].features.checked_i64.skip = true, 'unknown feature escape hatch is rejected');
test('historical scope contains no self-attested success', () => {
  for (const b of base.backends) for (const cell of Object.values(b.features)) {
    assert.equal(cell.state, 'not_executed');
    assert.equal(cell.evidence, null);
  }
});
