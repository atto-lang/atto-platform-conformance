// Host-only receipt-shape abuse cases. Passing these tests is NOT guest evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {evaluateConstantImportEvidence as inspect, constantImportCaseSha256} from '../lib/constant-import-evidence-v1.mjs';

const registry = JSON.parse(readFileSync(new URL('../contracts/constant-imports-v1.json', import.meta.url), 'utf8'));
const trusted = {sourceCommit:'a'.repeat(40),sourceTree:'b'.repeat(40),registryBlobSha:'d'.repeat(40),jobId:123,compilerSha256:'c'.repeat(64),toolchainVersion:'synthetic-compiler-v1',target:'wasm32-test'};
const digest = 'c'.repeat(64);
function synthetic() {
  return {
    schema:'atto.constant-import-evidence.v1',
    backend:'rs-browser',
    status:'PASSED',
    sourceCommit:trusted.sourceCommit,
    sourceTree:trusted.sourceTree,
    compilerSha256:digest,registryBlobSha:trusted.registryBlobSha,
    toolchainVersion:trusted.toolchainVersion,target:trusted.target,
    job:{id:trusted.jobId,runner:'hypothetical-source-runner',mode:'source-org',
      sourceFree:false,steps:['checkout','compile','guest'].map(name=>({name,conclusion:'success'}))},
    cases:registry.cases.map(c=>c.kind==='pass' ? {
      id:c.id,status:'PASSED',fixtureManifestSha256:constantImportCaseSha256(c),compileExit:0,emittedArtifacts:1,
      artifactSha256:digest,guestEntrypointRan:true,guestReturn:c.expected_return,
      diagnosticCode:null,
      ...(c.startups?{startups:c.startups.map(s=>({
        artifactSha256:digest,guestEntrypointRan:true,guestReturn:s.expected_return
      }))}:{}),
      ...(c.expected_initializer_invocations?{
        initializerInvocations:structuredClone(c.expected_initializer_invocations)
      }:{})
    } : {
      id:c.id,status:'PASSED',fixtureManifestSha256:constantImportCaseSha256(c),compileExit:1,emittedArtifacts:0,
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

test('only four execution statuses can be declared; nonpassing cannot certify parity',()=>{
  for(const status of ['FAILED','UNSUPPORTED','NOT_EXECUTED']){
    const r=synthetic();r.status=status;
    const result=inspect(registry,r,trusted);
    assert.equal(result.classification,status);
    assert.equal(result.releaseQualified,false);
  }
  const r=synthetic();r.status='EXECUTED';
  assert.equal(inspect(registry,r,trusted).classification,'INVALID');
});
test('fixture manifest digests bind exact .atto source and expected launch inputs',()=>{
  const r=synthetic();r.cases[0].fixtureManifestSha256='e'.repeat(64);
  assert.equal(inspect(registry,r,trusted).classification,'INCOMPLETE');
  const actual=registry.cases[0];
  assert.notEqual(constantImportCaseSha256(actual),
    constantImportCaseSha256({...actual,files:{...actual.files,'app.atto':actual.files['app.atto']+' '}}));
});
test('compiler digest/version, target and registry blob must match independent selector',()=>{
  for(const [key,value,classification] of [
    ['compilerSha256','e'.repeat(64),'TOOLCHAIN_MISMATCH'],
    ['toolchainVersion','different-version','TOOLCHAIN_MISMATCH'],
    ['target','different-target','TOOLCHAIN_MISMATCH'],
    ['registryBlobSha','e'.repeat(40),'SOURCE_MISMATCH']
  ]){
    const r=synthetic();r[key]=value;
    assert.equal(inspect(registry,r,trusted).classification,classification,key);
  }
});
test('negative compiler proof cannot claim a guest return value',()=>{
  const r=synthetic();r.cases.find(c=>c.id==='private_export').guestReturn=1;
  assert.equal(inspect(registry,r,trusted).classification,'INCOMPLETE');
});
