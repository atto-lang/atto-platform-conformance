import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {VALIDATORS,assessValidatorOutput,assessValidatorProcess,runSourceValidator} from '../src/source-validation.mjs';
const output=(wave)=>JSON.stringify({...([{}, {},{status:'SOURCE_CONTRACT_VALID_ONLY'},{status:'CONTRACT_VALID_ONLY'},{status:'SOURCE_CONTRACT_ONLY'},{status:'PINNED_CONTRACT_ONLY'}][wave-1]),[VALIDATORS[wave-1].flag]:false});
test('42 / all six independently pinned source validator CLIs are identified',()=>{
 assert.equal(VALIDATORS.length,6);assert.equal(new Set(VALIDATORS.map(x=>x.sha)).size,6);
 VALIDATORS.forEach((v,i)=>assert.match(v.path,new RegExp('wave'+(i+1))));
});
test('42 / correct source-only contract outputs accepted without promotion',()=>{
 for(let i=1;i<=6;i++){const r=assessValidatorOutput(i,output(i));assert.equal(r.status,'SOURCE_FIXTURES_VALIDATED_HOST_ONLY');assert.equal(r.compilerExecuted,false)}
});
test('42 / missing, false-positive and forged compiler attestations rejected',()=>{
 for(let i=1;i<=6;i++){
  const d=JSON.parse(output(i));d[VALIDATORS[i-1].flag]=true;
  assert.throws(()=>assessValidatorOutput(i,JSON.stringify(d)),/claims/);
  d[VALIDATORS[i-1].flag]=false;d.parityVerified=true;
  assert.throws(()=>assessValidatorOutput(i,JSON.stringify(d)),/promotion/);
 }
});
test('42 / incorrect statuses, invalid JSON and malformed types rejected',()=>{
 for(const value of ['success','[]','{}','true','not-json'])assert.throws(()=>assessValidatorOutput(3,value),/source-validation/);
 const r=JSON.parse(output(4));r.status='COMPILER_VERIFIED';assert.throws(()=>assessValidatorOutput(4,JSON.stringify(r)),/mismatched/);
});
test('42 / subprocess exit, signal or stderr cannot turn failure into fixture validation',()=>{
 for(const o of [{status:1},{signal:'SIGKILL'},{stderr:'WARNING'},{error:Error('timed out')}])assert.throws(()=>assessValidatorProcess(4,{status:0,stdout:output(4),stderr:'',signal:null,error:null,...o}),/unsuccessfully/);
});
test('42 / real Node child source-control JSON validates but is only host evidence',()=>{
 const script='process.stdout.write('+JSON.stringify(output(3))+')';
 const p=spawnSync(process.execPath,['-e',script],{encoding:'utf8'});
 assert.equal(assessValidatorProcess(3,p).parityVerified,false);
});
test('42 / tampered local validator bytes refused before execution',async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'ores-validator-'));
 try{
  const dir=join(tmp,'parity','wave4','bin');await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'manifest.mjs'),'process.stdout.write('+JSON.stringify(output(4))+');');
  await assert.rejects(runSourceValidator({wave:4,root:tmp}),/Git blob differs/);
 }finally{await rm(tmp,{recursive:true,force:true})}
});
