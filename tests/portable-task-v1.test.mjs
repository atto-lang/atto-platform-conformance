import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadSuite,validateManifest,classifyReceipt,summarize} from '../lib/portable-task-v1.mjs';
const {manifest,cases}=await loadSuite();
const hex40='a'.repeat(40),hex64='b'.repeat(64);
const positive=cases.find(c=>c.expect==='positive'&&c.mustObserve.length===0);
function receipt(c=positive){return {status:'passed',caseId:c.id,backend:'java',compilerCommit:hex40,fixtureCommit:hex40,fixtureBlobSha:c.fixtureBlobSha,fixtureSha256:c.fixtureSha256,compilerSha256:hex64,compileArgv:['/absolute/compiler','--check',c.file],completedSteps:7,runnerJobUrl:'https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/123',compilerExit:0,compilerOutput:'',guestExecuted:true,artifactSha256:hex64,guestArgv:['/absolute/guest'],guestExit:42,guestOutput:''};}
test('14 distinct immutable .atto source cases cover all five backends',()=>{
 assert.equal(cases.length,14);assert.equal(new Set(cases.map(c=>c.fixtureBlobSha)).size,14);
 assert.equal(manifest.executionVerified,false);
 assert.deepEqual(Object.keys(summarize(cases,{})),['java','llvm','wasm','forge','net']);
 for(const v of Object.values(summarize(cases,{})))assert.deepEqual([v.passed,v.failed,v.unsupported,v.not_executed,v.releaseQualified],[0,0,0,14,false]);
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
for(const [key,value] of [['completedSteps',0],['fixtureBlobSha',hex40],['compilerSha256',null],['guestExecuted',false],['guestExit',0],['artifactSha256',null],['runnerJobUrl','https://invalid.test'],['releaseQualified',true]]){
 test('denies forged/incomplete passed receipt: '+key,()=>assert.equal(classifyReceipt(positive,'java',{...receipt(),[key]:value}).status,'failed'));
}
test('negative compiler rejection never claims guest execution',()=>{
 const c=cases.find(x=>x.expect==='negative');let x={...receipt(c),compilerExit:1,compilerOutput:'error: missing nominal HasFuture witness',guestExecuted:false,artifactSha256:null,guestArgv:[],guestExit:null,guestOutput:''};
 assert.equal(classifyReceipt(c,'java',x).status,'passed');
 assert.equal(classifyReceipt(c,'java',{...x,guestExecuted:true}).status,'failed');
});
test('unsupported requires executed explicit compiler rejection',()=>{
 const x={...receipt(),status:'unsupported',compilerExit:1,compilerOutput:'error: unsupported Task lowering',guestExecuted:false,artifactSha256:null,guestArgv:[],guestExit:null};
 assert.equal(classifyReceipt(positive,'java',x).status,'unsupported');
 assert.equal(classifyReceipt(positive,'java',{...x,compilerOutput:'error: unexpected failure'}).status,'failed');
});
test('positive guest trace must contain every actual assertion',()=>{
 const c=cases.find(x=>x.mustObserve.length>0);const x=receipt(c);
 assert.equal(classifyReceipt(c,'java',x).status,'failed');
 assert.equal(classifyReceipt(c,'java',{...x,guestOutput:c.mustObserve.join('\\n')}).status,'passed');
});
