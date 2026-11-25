import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {BACKENDS,load,validate} from '../bin/manifest.mjs';
test('six exact Git source identities, all five tasks and backend selectors',async()=>{
 const manifest=await load();
 assert.equal(manifest.sourceCases.length,6);
 assert.deepEqual(manifest.tasks.map(x=>x.id),[16,17,18,19,20]);
 assert.deepEqual(manifest.backends,BACKENDS);
 for(const c of manifest.sourceCases)assert.equal(c.verified,false);
});
test('false parity promotion is denied',async()=>{
 const manifest=await load();manifest.certifiedParity=true;
 assert.throws(()=>validate(manifest),/false proof claim/);
});
test('missing source backend is rejected',async()=>{
 const m=await load();m.backends.pop();
 assert.throws(()=>validate(m),/backend inventory/);
});
test('duplicate fixture, wrong path and forged SHA denied',async()=>{
 for(const edit of [m=>m.sourceCases[1].id=m.sourceCases[0].id,m=>m.sourceCases[0].file='../escape.ores',m=>m.sourceCases[0].gitBlob='0',m=>m.sourceCases[0].verified=true]){
  const m=structuredClone(await load());edit(m);
  assert.throws(()=>validate(m),/wave4 manifest:/);
 }
});
test('must retain all five task categories, exactly one rejection and execution oracle',async()=>{
 const m=await load();m.sourceCases[1].task=17;
 assert.throws(()=>validate(m),/coverage/);
 const n=await load();n.sourceCases[1].mode='admit';
 assert.throws(()=>validate(n),/coverage/);
});
test('CLI is contract-only, no undocumented success flags',()=>{
 const path=new URL('../bin/manifest.mjs',import.meta.url).pathname;
 const ok=spawnSync(process.execPath,[path,'--validate'],{encoding:'utf8'});
 assert.equal(ok.status,0,ok.stderr);const data=JSON.parse(ok.stdout);
 assert.equal(data.status,'CONTRACT_VALID_ONLY');
 assert.equal(data.compilerExecuted,false);
 assert.equal(data.verified,false);
 const bad=spawnSync(process.execPath,[path,'--require-parity'],{encoding:'utf8'});
 assert.equal(bad.status,2);
});
