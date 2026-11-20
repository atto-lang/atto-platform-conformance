import test from 'node:test';
import assert from 'node:assert/strict';
import {runSuite} from '../src/harness.mjs';
const sha = '012345678901234567890123456789abcdefabcd';

test('missing/unhashable executable cannot be VERIFIED by fabricated successful subprocess',async()=>{
 const r=await runSuite({
  backend:'java',sourceSha:sha,argv:['/no/such/compiler-for-hash-guard','{file}'],
  spawn:()=>({status:0,signal:null,stdout:'',stderr:''})
 });
 assert.equal(r.ok,false);
 assert.equal(r.verified,0);
 assert.deepEqual(r.results.map(x=>x.status),['UNHASHABLE_EXECUTABLE','UNHASHABLE_EXECUTABLE']);
 assert.equal(r.executableSha256,null);
});

test('positive fixture reporting a compiler error cannot verify despite zero exit',async()=>{
 const r=await runSuite({
  backend:'llvm',sourceSha:sha,argv:[process.execPath,'{file}'],
  spawn:(exe,args)=>args.at(-1).endsWith('unresolved-identifier.ores')
    ? {status:1,signal:null,stdout:'',stderr:'error: unresolved identifier nonexistent_symbol'}
    : {status:0,signal:null,stdout:'',stderr:'src/main.ores:2: error: undefined name x'}
 });
 assert.equal(r.ok,false);
 assert.equal(r.results[0].status,'MISMATCH');
 assert.equal(r.results[1].status,'VERIFIED');
});

test('a legitimate warning with successful exit does not invalidate positive fixture',async()=>{
 const r=await runSuite({
  backend:'forge',sourceSha:sha,argv:[process.execPath,'{file}'],
  spawn:(exe,args)=>args.at(-1).endsWith('unresolved-identifier.ores')
    ? {status:1,signal:null,stdout:'',stderr:'error: unresolved identifier nonexistent_symbol'}
    : {status:0,signal:null,stdout:'',stderr:'warning: unused variable'}
 });
 assert.equal(r.ok,true);
 assert.equal(r.verified,2);
});

test('negative fixture cannot verify when executable is unhashable even with a matching diagnostic',async()=>{
 const r=await runSuite({
  backend:'net',sourceSha:sha,argv:['/no/such/compiler-for-hash-guard','{file}'],
  spawn:()=>({status:1,signal:null,stdout:'',stderr:'error: unresolved identifier nonexistent_symbol'})
 });
 assert.equal(r.ok,false);
 assert.equal(r.verified,0);
 assert.equal(r.results[1].status,'UNHASHABLE_EXECUTABLE');
});


test('indented and fatal compiler errors cannot verify positive fixture',async()=>{
 for(const stderr of [
  '  error: missing identifier xyz',
  'fatal error: unreadable input',
  'main.ores:2:13: fatal error: toolchain failed',
 ]) {
  const result=await runSuite({
   backend:'llvm',sourceSha:sha,argv:[process.execPath,'{file}'],
   spawn:(exe,args)=>args.at(-1).endsWith('unresolved-identifier.ores')
    ? {status:1,signal:null,stdout:'',stderr:'error: unresolved identifier nonexistent_symbol'}
    : {status:0,signal:null,stdout:'',stderr}
  });
  assert.equal(result.results[0].status,'MISMATCH',stderr);
  assert.equal(result.ok,false,stderr);
 }
});
