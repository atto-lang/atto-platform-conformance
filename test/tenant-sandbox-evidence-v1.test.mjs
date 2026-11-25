import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectTenantSandboxEvidence} from '../bin/inspect-tenant-sandbox-evidence-v1.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const contract = JSON.parse(fs.readFileSync(path.join(root,'contracts/tenant-sandbox-evidence-v1.json'),'utf8'));
const proofOrder = contract.proofOrder;
const modes = {'host-model':'host','compiler-guest':'guest','tenant-memory':'fault','process-fault':'fault'};
function sample(claim='host-model',backend='llvm') {
  return {
    schema:contract.schema,
    backend,
    repository:contract.backends[backend],
    sourceHead:'a'.repeat(40),
    claim,
    deployment:{trustTier:'trusted',runtime:claim==='host-model'?'host-helper':claim==='process-fault'?'os-process':'wasm-instance',decision:'pending-independent-review'},
    execution:{kind:'github-actions',head:'a'.repeat(40),runId:1,attempt:1,jobId:1,executedSteps:12,conclusion:'success'},
    artifactSha256:claim==='host-model'?null:'b'.repeat(64),
    tests:proofOrder.slice(0,proofOrder.indexOf(claim)+1).flatMap(k=>
      contract.requiredCases[k].map(id=>({id,status:'passed',mode:modes[k]})))
  };
}
function inspect(r,c=contract){return inspectTenantSandboxEvidence(r,c);}
function rejects(r,needle){
  const v=inspect(r);
  assert.equal(v.shapeValid,false);
  assert.match(v.errors.join('\n'),needle);
  assert.equal(v.promotionAllowed,false);
  assert.equal(v.untrustedPlacementAllowed,false);
}
for(const claim of proofOrder) test(claim+' syntactically complete example is still non-authoritative',()=>{
  const v=inspect(sample(claim));
  assert.deepEqual(v.errors,[]);
  assert.equal(v.shapeValid,true);
  assert.equal(v.classification,'SELF_REPORTED_ONLY');
  assert.equal(v.independentlyVerified,false);
  assert.equal(v.promotionAllowed,false);
  assert.equal(v.untrustedPlacementAllowed,false);
});
test('all nine backend identifiers are recognized without substituting repositories',()=>{
  for(const backend of Object.keys(contract.backends)) {
    const v=inspect(sample('host-model',backend));
    assert.equal(v.shapeValid,true,backend);
  }
});
test('forged backend prototype keys rejected',()=>{
  for(const backend of ['toString','constructor','__proto__','valueOf']) {
    const r=sample();r.backend=backend;rejects(r,/unknown backend/);
  }
});
test('repository substitution rejected',()=>{const r=sample();r.repository=contract.backends.java;rejects(r,/repository/);});
test('invalid source head rejected',()=>{const r=sample();r.sourceHead='f'.repeat(39);rejects(r,/sourceHead/);});
test('execution head must equal source head',()=>{const r=sample();r.execution.head='b'.repeat(40);rejects(r,/exact sourceHead/);});
test('zero-step run rejected even if marked success',()=>{const r=sample();r.execution.executedSteps=0;rejects(r,/zero-step/);});
test('invalid/absent run outcome rejected',()=>{
  for(const v of [undefined,'skipped','failure','neutral']){const r=sample();r.execution.conclusion=v;rejects(r,/conclusion/);}
});
test('job id and attempt required',()=>{
  for(const key of ['jobId','attempt','runId']){const r=sample();delete r.execution[key];rejects(r,/runId/);}
});
test('local evidence cannot prove native guest',()=>{
  const r=sample('compiler-guest');r.execution.kind='local';rejects(r,/local test report/);
});
test('local host-model evidence still cannot promote anything',()=>{
  const r=sample();r.execution.kind='local';const v=inspect(r);assert.equal(v.shapeValid,true);assert.equal(v.promotionAllowed,false);
});
test('missing target artifact digest rejected for guest',()=>{
  const r=sample('compiler-guest');delete r.artifactSha256;rejects(r,/target artifact/);
});
test('host-only receipt forbids invented guest binary',()=>{
  const r=sample();r.artifactSha256='b'.repeat(64);rejects(r,/null artifact/);
});
test('host helper cannot claim compiled guest',()=>{
  const r=sample('compiler-guest');r.deployment.runtime='host-helper';rejects(r,/not a compiled guest/);
});
for(const kind of ['host-helper','js-worker','graal-context']) test(kind+' cannot claim tenant memory protection',()=>{
  const r=sample('tenant-memory');r.deployment.runtime=kind;rejects(r,/not tenant-memory containment/);
});
for(const kind of ['js-worker','graal-isolate','wasm-instance','native-sfi','graal-context']) test(kind+' alone cannot claim OS fault containment',()=>{
  const r=sample('process-fault');r.deployment.runtime=kind;rejects(r,/requires OS process or microVM/);
});
test('hardware-only HDL stage cannot claim real guest',()=>{
  const r=sample('compiler-guest','hdl');rejects(r,/hdl has no guest actor/);
});
test('no self-attested receipt may authorize untrusted deployment',()=>{
  const r=sample('process-fault');r.deployment.trustTier='untrusted';r.deployment.decision='allow';rejects(r,/must never authorize deployment/);
  r.deployment.decision='pending-independent-review';rejects(r,/must be denied/);
  r.deployment.decision='deny';const v=inspect(r);assert.equal(v.shapeValid,true);assert.equal(v.untrustedPlacementAllowed,false);
});
test('host-only runs cannot sneak in tenant fault claims',()=>{
  const r=sample('tenant-memory');r.tests=r.tests.filter(x=>x.mode!=='fault');rejects(r,/missing required adversarial case/);
});
test('test execution mode must match stage',()=>{
  const r=sample('compiler-guest');r.tests.at(-1).mode='host';rejects(r,/wrong execution mode/);
});
test('duplicate tests cannot satisfy cases',()=>{
  const r=sample();r.tests.push(r.tests[0]);rejects(r,/duplicate/);
});
test('unknown test id not accepted',()=>{
  const r=sample();r.tests.push({id:'fake_sandbox',status:'passed',mode:'host'});rejects(r,/unrecognized/);
});
test('failed, skipped or missing negative probes are rejected',()=>{
  for(const value of ['failed','skipped',undefined]){const r=sample();r.tests[0].status=value;rejects(r,/not passed/);}
});
test('missing a single cross-tenant fault case denies tenant-memory claim',()=>{
  const r=sample('tenant-memory');r.tests=r.tests.filter(x=>x.id!=='corrupt_guest_cross_tenant_write_denied');rejects(r,/missing required adversarial case/);
});
test('missing a single host exploit case denies higher claims',()=>{
  const r=sample('process-fault');r.tests=r.tests.filter(x=>x.id!=='grant_aba_reuse');rejects(r,/missing required adversarial case/);
});
test('policy file cannot be weakened by deleting exploit vectors',()=>{
  const weakened=structuredClone(contract);weakened.requiredCases['host-model'].pop();
  const v=inspect(sample(),weakened);assert.equal(v.shapeValid,false);assert.match(v.errors.join('\n'),/registry/);
});
test('policy file cannot substitute another backend repository',()=>{
  const weakened=structuredClone(contract);weakened.backends.llvm='private/unchecked';
  const v=inspect(sample(),weakened);assert.equal(v.shapeValid,false);assert.match(v.errors.join('\n'),/registry/);
});
test('nonsense receipt rejected',()=>{
  for(const r of [null,[],1,'fake'])assert.equal(inspect(r).shapeValid,false);
});
