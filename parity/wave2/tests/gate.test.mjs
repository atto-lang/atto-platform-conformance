import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadManifest,validateManifest,evaluateReport,BACKENDS,AREAS} from '../src/gate.mjs';

const SOURCE='1'.repeat(40),ADAPTER='2'.repeat(64);
const diagnostics={
 'capture-implicit-self-reject':'error: cannot capture self in implicit lexical closure',
 'ownership-live-loan-reject':'error: live borrow cannot cross await suspension',
 'effects-read-mutate-reject':'error: cannot mutate state through read-only state loan'
};
function report(manifest,backend='java',area=null){
 return {schemaVersion:1,backend,area,sourceCommit:SOURCE,adapterSha256:ADAPTER,
  observations:manifest.cases.filter(c=>c.targets[backend]==='candidate'&&(area===null||c.area===area)).map(c=>{
   const base={caseId:c.id,gitBlob:c.gitBlob,exitCode:c.mode==='reject'?1:0,
     phase:c.mode==='execute'?'guest-executed':c.mode==='reject'?'compiler-rejected':'compiler-accepted',
     stderr:c.mode==='reject'?diagnostics[c.id]:''};
   if(c.mode==='execute')base.observed=structuredClone(c.oracle);
   return base;
  })};
}
test('ten pinned source files cover exactly five categories',async()=>{
 const m=await loadManifest();
 assert.equal(m.cases.length,10);assert.deepEqual(m.backends,BACKENDS);
 assert.deepEqual(m.areas,AREAS);
 for(const area of AREAS)assert.equal(m.cases.filter(c=>c.area===area).length,2);
 for(const c of m.cases)assert.match(c.gitBlob,/^[a-f0-9]{40}$/);
});
test('independent integer oracle does not coerce i64 through binary64',()=>{
 assert.equal(9007199254740993n-9007199254740992n,1n);
 assert.notEqual(Number(9007199254740993n)-Number(9007199254740992n),1);
});
test('well-formed synthetic receipt only matches contract and never authenticates evidence',async()=>{
 const m=await loadManifest(),r=evaluateReport(m,report(m));
 assert.equal(r.consistent,true);assert.equal(r.matched,10);
 assert.equal(r.verified,false);assert.equal(r.semanticParityCertified,false);
 assert.equal(r.authenticityAttested,false);assert.match(r.note,/does not authenticate/);
});
test('all five backend selectors permit only the targeted numeric probes',async()=>{
 const m=await loadManifest();
 for(const b of BACKENDS){
  const r=evaluateReport(m,report(m,b,'numeric'));
  assert.equal(r.expected,2,b);
  assert.equal(r.consistent,true,b);
  assert.equal(r.verified,false,b);
 }
 assert.throws(()=>evaluateReport(m,report(m,'net','ownership')),/no candidate cases/);
});
test('compile acceptance never substitutes for executing source',async()=>{
 const m=await loadManifest(),x=report(m,'java','dispatch');
 x.observations[0].phase='compiler-accepted';delete x.observations[0].observed;
 assert.equal(evaluateReport(m,x).consistent,false);
});
test('an identical but incorrect dispatch result fails semantic oracle',async()=>{
 const m=await loadManifest(),x=report(m,'java','dispatch');
 x.observations[0].observed.value=42;
 const r=evaluateReport(m,x);
 assert.equal(r.consistent,false);assert.equal(r.matched,1);
});
test('diagnostic subjects and primary categories are mandatory',async()=>{
 const m=await loadManifest();
 for(const area of ['capture','ownership','effects']){
  for(const wrong of ['error: unexpected token','fatal: segfault','error: internal compiler error during borrow checking']){
   const x=report(m,'java',area);
   const c=x.observations.find(o=>o.phase==='compiler-rejected');
   c.stderr=wrong;
   assert.equal(evaluateReport(m,x).consistent,false,area+' '+wrong);
  }
 }
});
test('compiler crashes and suspicious statuses cannot masquerade as negative success',async()=>{
 const m=await loadManifest(),x=report(m,'java','effects');
 const rejected=x.observations.find(o=>o.phase==='compiler-rejected');
 rejected.exitCode=2;
 assert.equal(evaluateReport(m,x).consistent,false);
 rejected.exitCode=1;rejected.stderr='error: cannot mutate state through read-only state loan\ninternal compiler error';
 assert.equal(evaluateReport(m,x).consistent,false);
});
test('missing, duplicate and untargeted cases fail closed',async()=>{
 const m=await loadManifest();
 const missing=report(m,'java','numeric');missing.observations.pop();
 assert.equal(evaluateReport(m,missing).consistent,false);
 const duplicate=report(m,'java','numeric');duplicate.observations.push({...duplicate.observations[0]});
 assert.throws(()=>evaluateReport(m,duplicate),/duplicate/);
 const untargeted=report(m,'forge','numeric');
 untargeted.observations.push({...report(m,'java','capture').observations[0]});
 assert.throws(()=>evaluateReport(m,untargeted),/untargeted/);
});
test('manifest schema and source fingerprints reject tampering',async()=>{
 const m=await loadManifest();
 const mods=[
 x=>x.cases[0].gitBlob='0',
 x=>x.cases[0].targets.llvm='verified',
 x=>x.cases[0].oracle.value=Number.MAX_SAFE_INTEGER+1,
 x=>x.cases[0].file='../escape.ores',
 x=>x.cases[0].id=x.cases[1].id,
 x=>x.cases.pop(),
 x=>x.cases[0].oracle.extra='secret'
 ];
 for(const modify of mods){
  const copy=structuredClone(m);modify(copy);
  assert.throws(()=>validateManifest(copy),/wave2:/);
 }
 const r=report(m);r.observations[0].gitBlob='a'.repeat(40);
 assert.throws(()=>evaluateReport(m,r),/source/);
});
test('invalid source revisions and unknown keys are denied',async()=>{
 const m=await loadManifest(),r=report(m);
 r.sourceCommit='HEAD';assert.throws(()=>evaluateReport(m,r),/identity/);
 r.sourceCommit=SOURCE;r.trusted=true;
 assert.throws(()=>evaluateReport(m,r),/unexpected/);
});
test('CLI validates checked-in source without claiming compiler execution',()=>{
 const cli=new URL('../bin/check-wave2.mjs',import.meta.url).pathname;
 const a=spawnSync(process.execPath,[cli,'--manifest-only'],{encoding:'utf8'});
 assert.equal(a.status,0,a.stderr);assert.match(a.stdout,/"verified": false/);
 const b=spawnSync(process.execPath,[cli,'--manifest-only','--manifest-only'],{encoding:'utf8'});
 assert.equal(b.status,2);
});
