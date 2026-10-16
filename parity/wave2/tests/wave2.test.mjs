import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadManifest,validateManifest,primaryDiagnostic,runWave2,BACKENDS,TASKS} from '../src/wave2.mjs';
const sourceSha='a'.repeat(40);
const command=[process.execPath,'{file}'];
const diagnostic={
 'value-int-division-reject.ores':'error: type mismatch: int / int returns float',
 'dispatch-nonexhaustive-reject.ores':'error: non-exhaustive match',
 'capture-implicit-self-reject.ores':'error: self not captured by lambda',
 'capture-escaping-self-reject.ores':'error: borrowed self cannot escape from closure',
 'ownership-loan-escape-reject.ores':'error: state loan escapes callback',
 'effects-read-mutate-reject.ores':'error: read-only capability cannot write',
 'effects-loan-suspend-reject.ores':'error: state loan cannot cooperate'
};
const values={'value-i64-evaluation.ores':'76','dispatch-value-match.ores':'43','dispatch-do-match.ores':'42','capture-allowlist-execution.ores':'79'};
function mock(_binary,args){
 const id=args.at(-1).split('/').at(-1);
 if(id in diagnostic)return {status:1,stdout:'',stderr:diagnostic[id]};
 if(id in values)return {status:0,stdout:JSON.stringify({result:values[id]}),stderr:''};
 return {status:0,stdout:'',stderr:''};
}
test('manifest has 5 tasks and 13 genuine Git-object-pinned fixtures',async()=>{
 const m=await loadManifest();
 assert.equal(m.cases.length,13);
 assert.deepEqual(m.backends,BACKENDS);
 assert.deepEqual(m.tasks.map(t=>t.id),[6,7,8,9,10]);
 for(const c of m.cases)assert.equal(c.verified,false);
 for(const t of m.tasks){
  const cases=m.cases.filter(c=>c.task===t.id);
  assert.ok(cases.some(c=>c.mode==='reject'));
  assert.ok(cases.some(c=>c.mode!=='reject'));
 }
});
test('adversarial metadata cannot invent backend certification',async()=>{
 const m=await loadManifest();
 for(const mutation of [
  x=>x.backends.pop(),x=>x.tasks[0].id=9,x=>x.cases[0].verified=true,
  x=>x.cases[0].gitBlob='0'.repeat(40),x=>x.cases[0].id=x.cases[1].id,
  x=>x.cases[0].candidates=['browser'],x=>x.cases[0].mode='reject',
  x=>x.cases[1].diagnostic='unknown',x=>x.cases.pop()
 ]){
  const copy=structuredClone(m);mutation(copy);
  assert.throws(()=>validateManifest(copy),/wave2:/);
 }
});
test('no configured compiler yields explicit UNCONFIGURED, never success',async()=>{
 for(const backend of BACKENDS){
  const r=await runWave2({backend});
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.parityVerified,false);
  assert.ok(r.results.some(c=>c.status==='UNCONFIGURED'||c.status==='UNSUPPORTED'));
 }
});
test('fake adapters validate runner plumbing without certifying runtime',async()=>{
 const r=await runWave2({backend:'java',checkArgv:command,executeArgv:command,sourceSha,spawn:mock});
 assert.equal(r.observedPass,13);
 assert.equal(r.ok,true);
 assert.equal(r.verified,false);
 assert.equal(r.parityVerified,false);
 assert.equal(r.provenanceVerified,false);
 assert.ok(r.results.every(x=>x.status==='OBSERVED_PASS'));
});
test('backend candidate selection cannot treat unsupported source as a negative test',async()=>{
 const r=await runWave2({backend:'forge',checkArgv:command,executeArgv:command,sourceSha,spawn:mock,requireAll:true});
 assert.equal(r.ok,false);
 assert.ok(r.results.some(x=>x.status==='UNSUPPORTED'));
 assert.equal(r.verified,false);
});
test('value and procedural match produce distinct guest result oracles',async()=>{
 for(const [file,value] of [['dispatch-value-match','43'],['dispatch-do-match','42']]){
  const result=await runWave2({backend:'java',task:7,checkArgv:command,executeArgv:command,sourceSha,spawn:(binary,args)=>{
   const id=args.at(-1).split('/').at(-1);
   if(id===file+'.ores')return {status:0,stdout:JSON.stringify({result:value==='43'?'42':'43'}),stderr:''};
   return mock(binary,args);
  }});
  assert.equal(result.ok,false);
  assert.equal(result.results.find(x=>x.id===file).status,'MISMATCH');
 }
});
test('primary rejection must identify the right semantic reason, not an unrelated parser error',()=>{
 for(const cat of ['type-mismatch','nonexhaustive','self-capture','receiver-borrow','state-loan','read-mutate','loan-suspend']){
  assert.equal(primaryDiagnostic('error: unexpected token near a source echo',cat),false,cat);
  assert.equal(primaryDiagnostic('warning: state loan cannot cooperate',cat),false,cat);
 }
 assert.equal(primaryDiagnostic('error: state loan cannot cooperate','loan-suspend'),true);
 assert.equal(primaryDiagnostic('error: read-only capability cannot write','read-mutate'),true);
});
test('negative compilation crashes and nonstandard exit codes are not accepted',async()=>{
 for(const outcome of [
  {status:2,stdout:'',stderr:'error: non-exhaustive match'},
  {status:null,signal:'SIGSEGV',stdout:'',stderr:'error: non-exhaustive match'},
  {status:null,error:{code:'ETIMEDOUT'},stdout:'',stderr:''},
  {status:0,stdout:'',stderr:'error: non-exhaustive match'}
 ]){
  const r=await runWave2({backend:'java',task:7,checkArgv:command,executeArgv:command,sourceSha,
   spawn:(binary,args)=>args.at(-1).endsWith('dispatch-nonexhaustive-reject.ores')?outcome:mock(binary,args)});
  assert.equal(r.ok,false);
 }
});
test('runtime JSON requires an exact signed-decimal result and no extraneous fields',async()=>{
 for(const raw of ['42','{"result":42}','{"result":"43","verified":true}','{"result":"43"}\nextra']){
  const r=await runWave2({backend:'java',task:7,checkArgv:command,executeArgv:command,sourceSha,
   spawn:(binary,args)=>args.at(-1).endsWith('dispatch-value-match.ores')?{status:0,stdout:raw,stderr:''}:mock(binary,args)});
  assert.equal(r.ok,false,raw);
 }
});
test('CLI rejects duplicate arguments and unconfigured success',()=>{
 const cli=new URL('../bin/wave2.mjs',import.meta.url).pathname;
 const x=spawnSync(process.execPath,[cli,'--backend=java'],{encoding:'utf8'});
 assert.equal(x.status,3);
 assert.match(x.stdout,/UNCONFIGURED/);
 const y=spawnSync(process.execPath,[cli,'--backend=java','--backend=llvm'],{encoding:'utf8'});
 assert.equal(y.status,2);
});
