import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessNioActorEvidence, nioActorBackends, nioActorRequiredVectors} from '../tools/verify-nio-actor-parity-v1.mjs';

const manifest = JSON.parse(readFileSync(new URL('../contracts/v1/nio-actor-parity-v1.json', import.meta.url), 'utf8'));
const head = 'a'.repeat(40), tree = 'b'.repeat(40);
const pin = (backend='java') => ({backend,repository:manifest.repositories[backend],head_sha:head,tree_sha:tree,required_vectors:[...nioActorRequiredVectors]});
const good = (backend='java') => ({
  backend,repository:manifest.repositories[backend],head_sha:head,tree_sha:tree,
  site:'source-org',scope:'private-source-compiler-runtime',host:'node',raw_tcp:'unsupported',
  run:{id:123,attempt:1,head_sha:head,repository:manifest.repositories[backend],status:'completed',conclusion:'success'},
  jobs:[{id:456,run_id:123,attempt:1,status:'completed',conclusion:'success',runner_id:42,runner_name:'runner-42',steps:[
    {number:1,name:'Compile Oreslang guest source',status:'completed',conclusion:'success'},
    {number:2,name:'Execute compiled Oreslang guest',status:'completed',conclusion:'success'}
  ]}],
  review:{reviewer:'ORESoftware',author:'the1mills',head_sha:head,state:'APPROVED',review_id:778},
  compiler:{commit:'c'.repeat(40)},artifact:{sha256:'sha256:'+'d'.repeat(64),source_sha:head},
  vectors:nioActorRequiredVectors.map(id => ({id,outcome:'pass',guest_executed:true,job_id:456}))
});
const classify = (e,p=pin(e.backend)) => assessNioActorEvidence(e,p).classification;

test('five source backends have exact, distinct identities',()=>{
  assert.equal(manifest.schema,'oreslang.nio-actor-parity/1');
  assert.equal(manifest.status,'normative_target_not_execution_evidence');
  assert.deepEqual(manifest.backends,['java','llvm','wasm','cranelift','net']);
  assert.deepEqual(manifest.backends,nioActorBackends);
  for (const backend of manifest.backends)
    assert.equal(manifest.repositories[backend],'ores-truffle-oreslang/oreslang-source.'+backend);
  assert.equal(new Set(Object.values(manifest.repositories)).size,5);
});
test('mandatory source-free safety and runner clauses are present',()=>{
  assert.deepEqual(manifest.requiredVectors,nioActorRequiredVectors);
  for (const v of ['nio_cancel_before_ready','nio_descriptor_reuse_aba','nio_no_guest_on_reactor',
    'actor_same_actor_single_flight','actor_two_actor_physical_overlap','actor_control_progress_under_saturation'])
    assert.ok(manifest.requiredVectors.includes(v));
  assert.ok(Object.values(manifest.evidenceBoundary).every(x=>x===true));
});
for (const backend of nioActorBackends) {
  test(backend+': nominal guest receipts never self-certify',()=>{
    assert.equal(classify(good(backend),pin(backend)),'EXECUTION_REVIEW_REQUIRED');
  });
}
const mutations = [
  ['zero-step admission',e=>{e.jobs[0].steps=[]},'ADMISSION_FAILURE'],
  ['unassigned runner',e=>{e.jobs[0].runner_id=0},'ADMISSION_FAILURE'],
  ['queued steps only',e=>{e.jobs[0].steps.forEach(x => x.status='queued')},'ADMISSION_FAILURE'],
  ['housekeeping only',e=>{e.jobs[0].steps.forEach(x => x.name='Set up job')},'ADMISSION_FAILURE'],
  ['no runner name',e=>{e.jobs[0].runner_name=''},'ADMISSION_FAILURE'],
  ['source-free-only receipt',e=>{e.scope='source-free'},'SOURCE_FREE_ONLY'],
  ['unapproved alternative source destination',e=>{e.site='alternative-org'},'UNVERIFIED'],
  ['wrong head',e=>{e.head_sha='e'.repeat(40)},'UNVERIFIED'],
  ['wrong tree',e=>{e.tree_sha='e'.repeat(40)},'UNVERIFIED'],
  ['unbound workflow head',e=>{e.run.head_sha='e'.repeat(40)},'UNVERIFIED'],
  ['missing review',e=>{delete e.review},'UNVERIFIED'],
  ['self-approval',e=>{e.review.author='ORESoftware'},'UNVERIFIED'],
  ['stale approval',e=>{e.review.head_sha='e'.repeat(40)},'UNVERIFIED'],
  ['zero review ID',e=>{e.review.review_id=0},'UNVERIFIED'],
  ['missing guest executable receipt',e=>{e.vectors.pop()},'UNVERIFIED'],
  ['unexecuted guest vector',e=>{e.vectors[0].guest_executed=false},'UNVERIFIED'],
  ['duplicate vector',e=>{e.vectors[1].id=e.vectors[0].id},'UNVERIFIED'],
  ['foreign job',e=>{e.vectors[1].job_id=999},'UNVERIFIED'],
  ['missing compile step',e=>{e.jobs[0].steps[0].name='shell placeholder'},'UNVERIFIED'],
  ['duplicate compile step',e=>{e.jobs[0].steps[1].name='Compile Oreslang guest source'},'UNVERIFIED'],
  ['duplicate step number',e=>{e.jobs[0].steps[1].number=1},'UNVERIFIED'],
  ['missing artifact digest',e=>{e.artifact.sha256=''},'UNVERIFIED'],
  ['failed executed guest',e=>{e.vectors[0].outcome='fail'},'EXECUTED_TEST_FAILURE'],
  ['unsupported needs reason',e=>{e.vectors[0].outcome='unsupported'},'UNVERIFIED'],
  ['unsupported with reason',e=>{e.vectors[0].outcome='unsupported';e.vectors[0].reason='no host TCP capability'},'PARTIAL_SUPPORT_REVIEW_REQUIRED'],
  ['browser WASM raw TCP unsupported',e=>{e.host='browser';e.raw_tcp='supported'},'UNVERIFIED']
];
for (const [name,mutate,want] of mutations) {
  test('fail-closed: '+name,()=>{
    const e=good('wasm');mutate(e);
    assert.equal(classify(e,pin('wasm')),want);
  });
}
test('trusted vector inventory cannot be reduced by supplied receipt',()=>{
  const p=pin();p.required_vectors.pop();
  assert.equal(classify(good(),p),'UNVERIFIED');
});
