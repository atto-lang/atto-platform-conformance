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
   kind,run_id:101,run_attempt:1,job_id:202,runner_id:303,runner_name:'synthetic-test-runner',
   status:'completed',conclusion:'success',artifact_sha256:'d'.repeat(64),
   steps:[{name:'Execute real compiler guest',status:'completed',conclusion:'success'}]};
 if(kind==='aot')return {...v,executable_sha256:'e'.repeat(64),fully_aot:true,jit_disabled:true};
 if(kind==='formal')return {...v,model_sha256:'e'.repeat(64),properties_checked:3,counterexamples:0};
 if(kind==='memory')return {...v,metrics:{samples:10,gc_collections:0}};
 if(kind==='negative')return {...v,contract_id:c.id,fixture_blob_sha:c.fixture_blob_sha,
   output:{exit_code:1,diagnostic_category:c.expected_diagnostic,
     phase:c.expected_phase,crashed:false}};
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
  assert.equal(b.negative,'NOT_EXECUTED');
  assert(b.blockers.includes('NEGATIVE_DIAGNOSTIC_NOT_VERIFIED'));
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
denied('reject extra top-level release_authorized flag',s=>s.release_authorized=true);
denied('reject extra top-level approval metadata',s=>s.trusted_approval={identity:'operator'});
denied('reject omitted mandatory evidence note',s=>delete s.evidence_note);
denied('reject nonstring evidence note',s=>s.evidence_note={certified:true});
denied('reject extra postmerge trusted-status override',s=>s.postmerge_ledger.release_approved=true);
denied('reject unrecognized postmerge reported status',s=>s.postmerge_ledger.reported_status='CERTIFIED');
denied('reject extra negative oracle waiver',s=>s.negative_oracle.waived=true);
denied('reject extra contract certification flag',s=>s.contracts[0].certified=true);
denied('reject extra proposal approval flag',s=>s.contracts[0].proposal.approved=true);
denied('reject extra scalar oracle verification flag',s=>s.contracts[0].oracle.verified=true);
denied('reject extra suite oracle verification flag',s=>s.contracts[1].oracle.verified=true);
denied('reject extra backend success claim',s=>s.backends[0].release_passed=true);
denied('reject extra source protected-main proof',s=>s.backends[0].source.ruleset_enforced=true);
denied('reject extra backend memory verification target',s=>s.backends[0].targets.verified_gc=true);
denied('reject extra compiler binary trust assertion',s=>s.backends[0].compiler.binary_trusted=true);
denied('reject extra guest cell execution status',s=>s.backends[0].guest[0].executed=true);
denied('reject extra formal waiver field',s=>s.backends[0].formal.waiver=true);
denied('reject calendar-invalid February 30 timestamp',s=>s.as_of='2026-02-30T02:00:00Z');
denied('reject calendar-invalid April 31 timestamp',s=>s.as_of='2026-04-31T03:00:00Z');
denied('reject invalid nonleap February 29 timestamp',s=>s.as_of='2026-02-29T12:34:56Z');
denied('reject normalized 24-hour midnight timestamp',s=>s.as_of='2026-11-06T24:00:00Z');
test('historical leap day is canonical UTC but remains stale',()=>{
 const s=load();s.as_of='2024-02-29T12:34:56Z';
 assert.equal(validateCandidate(s),true);
 const r=evaluateCandidate(s,loadedLedger());
 assert.equal(r.status,'BLOCKED');
 assert(r.holds.includes('STALE_SOURCE_HEAD_SNAPSHOT'));
});
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

test('negative oracle pins a real .atto fixture and exact diagnostic category',()=>{
 const c=load().negative_oracle;
 assert.equal(c.id,'reject-duck-hasfuture');
 assert.equal(c.fixture_blob_sha,'0072db5d74cd72430b3116eef51cb7237faae901');
 assert.equal(c.expected_diagnostic,'ATTO_TASK_E_HASFUTURE_WITNESS');
 assert.equal(c.expected_phase,'typechecker');
});
denied('reject fake negative PASS without a compiler binary',s=>s.backends[0].negative.state='REPORTED_PASS');
denied('reject malformed negative diagnostic code',s=>s.negative_oracle.expected_diagnostic='42');
function withReportedNegative(s){
 const b=s.backends[0],c=s.negative_oracle;
 b.compiler.binary_sha256='a'.repeat(64);
 b.compiler.build_receipt=receipt(b,'aot');
 b.negative={state:'REPORTED_PASS',receipt:receipt(b,'negative',c)};
 return b;
}
test('structurally reported negative remains UNVERIFIED and cannot release',()=>{
 const s=load();withReportedNegative(s);
 const r=evaluateCandidate(s,loadedLedger());
 assert.equal(r.backends[0].negative,'REPORTED_PASS_UNVERIFIED');
 assert.equal(r.release_authorized,false);
 assert.equal(r.status,'BLOCKED');
});
test('wrong negative diagnostic code, phase or fixture fails closed',()=>{
 for(const mutation of [
   b=>b.negative.receipt.output.diagnostic_category='PARSE_ERROR',
   b=>b.negative.receipt.output.phase='runtime',
   b=>b.negative.receipt.fixture_blob_sha='f'.repeat(40)
 ]){
   const s=load(),b=withReportedNegative(s);mutation(b);
   assert.throws(()=>validateCandidate(s),/unbound negative receipt/);
 }
});
test('exit zero or crashed guest cannot prove a compiler rejection',()=>{
 for(const mutation of [
   b=>b.negative.receipt.output.exit_code=0,
   b=>b.negative.receipt.output.crashed=true
 ]){
  const s=load(),b=withReportedNegative(s);mutation(b);
  assert.throws(()=>validateCandidate(s),/unbound negative receipt/);
 }
});

test('successful setup cannot conceal failed or skipped substantive guest work',()=>{
 for(const outcome of ['failure','skipped']){
  const s=load(),{b}=withReportedScalar(s);
  b.guest[0].receipt.steps.push({name:'Run mandatory compiler negative',status:'completed',conclusion:outcome});
  assert.throws(()=>validateCandidate(s),/unbound guest receipt/);
 }
});
test('queued, in-progress or padded substantive steps cannot certify execution',()=>{
 for(const mutateStep of [
   step=>step.status='in_progress',
   step=>step.name=' Executed guest ',
   step=>step.name='Execute\u00a0guest'
 ]){
  const s=load(),{b}=withReportedScalar(s);
  mutateStep(b.guest[0].receipt.steps[0]);
  assert.throws(()=>validateCandidate(s),/unbound guest receipt/);
 }
});
test('missing, absent and malformed runner names reject a claimed guest execution',()=>{
 for(const bad of [null,'',' ','  worker','worker  ','worker\nline','worker\u00a0name',
                    'worker\u200bname','x'.repeat(129),0,{},[]]){
  const s=load(),{b}=withReportedScalar(s);
  b.guest[0].receipt.runner_name=bad;
  assert.throws(()=>validateCandidate(s),/unbound guest receipt/);
 }
 const s=load(),{b}=withReportedScalar(s);
 delete b.guest[0].receipt.runner_name;
 assert.throws(()=>validateCandidate(s),/unbound guest receipt/);
});
test('missing or blank runner name rejects a claimed compiler binary build',()=>{
 for(const mutateReceipt of [
  r=>{delete r.runner_name;},
  r=>{r.runner_name='   ';},
  r=>{r.runner_name='\u0000';}
 ]){
  const s=load(),{b}=withReportedScalar(s);
  mutateReceipt(b.compiler.build_receipt);
  assert.throws(()=>validateCandidate(s),/unbound build receipt/);
 }
});
test('missing runner name rejects negative compiler and formal claims',()=>{
 const s=load(),b=withReportedNegative(s);
 delete b.negative.receipt.runner_name;
 assert.throws(()=>validateCandidate(s),/unbound negative receipt/);
});
test('nonzero runner ID plus printable name is still not trusted provenance',()=>{
 const s=load();
 const {b}=withReportedScalar(s);
 assert.equal(b.guest[0].receipt.runner_id,303);
 assert.equal(b.guest[0].receipt.runner_name,'synthetic-test-runner');
 const report=evaluateCandidate(s,loadedLedger());
 assert.equal(report.backends[0].guest['scalar-exit-42-v1'],'REPORTED_PASS_UNVERIFIED');
 assert.equal(report.release_authorized,false);
 assert.equal(report.status,'BLOCKED');
});
test('self-reported scalar PASS is blocked by explicit unauthenticated receipt hold',()=>{
 const s=load();withReportedScalar(s);
 const r=evaluateCandidate(s,loadedLedger());
 assert(r.backends[0].blockers.includes('GUEST_RECEIPT_UNAUTHENTICATED'));
 assert(r.holds.includes('UNAUTHENTICATED_RECEIPT_CLAIMS'));
 assert.equal(r.status,'BLOCKED');assert.equal(r.release_authorized,false);
});
test('self-reported negative PASS never clears the negative-verification hold',()=>{
 const s=load();withReportedNegative(s);
 const r=evaluateCandidate(s,loadedLedger());
 assert.equal(r.backends[0].negative,'REPORTED_PASS_UNVERIFIED');
 assert(r.backends[0].blockers.includes('NEGATIVE_RECEIPT_UNAUTHENTICATED'));
 assert(r.holds.includes('UNAUTHENTICATED_RECEIPT_CLAIMS'));
 assert.equal(r.release_authorized,false);
});
test('formal, full-AOT and memory self-reports each retain unauthenticated blockers',()=>{
 for(const kind of ['formal','aot','memory']){
  const s=load(),{b}=withReportedScalar(s);
  b[kind]={state:'REPORTED_PASS',receipt:receipt(b,kind)};
  const report=evaluateCandidate(s,loadedLedger());
  assert.equal(report.backends[0][kind],'REPORTED_PASS_UNVERIFIED');
  assert(report.backends[0].blockers.includes(kind.toUpperCase()+'_RECEIPT_UNAUTHENTICATED'));
  assert(report.holds.includes('UNAUTHENTICATED_RECEIPT_CLAIMS'));
  assert.equal(report.release_authorized,false);
 }
});
test('invalid postmerge summary cannot contradict the independently evaluated ledger',()=>{
 const s=load();s.postmerge_ledger.reported_status='SNAPSHOT_READY_RECHECK_LIVE';
 assert.equal(validateCandidate(s),true);
 assert.throws(()=>evaluateCandidate(s,loadedLedger()),/snapshot ledger status does not match/);
});
test('guest/build receipt cannot smuggle extra authority fields or nested step metadata',()=>{
 for(const mutateReceipt of [
  b=>b.guest[0].receipt.release_authorized=true,
  b=>b.guest[0].receipt.verified=true,
  b=>b.guest[0].receipt.output.certified=true,
  b=>b.guest[0].receipt.steps[0].approved=true,
  b=>b.compiler.build_receipt.trusted=true,
  b=>b.compiler.build_receipt.steps[0].bypass=true
 ]){
  const s=load(),{b}=withReportedScalar(s);
  mutateReceipt(b);
  assert.throws(()=>validateCandidate(s),/unbound (?:guest|build) receipt/);
 }
});
test('negative receipt cannot smuggle waived diagnostics or extra output keys',()=>{
 for(const mutateReceipt of [
  b=>b.negative.receipt.waived=true,
  b=>b.negative.receipt.output.recovered=true,
  b=>b.negative.receipt.steps[0].skipped_test=true
 ]){
  const s=load(),b=withReportedNegative(s);
  mutateReceipt(b);
  assert.throws(()=>validateCandidate(s),/unbound negative receipt/);
 }
});
test('LLVM positive GC count fails structural zero-GC precondition even in untrusted receipt',()=>{
 const s=load(),{b}=withReportedScalar(s,1,0);
 b.memory={state:'REPORTED_PASS',receipt:receipt(b,'memory')};
 b.memory.receipt.metrics.gc_collections=1;
 assert.throws(()=>validateCandidate(s),/unbound memory receipt/);
 b.memory.receipt.metrics.gc_collections=0;
 assert.equal(validateCandidate(s),true);
 const report=evaluateCandidate(s,loadedLedger());
 assert.equal(report.backends[1].memory,'REPORTED_PASS_UNVERIFIED');
 assert(report.backends[1].blockers.includes('MEMORY_RECEIPT_UNAUTHENTICATED'));
 assert.equal(report.release_authorized,false);
});
test('memory metrics cannot embed independent certification or waiver claims',()=>{
 const s=load(),{b}=withReportedScalar(s);
 b.memory={state:'REPORTED_PASS',receipt:receipt(b,'memory')};
 b.memory.receipt.metrics.verified_gc=true;
 assert.throws(()=>validateCandidate(s),/unbound memory receipt/);
});
test('housekeeping-only CI is insufficient to substantiate a guest run',()=>{
 const s=load(),{b}=withReportedScalar(s);
 b.guest[0].receipt.steps=[{name:'Set up job',status:'completed',conclusion:'success'}];
 assert.throws(()=>validateCandidate(s),/unbound guest receipt/);
});
