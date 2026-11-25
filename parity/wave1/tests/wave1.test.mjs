import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {loadCatalog,validateCatalog,validateInvocation,runWave1,BACKENDS,CATEGORIES} from '../src/wave1.mjs';
const sha='1'.repeat(40);
const fakeCommand=[process.execPath,'{file}'];
const fake=(exe,args)=>{
  const id=args.at(-1).split('/').at(-1);
  if(id.endsWith('accept.ores'))return {status:0,stdout:'',stderr:''};
  if(id==='scalar-reject.ores')return {status:1,stdout:'',stderr:'error: unresolved identifier nonexistent_symbol'};
  if(id==='scope-reject.ores')return {status:1,stdout:'',stderr:'error: unknown name unknown_scope_name'};
  if(id==='grammar-reject.ores')return {status:1,stdout:'',stderr:'error: unexpected token'};
  if(id==='types-reject.ores')return {status:1,stdout:'',stderr:'error: expected 1 argument but received 2'};
  throw Error('unknown fixture '+id);
};
test('ledger includes all five backends and paired fixtures in each wave-one category',async()=>{
  const cat=await loadCatalog();
  assert.equal(cat.features.length,10); assert.equal(cat.cases.length,8);
  assert.deepEqual(cat.backends,BACKENDS);
  for(const category of CATEGORIES)assert.deepEqual(cat.cases.filter(x=>x.feature===category).map(x=>x.expect),['accept','reject']);
  for(const feature of cat.features)for(const backend of BACKENDS)assert.equal(feature.verified[backend],false);
});
test('schema rejects fabricated certification, unknown backend and broken pairs',async()=>{
  const cat=await loadCatalog();
  for(const mutate of [
    x=>x.features[0].verified.java=true,
    x=>x.backends.pop(),
    x=>x.cases.pop(),
    x=>x.cases[0].sha256='0',
    x=>x.cases[0].id=x.cases[1].id,
    x=>x.cases[0].targets=['java'],
    x=>x.features[0].implementation.forge='verified'
  ]){
    const copy=structuredClone(cat); mutate(copy);
    assert.throws(()=>validateCatalog(copy),/wave1:/);
  }
});
test('unconfigured every backend remains explicitly not verified',async()=>{
  for(const backend of BACKENDS){const r=await runWave1({backend});assert.equal(r.ok,false);assert.equal(r.verified,false);assert.equal(r.results.length,8);assert.ok(r.results.every(x=>x.status==='UNCONFIGURED'));}
});
test('observed fake responses exercise only runner plumbing and never prove provenance',async()=>{
  const r=await runWave1({backend:'java',argv:fakeCommand,sourceSha:sha,spawn:fake});
  assert.equal(r.ok,true);assert.equal(r.results.length,8);assert.equal(r.verified,false);assert.equal(r.parityVerified,false);assert.equal(r.provenanceVerified,false);
  assert.ok(r.results.every(x=>x.status==='OBSERVED_PASS'));
});
test('an invalid source rejection must be categorized, not merely nonzero',async()=>{
  const r=await runWave1({backend:'llvm',category:'types',argv:fakeCommand,sourceSha:sha,spawn:()=>({status:1,stdout:'',stderr:'error: unsupported source'})});
  assert.equal(r.ok,false);
  assert.equal(r.results.find(x=>x.id==='types-reject').status,'MISMATCH');
});
test('crash, bad exit, error-on-success, and timeout cannot prove admission',async()=>{
  for(const output of [
    {status:2,stdout:'',stderr:'error: expected parameter'},
    {status:null,signal:'SIGSEGV',stdout:'',stderr:'error: unexpected token'},
    {status:0,stdout:'',stderr:'error: parser error'},
    {status:null,error:{code:'ETIMEDOUT'},stdout:'',stderr:''}
  ]){
    const r=await runWave1({backend:'forge',category:'grammar',argv:fakeCommand,sourceSha:sha,spawn:()=>output});
    assert.equal(r.ok,false); assert.equal(r.verified,false);
  }
});
test('invalid commands and missing source SHA fail closed',async()=>{
  for(const [argv,s] of [[['node','{file}'],sha],[[process.execPath,'{file}','{file}'],sha],[fakeCommand,'short']])assert.throws(()=>validateInvocation(argv,s),/wave1:/);
  await assert.rejects(runWave1({backend:'bogus'}),/wave1:/);
});
test('CLI refuses to call unconfigured run a pass and rejects duplicate selectors',()=>{
  const cli=new URL('../bin/wave1.mjs',import.meta.url).pathname;
  const unconfigured=spawnSync(process.execPath,[cli,'--backend=java'],{encoding:'utf8'});
  assert.equal(unconfigured.status,3);
  assert.match(unconfigured.stdout,/UNCONFIGURED/);
  const dup=spawnSync(process.execPath,[cli,'--backend=java','--backend=llvm'],{encoding:'utf8'});
  assert.equal(dup.status,2);
});
test('ledger exposes source fixture hashes for provenance checks',async()=>{
  const c=await loadCatalog();
  for(const f of c.cases)assert.match(f.sha256,/^[0-9a-f]{64}$/);
  const raw=await readFile(new URL('../manifest.json',import.meta.url),'utf8');
  assert.equal(JSON.parse(raw).policy,'reported-status-is-not-execution-evidence');
});
