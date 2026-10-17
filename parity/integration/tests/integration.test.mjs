import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateInventory,mergeReadiness,HEADS} from '../src/inventory.mjs';
import {verifyCheckout,runIntegration} from '../src/run.mjs';
import {assessWorkflow,checkNoRunAsProof} from '../src/host-evidence.mjs';
const manifestPath=new URL('../inventory.json',import.meta.url);
const load=async()=>JSON.parse(await readFile(manifestPath,'utf8'));
const mutate=async fn=>{const x=structuredClone(await load());fn(x);return x;};
const makeRuns=(status='PASSED')=>HEADS.map((head,i)=>({wave:i+1,head,status}));
const hash=b=>createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const workflow=()=>({
 repository:'ores-truffle-oreslang/oreslang-platform-conformance',
 runId:12345,attempt:1,head:HEADS[0],conclusion:'success',
 jobs:[{name:'six-wave-host-conformance',runId:12345,attempt:1,head:HEADS[0],conclusion:'success',
  steps:['Check out integration driver','Set up Node 22','Confirm Clang for native format control cases',...Array.from({length:6},(_,i)=>'Checkout wave '+(i+1)+' exact draft head'),'Check out 6 pinned wave commits','Test integration runner and provenance denial guards','Run pinned six-wave host suites'].map(name=>({name,status:'completed',conclusion:'success',attempt:1}))}]
});
test('31 / all 92 changed files across six PRs are uniquely registered',async()=>{
 const x=validateInventory(await load());
 assert.equal(x.files,92);assert.equal(x.waves,6);assert.equal(x.anchoredBlobs,14);assert.equal(x.certifiedParity,false);
});
test('31 / exact PR source heads cannot be silently updated',async()=>{
 const x=await mutate(m=>{m.waves[0].head='0'.repeat(40)});
 assert.throws(()=>validateInventory(x),/head substitution/);
});
test('31 / path collision across distinct PRs fails before test admission',async()=>{
 const x=await mutate(m=>{m.waves[5].changedFiles[0]=m.waves[4].changedFiles[0]});
 assert.throws(()=>validateInventory(x),/path collision/);
});
test('31 / file traversal and changed inventory omissions fail closed',async()=>{
 for(const f of [m=>{m.waves[0].changedFiles[0]='../escape'},m=>{m.waves[2].changedFiles.pop()}]){
  const x=await mutate(f);assert.throws(()=>validateInventory(x),/integration-inventory/);
 }
});
test('31 / pinned manifests tests and cross-wave source must remain exact',async()=>{
 const x=await mutate(m=>{m.waves[4].pinnedFiles[2].gitBlob='0'.repeat(40)});
 assert.throws(()=>validateInventory(x),/scalar golden/);
});
test('31 / false parity promotion and missing backend inventory rejected',async()=>{
 for(const f of [m=>{m.certifiedParity=true},m=>{m.backends.pop()},m=>{m.tasks[4].name='release-now'}]){
  assert.throws(()=>validateInventory(await mutate(f)),/integration-inventory/);
 }
});
test('32 / temp locally committed checkout proves exact Git head and source blobs',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'ores-integration-'));
 try{
  const root=join(workspace,'wave1'),testdir=join(root,'parity','wave1','tests');
  await mkdir(testdir,{recursive:true});
  const testFile='parity/wave1/tests/probe.test.mjs';
  const source=Buffer.from("import test from 'node:test';test('probe',()=>{});\n");
  await writeFile(join(testdir,'probe.test.mjs'),source);
  execFileSync('git',['init','-q',root]);execFileSync('git',['-C',root,'add','.']);
  execFileSync('git',['-C',root,'-c','user.email=test@example.invalid','-c','user.name=Test','commit','-qm','checkpoint']);
  const head=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const w={wave:1,head,changedFiles:[testFile],pinnedFiles:[{path:testFile,gitBlob:hash(source)}]};
  const checked=await verifyCheckout(w,workspace);
  assert.equal(checked.head,head);assert.deepEqual(checked.tests,[testFile]);
  const executed=spawnSync(process.execPath,['--test',...checked.tests],{cwd:root,encoding:'utf8'});
  assert.equal(executed.status,0,executed.stderr);
  await writeFile(join(testdir,'probe.test.mjs'),"malicious source change\n");
  await assert.rejects(verifyCheckout(w,workspace),/modified before tests/);
 }finally{await rm(workspace,{recursive:true,force:true})}
});
test('32 / absent checkouts and non-absolute working roots reject',async()=>{
 const m=await load();
 await assert.rejects(verifyCheckout(m.waves[0],'/definitely-not-a-real-checkout-parent'),/ENOENT|integration-runner/);
 await assert.rejects(verifyCheckout(m.waves[0],'relative/path'),/absolute checkout/);
});
test('32 / invalid runner inputs cannot produce a green report',async()=>{
 await assert.rejects(runIntegration({inventoryPath:'inventory.json',checkoutRoot:'/tmp'}),/absolute/);
 await assert.rejects(runIntegration({inventoryPath:resolve(fileURLToPath(manifestPath)),checkoutRoot:'/tmp',timeoutMs:0}),/bounded/);
});
test('33 / even all passing host suites are not certified compiler parity',()=>{
 const r=mergeReadiness({results:makeRuns()});
 assert.equal(r.hostReadiness,'HOST_SUITES_PASSED_NEEDS_INDEPENDENT_CI');
 assert.equal(r.mergeApproved,false);assert.equal(r.releaseCertified,false);assert.equal(r.backendCompilerParity,'UNVERIFIED');
});
test('33 / a nonzero test or wrong source head blocks integration',()=>{
 const results=makeRuns();results[4].status='FAILED';results[1].head='f'.repeat(40);
 const r=mergeReadiness({results});assert.equal(r.hostReadiness,'BLOCKED');assert.equal(r.failedWaves.length,2);
});
test('33 / duplicate and incomplete host results are denied',()=>{
 const result=makeRuns();result[5].wave=1;
 assert.throws(()=>mergeReadiness({results:result}),/duplicate/);
 assert.throws(()=>mergeReadiness({results:makeRuns().slice(0,5)}),/missing executed/);
});
test('34 / a zero-step failed Actions job is not compiler/test evidence',()=>{
 const r=checkNoRunAsProof({runConclusions:[{jobs:[{steps:null},{steps:[]}]}]});
 assert.equal(r.ranActualSteps,false);assert.equal(r.blockedRunCount,2);assert.equal(r.safeConclusion,'NO_EXECUTED_TEST_EVIDENCE');
});
test('34 / synthetic successful job receipts are never independent attestation',()=>{
 const r=assessWorkflow(workflow(),{expectedHead:HEADS[0]});
 assert.equal(r.status,'UNTRUSTED_CI_STEP_RECEIPT_SHAPE_VALID');
 assert.equal(r.fetchedIndependentlyFromGitHub,false);assert.equal(r.compilerParityVerified,false);
});
test('34 / stale attempt or wrong source revision rejected',()=>{
 for(const change of [m=>{m.jobs[0].attempt=2},m=>{m.head='f'.repeat(40)},m=>{m.jobs[0].steps[1].attempt=2}]){
  const c=workflow();change(c);assert.throws(()=>assessWorkflow(c,{expectedHead:HEADS[0]}),/integration-ci/);
 }
});
test('34 / missing compile/checkout/execute steps or fake success cannot pass',()=>{
 for(const change of [m=>{m.jobs[0].steps.pop()},m=>{m.jobs[0].steps[0].conclusion='skipped'},m=>{m.jobs[0].steps[1].name=m.jobs[0].steps[0].name}]){
  const c=workflow();change(c);assert.throws(()=>assessWorkflow(c,{expectedHead:HEADS[0]}),/integration-ci/);
 }
});
test('35 / full host outcomes still mandate production compiler and independent CI reviews',()=>{
 const r=mergeReadiness({results:makeRuns()});assert.equal(r.securityReview,'REQUIRED');
 assert.ok(r.nextRequirements.some(x=>/production compiler/.test(x)));
});

test('37 / an untracked Node test cannot be injected into reviewed checkout',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'ores-untracked-'));
 try{
  const root=join(workspace,'wave1'),dir=join(root,'parity','wave1','tests');
  await mkdir(dir,{recursive:true});
  const path='parity/wave1/tests/probe.test.mjs',source=Buffer.from("import test from 'node:test';test('ok',()=>{});\\n");
  await writeFile(join(dir,'probe.test.mjs'),source);
  execFileSync('git',['init','-q',root]);execFileSync('git',['-C',root,'add','.']);
  execFileSync('git',['-C',root,'-c','user.email=test@example.invalid','-c','user.name=Test','commit','-qm','baseline']);
  const head=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  await writeFile(join(dir,'injected.test.mjs'),"import test from 'node:test';test('injected',()=>{});\\n");
  await assert.rejects(verifyCheckout({wave:1,head,changedFiles:[path],pinnedFiles:[{path,gitBlob:hash(source)}]},workspace),/modified before tests/);
 }finally{await rm(workspace,{recursive:true,force:true})}
});
test('38 / extra tracked but unreviewed test must not execute',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'ores-unreviewed-'));
 try{
  const root=join(workspace,'wave1'),dir=join(root,'parity','wave1','tests');
  await mkdir(dir,{recursive:true});
  const path='parity/wave1/tests/probe.test.mjs',source=Buffer.from("import test from 'node:test';test('ok',()=>{});\\n");
  await writeFile(join(dir,'probe.test.mjs'),source);
  await writeFile(join(dir,'unreviewed.test.mjs'),"import test from 'node:test';test('not admitted',()=>{});\\n");
  execFileSync('git',['init','-q',root]);execFileSync('git',['-C',root,'add','.']);
  execFileSync('git',['-C',root,'-c','user.email=test@example.invalid','-c','user.name=Test','commit','-qm','baseline']);
  const head=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  await assert.rejects(verifyCheckout({wave:1,head,changedFiles:[path],pinnedFiles:[{path,gitBlob:hash(source)}]},workspace),/unreviewed\/missing test/);
 }finally{await rm(workspace,{recursive:true,force:true})}
});
test('39 / all CI stages must appear in authored workflow order',()=>{
 const r=workflow();
 const first=r.jobs[0].steps[1];r.jobs[0].steps[1]=r.jobs[0].steps[2];r.jobs[0].steps[2]=first;
 assert.throws(()=>assessWorkflow(r,{expectedHead:HEADS[0]}),/step order/);
});
test('40 / missing checkouts give six blocked results, never imaginary test failures',async()=>{
 const workspace=await mkdtemp(join(tmpdir(),'ores-missing-six-'));
 try{
  const r=await runIntegration({inventoryPath:resolve(fileURLToPath(manifestPath)),checkoutRoot:workspace});
  assert.equal(r.results.length,6);
  assert.equal(r.status,'HOST_SUITES_FAILED');
  assert.ok(r.results.every(x=>x.status==='BLOCKED_BEFORE_TEST'&&x.hostSuiteRan===false&&x.testCounts===null));
  assert.equal(r.releaseCertified,false);
 }finally{await rm(workspace,{recursive:true,force:true})}
});
