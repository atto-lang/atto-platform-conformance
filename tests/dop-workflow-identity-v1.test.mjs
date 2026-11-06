import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDopWorkflowIdentity} from '../verification/dop-workflow-identity-v1.mjs';

const policies = [
  {backend:'java', repository:'ores-truffle-oreslang/oreslang-source.java',
    workflowId:409763119, path:'.github/workflows/dop-scalar-java-guest.yml',
    name:'AttoLang DOP Java scalar JIT guest exact-head', job:'scalar-dop-java-jit'},
  {backend:'llvm', repository:'ores-truffle-oreslang/oreslang-source.llvm',
    workflowId:404132837, path:'.github/workflows/dop-atto-soa-native.yml',
    name:'Native AttoLang DOP SoA guest AOT smoke', job:'native-guest'}
];
const verify = (p, runPatch = {}, jobPatch = {}, expectedRepo = p.repository) =>
  validateDopWorkflowIdentity({backend:p.backend},
    {path:p.path,name:p.name,workflow_id:p.workflowId,event:'pull_request',...runPatch},
    {name:p.job,workflow_name:p.name,...jobPatch},expectedRepo);

test('exact Java/LLVM source-local workflow identities match synthetic controls only', () => {
  for (const p of policies) assert.deepEqual(verify(p), []);
});
test('unregistered Wasm/Forge/.NET workflows never inherit Java/LLVM authority', () => {
  for (const backend of ['wasm','forge','net','constructor','toString',null])
    assert.deepEqual(validateDopWorkflowIdentity({backend},{},{},'org/repo'),
      ['backend-workflow-not-registered']);
});
test('a different workflow on the exact same commit cannot claim actual guest execution', () => {
  for (const p of policies) {
    assert.ok(verify(p,{path:'.github/workflows/source-free-host-checks.yml'}).includes('workflow-path'));
    assert.ok(verify(p,{name:'synthetic source-free audit'}).includes('workflow-name'));
    assert.ok(verify(p,{workflow_id:null}).includes('workflow-id'));
    assert.ok(verify(p,{workflow_id:123}).includes('workflow-id'));
  }
});
test('a different GitHub job cannot substitute its own matching step names', () => {
  for (const p of policies) {
    assert.ok(verify(p,{}, {name:'source-free-model'}).includes('workflow-job-name'));
    assert.ok(verify(p,{}, {workflow_name:'other workflow'}).includes('job-workflow-name'));
  }
});
test('forks and swapped backend repo labels are rejected even with matching step labels', () => {
  for (const p of policies) {
    assert.ok(verify(p,{}, {},'untrusted/fork').includes('workflow-source-repository'));
    const other=policies.find(x=>x.backend!==p.backend);
    assert.ok(verify(p,{}, {},other.repository).includes('workflow-source-repository'));
  }
});
test('workflow_dispatch is an allowed operator event; pull_request_target and push are not', () => {
  for (const p of policies) {
    assert.deepEqual(verify(p,{event:'workflow_dispatch'}), []);
    for (const event of ['push','pull_request_target','workflow_run','schedule',null])
      assert.ok(verify(p,{event}).includes('workflow-event'));
  }
});
test('malformed input never produces a positive match or crashes', () => {
  for (const x of [null, [], 'llvm', undefined, {}])
    assert.notDeepEqual(validateDopWorkflowIdentity(x, {}, {}, policies[1].repository), []);
  assert.ok(validateDopWorkflowIdentity({backend:'llvm'},null,{},policies[1].repository)
    .includes('workflow-run-object'));
  assert.ok(validateDopWorkflowIdentity({backend:'llvm'},{},null,policies[1].repository)
    .includes('workflow-job-object'));
});
