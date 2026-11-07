import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {inspectUntrustedGuestTraceBundle} from './guest-trace-intake.mjs';
const m=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url),'utf8'));
const bytes=readFileSync(new URL('./reliable-join-receive.atto',import.meta.url));
const E=(scenario,events)=>({schema:'attolang.formal.actor-trace.v1',scenario,events});
function bundle(){return {
 schema:'attolang.formal.untrusted-trace-bundle.v1',
 backend:'java',
 fixtureBlobSha:'fe10d9e5018a3f030a10bc31586e851198aaa4a3',
 traces:[
 E('critical-generation',[
  {op:'critical_enter',actor:'a',gen:1,task:'one',mode:'read'},
  {op:'critical_exit',actor:'a',gen:1,task:'one'},
  {op:'suspend',actor:'a',gen:1,task:'one'},
  {op:'resume',actor:'a',gen:1,task:'one'},
  {op:'retire',actor:'a',gen:1},
  {op:'restart',actor:'a',gen:1},
  {op:'stale_permit_denied',actor:'a',gen:2,permitGen:1,task:'one'}
 ]),
 E('panic-control',[
  {op:'data_enqueue',actor:'a',gen:1,message:'ready'},
  {op:'deliver_data',actor:'a',gen:1,message:'ready'},
  {op:'data_enqueue',actor:'a',gen:1,message:'pending'},
  {op:'panic',actor:'a',gen:1},
  {op:'control_notice',actor:'a',gen:1},
  {op:'discard_data',actor:'a',gen:1,message:'pending'}
 ]),
 E('reliable-pubsub',[
  {op:'join',sub:'s',gen:1},
  {op:'publish_request',sub:'s',gen:1,publisher:'p',sequence:1},
  {op:'publish_admit',sub:'s',gen:1,publisher:'p',sequence:1},
  {op:'ack',sub:'s',gen:1,publisher:'p',sequence:1},
  {op:'deliver',sub:'s',gen:1,publisher:'p',sequence:1},
  {op:'leave',sub:'s',gen:1},
  {op:'close_group'}
 ])
]};}
function denied(change,label){
 test('rejects unauthenticated bundle: '+label,()=>{
  const b=structuredClone(bundle());const manifest=structuredClone(m);
  const input=change(b,manifest)||{};
  assert.throws(()=>inspectUntrustedGuestTraceBundle(b,{
    manifest,fixtureBytes:input.fixtureBytes??bytes
  }));
 });
}
test('intake accepts exactly three bounded shapes but NEVER authenticates guest',()=>{
 const output=inspectUntrustedGuestTraceBundle(bundle(),{manifest:m,fixtureBytes:bytes});
 assert.deepEqual(output,{
  classification:'UNAUTHENTICATED_TRACE_SHAPE_ONLY',backend:'java',
  candidateSourceBlob:'fe10d9e5018a3f030a10bc31586e851198aaa4a3',
  designScenariosChecked:3,sourceOrgRunnerAuthenticated:false,
  compiledGuestAuthenticated:false,runtimeAuthenticated:false,
  fiveBackendParity:false,mergeEligible:false
 });
});
denied(b=>b.backend='node', 'fake backend label');
denied(b=>b.fixtureBlobSha='0'.repeat(40), 'fixture blob mismatch');
denied(b=>b.traces.pop(), 'missing scenario');
denied(b=>b.traces[2]=b.traces[0], 'duplicate scenario');
denied(b=>b.traces[0].scenario='other', 'unrecognized scenario');
denied(b=>b.traces[2].events.splice(1,1), 'publish admission with no request');
denied(b=>b.traces[1].events.splice(4,1), 'CONTROL notification missing');
denied(b=>b.traces[0].events.splice(3,1), 'suspension not resumed');
denied(b=>b.attested=true, 'self-attested flag is prohibited');
denied(b=>b.runId=123, 'self-reported workflow run field is prohibited');
denied((b,manifest)=>manifest.backends.java.status='EXECUTED','promoted manifest without provider evidence');
denied((b,manifest)=>manifest.requiredAuthentication=[], 'weakened authentication obligation');
denied(()=>({fixtureBytes:Buffer.from('forged source')}), 'candidate source replaced');
denied(b=>b.traces[1].events[0].message='', 'invalid queue message identity');
denied(b=>b.traces[1].events[5].message='not-queued', 'unaccounted queue discard');
denied(b=>b.traces[2].events[3].sequence=2, 'unadmitted ack');
denied(b=>b.traces.reverse().push(undefined), 'extra trace');
test('backend identity is a label only; no backend receives authenticated status',()=>{
 for(const name of ['java','llvm','net','wasm','forge']){
  const b=bundle();b.backend=name;
  const result=inspectUntrustedGuestTraceBundle(b,{manifest:m,fixtureBytes:bytes});
  assert.equal(result.backend,name);
  assert.equal(result.compiledGuestAuthenticated,false);
  assert.equal(result.sourceOrgRunnerAuthenticated,false);
 }
});
test('CLI fails closed without an explicit trace file',()=>{
 const x=spawnSync(process.execPath,[new URL('./guest-trace-intake.mjs',import.meta.url).pathname],{encoding:'utf8'});
 assert.equal(x.status,2);
 assert.match(x.stderr,/Usage:/);
});
test('CLI accepts a synthetic bundle ONLY as unauthenticated shape',()=>{
 const dir=mkdtempSync(join(tmpdir(),'atto-untrusted-shape-'));
 try{
  const file=join(dir,'trace.json');writeFileSync(file,JSON.stringify(bundle()));
  const x=spawnSync(process.execPath,[new URL('./guest-trace-intake.mjs',import.meta.url).pathname,'--trace-file',file],{encoding:'utf8'});
  assert.equal(x.status,0,x.stderr);
  const result=JSON.parse(x.stdout);
  assert.equal(result.classification,'UNAUTHENTICATED_TRACE_SHAPE_ONLY');
  assert.equal(result.compiledGuestAuthenticated,false);
  assert.equal(result.mergeEligible,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI rejects oversized traces before JSON parsing or replay',()=>{
 const dir=mkdtempSync(join(tmpdir(),'atto-oversize-shape-'));
 try{
  const file=join(dir,'trace.json');writeFileSync(file,' '.repeat(65537));
  const x=spawnSync(process.execPath,[new URL('./guest-trace-intake.mjs',import.meta.url).pathname,'--trace-file',file],{encoding:'utf8'});
  assert.equal(x.status,1);
  assert.match(x.stderr,/trace file too large/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
