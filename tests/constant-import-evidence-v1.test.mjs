// Host-only receipt-shape abuse cases. Passing these tests is NOT guest evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {evaluateConstantImportEvidence as inspect} from '../lib/constant-import-evidence-v1.mjs';

const registry = JSON.parse(readFileSync(new URL('../contracts/constant-imports-v1.json', import.meta.url), 'utf8'));
const trusted = {sourceCommit:'a'.repeat(40),sourceTree:'b'.repeat(40),jobId:123};
const digest = 'c'.repeat(64);
function synthetic() {
  return {
    schema:'atto.constant-import-evidence.v1',
    backend:'rs-browser',
    status:'EXECUTED',
    sourceCommit:trusted.sourceCommit,
    sourceTree:trusted.sourceTree,
    compilerSha256:digest,
    job:{id:trusted.jobId,runner:'hypothetical-source-runner',mode:'source-org',
      sourceFree:false,steps:['checkout','compile','guest'].map(name=>({name,conclusion:'success'}))},
    cases:registry.cases.map(c=>c.kind==='pass' ? {
      id:c.id,status:'EXECUTED',compileExit:0,emittedArtifacts:1,
      artifactSha256:digest,guestEntrypointRan:true,guestReturn:c.expected_return,
      diagnosticCode:null,
      ...(c.startups?{startups:c.startups.map(s=>({
        artifactSha256:digest,guestEntrypointRan:true,guestReturn:s.expected_return
      }))}:{}),
      ...(c.expected_initializer_invocations?{
        initializerInvocations:structuredClone(c.expected_initializer_invocations)
      }:{})
    } : {
      id:c.id,status:'EXECUTED',compileExit:1,emittedArtifacts:0,
      artifactSha256:null,guestEntrypointRan:false,guestReturn:null,
      diagnosticCode:c.expected_error
    })
  };
}

test('even a perfectly formed synthetic receipt is review-only, never PASS',()=>{
  const result=inspect(registry,synthetic(),trusted);
  assert.equal(result.classification,'STRUCTURAL_REVIEW_REQUIRED');
  assert.equal(result.releaseQualified,false);
  assert.equal(result.guestParityCertified,false);
});
test('no receipt is not executed',()=>{
  assert.equal(inspect(registry,null,trusted).classification,'NOT_EXECUTED');
});
test('zero-step, source-free, wrong job identity or incomplete steps deny credit',()=>{
  for(const mut of [
    r=>r.job.steps=[],
    r=>r.job.sourceFree=true,
    r=>r.job.id=999,
    r=>r.job.steps[1].conclusion='skipped',
    r=>r.job.steps[2].name='host-only-registry'
  ]){
    const r=synthetic();mut(r);
    assert.equal(inspect(registry,r,trusted).classification,'NOT_EXECUTED');
  }
});
test('exact head/tree must match independently selected job',()=>{
  for(const key of ['sourceCommit','sourceTree']){
    const r=synthetic();r[key]='d'.repeat(40);
    assert.equal(inspect(registry,r,trusted).classification,'SOURCE_MISMATCH');
  }
});
test('no compiler guest result can be omitted, duplicated or waived',()=>{
  for(const mut of [
    r=>r.cases.pop(),
    r=>r.cases[0].status='UNSUPPORTED',
    r=>r.cases[0].guestEntrypointRan=false,
    r=>r.cases[0].guestReturn=999,
    r=>r.cases.push({...r.cases[0]})
  ]){
    const r=synthetic();mut(r);
    assert.notEqual(inspect(registry,r,trusted).classification,'STRUCTURAL_REVIEW_REQUIRED');
  }
});
test('negative cases require exact diagnostic and zero emitted artifacts',()=>{
  for(const mut of [
    r=>r.cases.find(c=>c.id==='private_export').emittedArtifacts=1,
    r=>r.cases.find(c=>c.id==='private_export').diagnosticCode='E_OTHER',
    r=>r.cases.find(c=>c.id==='private_export').compileExit=0
  ]){
    const r=synthetic();mut(r);
    assert.equal(inspect(registry,r,trusted).classification,'INCOMPLETE');
  }
});
test('same AOT artifact is required for distinct startup environments',()=>{
  const r=synthetic();
  r.cases.find(c=>c.id==='env_same_aot_artifact_different_startups')
    .startups[1].artifactSha256='d'.repeat(64);
  assert.equal(inspect(registry,r,trusted).classification,'INCOMPLETE');
});
test('each environment declaration initializes exactly once',()=>{
  const r=synthetic();
  r.cases.find(c=>c.id==='env_legacy_and_canonical_same_snapshot')
    .initializerInvocations.old_status_valid=2;
  assert.equal(inspect(registry,r,trusted).classification,'INCOMPLETE');
});
test('hostile objects cannot supply credentials through throwing getters',()=>{
  const r=synthetic();
  Object.defineProperty(r,'status',{get(){throw Error('trap')}});
  assert.equal(inspect(registry,r,trusted).classification,'INVALID');
});
