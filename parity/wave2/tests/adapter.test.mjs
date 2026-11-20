import test from 'node:test';
import assert from 'node:assert/strict';
import {executeAdapter,validateAdapterArgv} from '../src/adapter.mjs';
const SHA='1'.repeat(40);
const argv=[process.execPath,'{file}','{mode}'];
test('requires absolute no-shell adapter command with separate file and mode',()=>{
 assert.doesNotThrow(()=>validateAdapterArgv(argv));
 for(const bad of [['node','{file}','{mode}'],[process.execPath,'{file}'],[process.execPath,'{file}','{file}','{mode}'],[process.execPath,'p{file}','{mode}'],[process.execPath,'{file}','{mode}','{unknown}']]){
  assert.throws(()=>validateAdapterArgv(bad),/wave2 runner:/);
 }
});
test('adapter mock exercises subprocess orchestration, not compiler parity',async()=>{
 let calls=0;
 const mock=(exe,args,opts)=>{
  calls++;assert.equal(exe,process.execPath);assert.equal(opts.shell,false);assert.equal(opts.timeout,10000);
  assert.equal(args.at(-1),'execute');assert.match(args.at(-2),/numeric-.*\.ores$/);
  const value=args.at(-2).includes('exact-integer')?1:42;
  return {status:0,stdout:JSON.stringify({phase:'guest-executed',exitCode:0,stderr:'',observed:{kind:'integer',value}}),stderr:''};
 };
 const r=await executeAdapter({backend:'llvm',area:'numeric',argv,sourceCommit:SHA,spawn:mock});
 assert.equal(calls,2);assert.equal(r.report.observations.length,2);assert.equal(r.evaluation.consistent,true);
 assert.equal(r.evaluation.authenticityAttested,false);assert.equal(r.evaluation.semanticParityCertified,false);
});
test('adapter rejected process is a mismatch, not forged guest output',async()=>{
 const r=await executeAdapter({backend:'forge',area:'numeric',argv,sourceCommit:SHA,spawn:()=>({status:2,stdout:'error: compile failed',stderr:'error: compile failed'})});
 assert.equal(r.evaluation.consistent,false);assert.equal(r.report.observations[0].phase,'adapter-error');
});
test('adapter timeout and malformed JSON fail closed',async()=>{
 for(const fake of [
  ()=>({status:null,error:{code:'ETIMEDOUT'},stdout:'',stderr:''}),
  ()=>({status:0,stdout:'{not-json',stderr:''}),
  ()=>({status:0,stdout:JSON.stringify({phase:'guest-executed',exitCode:0,stderr:'',observed:{kind:'integer',value:42}}),stderr:'error: underlying compiler crashed'}),
  ()=>({status:0,stdout:'{"phase":"guest-executed","exitCode":0,"stderr":""}',stderr:''})
 ]){
  const r=await executeAdapter({backend:'java',area:'numeric',argv,sourceCommit:SHA,spawn:fake});
  assert.equal(r.evaluation.consistent,false);
 }
});
test('does not run unsupported category or accept unknown source revision',async()=>{
 await assert.rejects(executeAdapter({backend:'forge',area:'effects',argv,sourceCommit:SHA}),/no candidate cases/);
 await assert.rejects(executeAdapter({backend:'java',area:'numeric',argv,sourceCommit:'HEAD'}),/source SHA/);
});
