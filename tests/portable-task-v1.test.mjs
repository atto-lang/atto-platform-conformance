import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadSuite,selectCases,validateManifest,classifyReceipt,summarize} from '../lib/portable-task-v1.mjs';
const {manifest,cases}=await loadSuite();
const hex40='a'.repeat(40),hex64='b'.repeat(64);
const positive=cases.find(c=>c.expect==='positive'&&c.mustObserve.length===0);
function receipt(c=positive){return {status:'passed',caseId:c.id,backend:'java',compilerCommit:hex40,fixtureCommit:hex40,fixtureBlobSha:c.fixtureBlobSha,fixtureSha256:c.fixtureSha256,compilerSha256:hex64,compileArgv:['/absolute/compiler','--check',c.file],completedSteps:2,stepNames:['compile','guest'],runnerJobUrl:'https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/123',compilerExit:0,compilerOutput:'',rejectedEmittedArtifact:false,guestExecuted:true,artifactSha256:hex64,guestArgv:['/absolute/guest'],guestExit:42,guestOutput:''};}
test('16 distinct immutable .atto source cases cover all six backends',()=>{
 assert.equal(cases.length,16);assert.equal(new Set(cases.map(c=>c.fixtureBlobSha)).size,14);
 assert.equal(manifest.executionVerified,false);
 assert.deepEqual(Object.keys(summarize(cases,{})),['java','llvm','wasm','rs','forge','net']);
 for(const v of Object.values(summarize(cases,{})))assert.deepEqual([v.passed,v.failed,v.unsupported,v.not_executed,v.releaseQualified],[0,0,0,16,false]);
 assert.equal(summarize(cases,{}).rs.not_executed,16);
});
test('portable Task semantics are specified, not misreported as executed',async()=>{
 const text=await readFile(new URL('../contracts/portable-task-v1.md',import.meta.url),'utf8');
 for(const phrase of ['eager','HasFuture<T>','same \`ActorRef<T>\`','get_done()','physically retired','actor \`self\`','not_executed','zero-step'])assert.ok(text.includes(phrase),phrase);
});
test('manifest must not contain its own proof of execution',()=>{
 assert.throws(()=>validateManifest({...manifest,executionVerified:true}));
 assert.throws(()=>validateManifest({...manifest,cases:[...manifest.cases,manifest.cases[0]]}));
 assert.throws(()=>validateManifest({...manifest,cases:manifest.cases.map((x,i)=>i===0?{...x,baseline:{...x.baseline,wasm:'passed'}}:x)}));
});
test('missing evidence stays not_executed',()=>assert.equal(classifyReceipt(positive,'java',null).status,'not_executed'));
test('successful result is only a review candidate, not a release promotion',()=>{
 const x=classifyReceipt(positive,'java',receipt());assert.equal(x.status,'passed');assert.equal(x.releaseQualified,false);
});
for(const [key,value] of [['completedSteps',0],['stepNames',[]],['fixtureBlobSha',hex40],['compilerSha256',null],['guestExecuted',false],['guestExit',0],['artifactSha256',null],['runnerJobUrl','https://invalid.test'],['releaseQualified',true]]){
 test('denies forged/incomplete passed receipt: '+key,()=>assert.equal(classifyReceipt(positive,'java',{...receipt(),[key]:value}).status,'failed'));
}
test('negative compiler rejection never claims guest execution',()=>{
 const c=cases.find(x=>x.expect==='negative');let x={...receipt(c),compilerExit:1,compilerOutput:'error: ATTO_TASK_E_HASFUTURE_WITNESS missing nominal HasFuture witness',guestExecuted:false,artifactSha256:null,guestArgv:[],guestExit:null,guestOutput:'',completedSteps:1,stepNames:['compile']};
 assert.equal(classifyReceipt(c,'java',x).status,'passed');
 assert.equal(classifyReceipt(c,'java',{...x,guestExecuted:true}).status,'failed');
});
test('unsupported requires executed explicit compiler rejection',()=>{
 const x={...receipt(),status:'unsupported',compilerExit:1,compilerOutput:'error: unsupported Task lowering',guestExecuted:false,artifactSha256:null,guestArgv:[],guestExit:null,completedSteps:1,stepNames:['compile']};
 assert.equal(classifyReceipt(positive,'java',x).status,'unsupported');
 assert.equal(classifyReceipt(positive,'java',{...x,compilerOutput:'error: unexpected failure'}).status,'failed');
});
test('candidate receipt refuses spoofed or out-of-order compiler and guest steps',()=>{
 for(const names of [['metadata','guest'],['guest','compile'],['compile','upload'],['compile','guest','metadata']]){
  const x={...receipt(),stepNames:names,completedSteps:names.length};
  assert.equal(classifyReceipt(positive,'java',x).status,'failed',names.join(','));
 }
 assert.equal(classifyReceipt(positive,'java',receipt()).status,'passed');
});
test('negative compiler rejection requires compile-only observed steps',()=>{
 const c=cases.find(x=>x.expect==='negative');
 const valid={...receipt(c),status:'passed',compilerExit:1,
  compilerOutput:'error: '+c.expectedDiagnosticCode+' verified semantic rejection',
  guestExecuted:false,artifactSha256:null,guestArgv:[],guestExit:null,guestOutput:'',
  stepNames:['compile'],completedSteps:1};
 assert.equal(classifyReceipt(c,'java',valid).status,'passed');
 for(const names of [['metadata'],['compile','guest'],['guest','compile']]){
  assert.equal(classifyReceipt(c,'java',{...valid,stepNames:names,completedSteps:names.length}).status,'failed',names.join(','));
 }
});
test('unsupported compiler result cannot pretend to execute guest steps',()=>{
 const base={...receipt(),status:'unsupported',compilerExit:1,
  compilerOutput:'error: unsupported Task lowering',guestExecuted:false,
  artifactSha256:null,guestArgv:[],guestExit:null,stepNames:['compile'],completedSteps:1};
 assert.equal(classifyReceipt(positive,'java',base).status,'unsupported');
 assert.equal(classifyReceipt(positive,'java',{...base,stepNames:['compile','guest'],completedSteps:2}).status,'failed');
});
test('positive guest trace must contain every actual assertion',()=>{
 const c=cases.find(x=>x.mustObserve.length>0);const x=receipt(c);
 assert.equal(classifyReceipt(c,'java',x).status,'failed');
 assert.equal(classifyReceipt(c,'java',{...x,guestOutput:c.mustObserve.join('\n')}).status,'passed');
});

test('negative compiler syntax errors are not semantic isolation proof',()=>{
 const c=cases.find(x=>x.expect==='negative');const x={...receipt(c),compilerExit:1,compilerOutput:'error: expected semicolon',guestExecuted:false,artifactSha256:null};
 assert.equal(classifyReceipt(c,'java',x).status,'failed');
});
test('exact single-line projection trace prevents 11 matching 1',()=>{
 const c=cases.find(x=>x.id==='generic-hasfuture-once'),x=receipt(c);
 assert.equal(classifyReceipt(c,'java',{...x,guestOutput:'projection_count=11'}).status,'failed');
});

test('multi-token guest observations require independent lines and ordering',()=>{
 const c=cases.find(x=>x.id==='cancel-owned-descendants'),x=receipt(c);
 const [a,b]=c.mustObserve;
 assert.equal(classifyReceipt(c,'java',{...x,guestOutput:a+'\n'+b}).status,'passed');
 assert.equal(classifyReceipt(c,'java',{...x,guestOutput:b+'\n'+a}).status,'failed');
 assert.equal(classifyReceipt(c,'java',{...x,guestOutput:a+'\n'+a+'\n'+b}).status,'failed');
});

test('a local positive result is only a candidate; no forged hosted CI is required',()=>{
 const x={...receipt(),runnerJobUrl:null};
 const admitted=classifyReceipt(positive,'java',x);
 assert.equal(admitted.status,'passed');
 assert.equal(admitted.releaseQualified,false);
 assert.match(admitted.reason,/local subprocess/);
});
test('a real-looking but invalid Actions path is rejected',()=>{
 const x={...receipt(),runnerJobUrl:'https://github.com/org/repo/actions/runs/123/evil'};
 assert.equal(classifyReceipt(positive,'java',x).status,'failed');
});
test('compiled positive evidence requires absolute compiler and guest paths',()=>{
 assert.equal(classifyReceipt(positive,'java',{...receipt(),compileArgv:['compiler','--check',positive.file]}).status,'failed');
 assert.equal(classifyReceipt(positive,'java',{...receipt(),guestArgv:['guest']}).status,'failed');
});

test('targeted first-two fixture selection is strict, ordered and deduplicated',()=>{
 const selected=selectCases(cases,['typed-int','eager-before-await']);
 assert.deepEqual(selected.map(x=>x.id),['eager-before-await','typed-int']);
 for(const bad of [[],['typed-int','typed-int'],['__proto__'],['wrong'],null,{},['']]){
  assert.throws(()=>selectCases(cases,bad));
 }
});
test('a rejected compiler artifact cannot be concealed in negative evidence',()=>{
 const c=cases.find(x=>x.expect==='negative');
 const x={...receipt(c),compilerExit:1,compilerOutput:'error: '+c.expectedDiagnosticCode+' invalid capture',
   rejectedEmittedArtifact:true,guestExecuted:false,artifactSha256:null};
 assert.equal(classifyReceipt(c,'java',x).status,'failed');
});

test('malformed argv or incompatible step count fail closed instead of crashing',()=>{
 for(const mutated of [
  {compileArgv:[42,'--check','fixture.atto']},
  {compileArgv:['/compiler',null,'fixture.atto']},
  {guestArgv:[42]},
  {guestArgv:['/guest',null]},
  {completedSteps:1000},
  {stepNames:['compile']}
 ]){
  const result=classifyReceipt(positive,'java',{...receipt(),...mutated});
  assert.equal(result.status,'failed',JSON.stringify(mutated));
  assert.equal(result.releaseQualified,false);
 }
});

test('fixture-local receipt step count is internally consistent',()=>{
 const r=receipt();
 assert.equal(r.completedSteps,r.stepNames.length);
 assert.equal(classifyReceipt(positive,'java',r).status,'passed');
});

test('portable await cases explicitly declare suspends rather than async main',async()=>{
 for(const c of cases){
  const source=await readFile(new URL('../fixtures/portable-task-v1/'+c.file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/pub async fnc main\s*\(/,c.id);
  if(source.includes('await ')&&source.includes('fnc main('))
   assert.match(source,/pub suspends fnc main\s*\(/,c.id);
 }
 const critical=await readFile(new URL('../fixtures/portable-task-v1/reject-await-in-critical.atto',import.meta.url),'utf8');
 assert.match(critical,/suspends mtd receive\s*\(/);
});

test('two-phase actor suspension race candidates are present but not guest-certified',()=>{
 const expected=[
  ['no-resume-before-physical-exit',['resumed_after_return','actor_done','no_early_resume=true']],
  ['stop-while-suspending',['stop_waited_for_physical_exit=true']]
 ];
 const matrix=summarize(cases,{});
 for(const [id,markers] of expected){
  const c=cases.find(x=>x.id===id);
  assert.ok(c,id);
  assert.equal(c.expect,'positive');
  assert.deepEqual(c.mustObserve,markers);
  for(const b of Object.keys(matrix)){
   assert.equal(c.baseline[b],'not_executed');
   assert.equal(classifyReceipt(c,b,null).status,'not_executed');
  }
 }
 assert.equal(Object.keys(matrix).length,6);
 assert.equal(Object.values(matrix).reduce((sum,b)=>sum+b.not_executed,0),96);
 assert.ok(Object.values(matrix).every(b=>b.releaseQualified===false));
});
