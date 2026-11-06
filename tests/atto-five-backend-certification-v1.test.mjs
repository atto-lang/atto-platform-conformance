import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,symlinkSync,linkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCandidate,evaluateCandidate,toMarkdown} from '../tools/atto-five-backend-certification-v1.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=join(root,'evidence/atto-five-backend-release-candidate-v1.json');
const ledger=join(root,'evidence/landed-main-20261106-platform-wave.json');
const cli=join(root,'bin/atto-five-backend-certification-v1.mjs');
const load=()=>JSON.parse(readFileSync(manifest,'utf8'));
const loadedLedger=()=>JSON.parse(readFileSync(ledger,'utf8'));
const mutate=(fn)=>{const v=load();fn(v);return v;};
function denied(label,fn){
 test(label,()=>assert.throws(()=>validateCandidate(mutate(fn)),TypeError));
}
function receipt(b,kind,c=null){
 const v={repo:b.repo,source_commit_sha:b.source.commit_sha,source_tree_sha:b.source.tree_sha,
   compiler_binary_sha256:b.compiler.binary_sha256,
   kind,run_id:101,run_attempt:1,job_id:202,runner_id:303,
   status:'completed',conclusion:'success',artifact_sha256:'d'.repeat(64),
   steps:[{name:'Execute real compiler guest',status:'completed',conclusion:'success'}]};
 if(kind==='aot')return {...v,executable_sha256:'e'.repeat(64),fully_aot:true,jit_disabled:true};
 if(kind==='formal')return {...v,model_sha256:'e'.repeat(64),properties_checked:3,counterexamples:0};
 if(kind==='memory')return {...v,metrics:{samples:10,gc_collections:0}};
 return {...v,contract_id:c.id,fixture_blob_sha:c.oracle.fixture_blob_sha,
   output:{exit_code:c.oracle.expected_exit_code,stdout_hex:c.oracle.expected_stdout_hex,crashed:false}};
}
function withReportedScalar(s,backend=0,caseIndex=0){
 const b=s.backends[backend],c=s.contracts[caseIndex];
 b.compiler.binary_sha256='a'.repeat(64);
 b.compiler.build_receipt=receipt(b,'aot');
 b.guest[caseIndex]={contract_id:c.id,state:'REPORTED_PASS',receipt:receipt(b,'guest',c)};
 return {b,c};
}
test('true five-backend source identities are present with their pinned Git trees',()=>{
 const s=load();assert.equal(validateCandidate(s),true);
 const expected={
  java:['1a7d55e21fd647f1ba56f3877ebe6d16a0b4326b','514573d34a6d224fd9f184faedde1d5dbc142d99'],
  llvm:['8c214409625be8a99865b79d8bb89e5aaad2c814','28a41dc9b3b2c08dd4f71273ef2bc8cd3a06e3ea'],
  wasm:['e2570d8664cc4782d8147b638d4a1c359eeacc82','a17d46c817dd8b4fb0ee1bdd7bd204758ea13749'],
  forge:['7902eb2e3610babe1004a3e752b12079737992e6','8f4299bbbb1c05fe59bfb47b8918ce73630c252a'],
  net:['5d8246bca843309ee3f66538f1385fefb5690858','13c7f33332879cd88c31a473bd2742f98d5074ae']
 };
 for(const b of s.backends)
  assert.deepEqual([b.source.commit_sha,b.source.tree_sha],expected[b.id]);
});
test('all five backend and four draft contracts produce 20 NOT_EXECUTED guest cells',()=>{
 const r=evaluateCandidate(load(),loadedLedger());
 assert.equal(r.backend_count,5);assert.equal(r.contract_count,4);
 assert.equal(r.status,'BLOCKED');assert.equal(r.release_authorized,false);
 assert.equal(r.postmerge.blocked,5);
 assert.deepEqual(new Set(r.backends.map(b=>b.id)),new Set(['java','llvm','wasm','forge','net']));
 for(const b of r.backends){
  assert.equal(Object.keys(b.guest).length,4);
  assert(Object.values(b.guest).every(x=>x==='NOT_EXECUTED'));
  assert.deepEqual([b.formal,b.aot,b.memory],['NOT_EXECUTED','NOT_EXECUTED','NOT_EXECUTED']);
  assert(b.blockers.includes('MAIN_UNPROTECTED'));
  assert(b.blockers.includes('COMPILER_BINARY_NOT_VERIFIED'));
 }
});
test('proposed contract roots and single-fixture outputs are identity-pinned',()=>{
 const s=load();
 const scalar=s.contracts.find(x=>x.id==='scalar-exit-42-v1');
 assert.equal(scalar.oracle.fixture_blob_sha,'4e2e7e853e37eb10e4d6ec45b3d18127a555900a');
 assert.deepEqual([scalar.oracle.expected_exit_code,scalar.oracle.expected_stdout_hex],[42,'']);
 const dop=s.contracts.find(x=>x.id==='dop-scalar-guest-v1');
 assert.equal(dop.oracle.fixture_blob_sha,'aedc778e3e8dd2940600f047540c159b0129830a');
 assert.deepEqual([dop.oracle.expected_exit_code,dop.oracle.expected_stdout_hex],[0,'']);
 const suites=s.contracts.filter(x=>x.oracle.type==='suite_pending');
 assert.deepEqual(suites.map(x=>x.id),['actor-channel-v1','portable-task-v1']);
});
test('human-readable report prominently denies certification',()=>{
 const output=toMarkdown(evaluateCandidate(load(),loadedLedger()));
 assert.match(output,/NOT CERTIFIED/);
 assert.match(output,/BLOCKED/);
 assert.match(output,/scalar-exit-42-v1/);
 assert.match(output,/actor-channel-v1/);
 assert.match(output,/CONTRACT_SUITE_ORACLES_NOT_NORMALIZED/);
 assert.match(output,/NOT_EXECUTED/);
});
denied('reject missing fifth backend',s=>s.backends.pop());
denied('reject sixth or duplicate backend',s=>s.backends.push(structuredClone(s.backends[0])));
denied('reject repo namespace substitution',s=>s.backends[2].repo='foreign/oreslang-source.wasm');
denied('reject missing source Git tree',s=>s.backends[1].source.tree_sha=null);
denied('reject malformed source head',s=>s.backends[1].source.commit_sha='123');
denied('reject unknown protected main value',s=>s.backends[1].source.main_protected='yes');
denied('reject target false AOT claim',s=>s.backends[1].targets.aot_target='fully-verified');
denied('reject near-zero GC becoming falsely certified target',s=>s.backends[0].targets.memory_target='all-gc-verified');
denied('reject missing contract',s=>s.contracts.pop());
denied('reject duplicated guest coverage cells',s=>s.backends[0].guest[1].contract_id=s.backends[0].guest[0].contract_id);
denied('reject unknown contract state',s=>s.backends[0].guest[0].state='PASSED');
denied('reject ghost receipt on NOT_EXECUTED',s=>s.backends[0].guest[0].receipt={conclusion:'success'});
denied('reject false passing guest without compiler binary',s=>s.backends[0].guest[0].state='REPORTED_PASS');
denied('reject fabricated binary without source-bound build receipt',s=>s.backends[0].compiler.binary_sha256='e'.repeat(64));
denied('reject future-dated manifest',s=>s.as_of='2099-01-01T00:00:00Z');
denied('reject corrupted oracle identity',s=>s.contracts[0].oracle.fixture_blob_sha='000');
denied('reject arbitrary manifest path escape',s=>s.postmerge_ledger.path='../../private.txt');
denied('reject false formal PASS without proof',s=>s.backends[0].formal.state='REPORTED_PASS');
test('claimed scalar pass remains unverified and release blocked even with structured receipt',()=>{
 const s=load();withReportedScalar(s);
 const r=evaluateCandidate(s,loadedLedger());
 assert.equal(r.backends[0].guest['scalar-exit-42-v1'],'REPORTED_PASS_UNVERIFIED');
 assert.equal(r.release_authorized,false);assert.equal(r.status,'BLOCKED');
});
test('exact scalar exit and stdout are compared, not merely well-typed',()=>{
 const x=load();const {b}=withReportedScalar(x);
 b.guest[0].receipt.output.exit_code=41;
 assert.throws(()=>validateCandidate(x),/unbound guest receipt/);
 b.guest[0].receipt.output.exit_code=42;
 b.guest[0].receipt.output.stdout_hex='3432';
 assert.throws(()=>validateCandidate(x),/unbound guest receipt/);
});
test('wrong .atto fixture Git blob cannot masquerade as the pinned scalar case',()=>{
 const s=load();const {b}=withReportedScalar(s);
 b.guest[0].receipt.fixture_blob_sha='a'.repeat(40);
 assert.throws(()=>validateCandidate(s),/unbound guest receipt/);
});
test('one claimed green actor-channel suite cannot replace missing case-level results',()=>{
 const s=load();const b=s.backends[0],c=s.contracts[1];
 b.compiler.binary_sha256='a'.repeat(64);b.compiler.build_receipt=receipt(b,'aot');
 b.guest[1]={contract_id:c.id,state:'REPORTED_PASS',receipt:receipt(b,'guest',{
   ...c,oracle:{fixture_blob_sha:'b'.repeat(40),expected_exit_code:0,expected_stdout_hex:''}
 })};
 assert.throws(()=>validateCandidate(s),/unbound guest receipt/);
});
test('reported DOP exit zero still cannot authorize certification',()=>{
 const s=load();withReportedScalar(s,1,3);
 const r=evaluateCandidate(s,loadedLedger());
 assert.equal(r.backends[1].guest['dop-scalar-guest-v1'],'REPORTED_PASS_UNVERIFIED');
 assert.equal(r.release_authorized,false);
});
test('a stale snapshot is blocked rather than silently promoted',()=>{
 const s=load();s.as_of='2026-01-01T00:00:00Z';
 const r=evaluateCandidate(s,loadedLedger());
 assert(r.holds.includes('STALE_SOURCE_HEAD_SNAPSHOT'));
});
function withTemp(data,fn){
 const dir=mkdtempSync(join(tmpdir(),'atto-cert-audit-'));
 try{const path=join(dir,'candidate.json');writeFileSync(path,data);
  return fn(path,dir);
 }finally{rmSync(dir,{force:true,recursive:true});}
}
function cliRun(path,md=false){return spawnSync(process.execPath,
 [cli,path,...(md?['--markdown']:[])],{encoding:'utf8',timeout:7000,maxBuffer:300000});}
test('real CLI returns blocked JSON and nonzero exit 1',()=>{
 const p=cliRun(manifest);
 assert.equal(p.status,1,p.stderr);
 assert.equal(JSON.parse(p.stdout).status,'BLOCKED');
 assert.equal(JSON.parse(p.stdout).release_authorized,false);
});
test('real CLI can print blocked Markdown, never exit 0',()=>{
 const p=cliRun(manifest,true);
 assert.equal(p.status,1,p.stderr);
 assert.match(p.stdout,/NOT CERTIFIED/);
});
test('real CLI rejects tampered landed evidence SHA pin',()=>{
 const s=load();s.postmerge_ledger.github_blob_sha='f'.repeat(40);
 const raw=JSON.stringify(s,null,2)+'\n';
 withTemp(raw,path=>{
  const r=cliRun(path);assert.equal(r.status,2);assert.match(r.stderr,/Git blob SHA mismatch/);
 });
});
test('real CLI rejects duplicate JSON authority keys (including escaped alias)',()=>{
 const raw=readFileSync(manifest,'utf8').replace('"scope": "untrusted_offline_snapshot",',
  '"scope": "fake",\n  "scope": "untrusted_offline_snapshot",');
 withTemp(raw,path=>{
  const r=cliRun(path);assert.equal(r.status,2);assert.match(r.stderr,/noncanonical/);
 });
 const escaped=readFileSync(manifest,'utf8').replace('"scope": "untrusted_offline_snapshot",',
  '"\\u0073cope": "fake",\n  "scope": "untrusted_offline_snapshot",');
 withTemp(escaped,path=>{
  const r=cliRun(path);assert.equal(r.status,2);assert.match(r.stderr,/noncanonical/);
 });
});
test('real CLI refuses symlink and hardlink file inputs',()=>{
 withTemp(readFileSync(manifest), (path,dir)=>{
  const symlink=join(dir,'symlink.json');symlinkSync(path,symlink);
  assert.equal(cliRun(symlink).status,2);
  const hardlink=join(dir,'hardlink.json');linkSync(path,hardlink);
  assert.equal(cliRun(path).status,2);
 });
});
test('real CLI rejects oversize, malformed UTF8 and noncanonical JSON',()=>{
 withTemp(Buffer.alloc(262145,32),path=>assert.equal(cliRun(path).status,2));
 withTemp(Buffer.from([0xc3,0x28]),path=>assert.equal(cliRun(path).status,2));
 withTemp(JSON.stringify(load()),path=>assert.equal(cliRun(path).status,2));
});
