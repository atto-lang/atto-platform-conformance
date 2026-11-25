import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyHttpContract, contractDigest, verifyHttpReceipt, verifyHttpParity } from '../bin/verify-http-native-receipts.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract=JSON.parse(fs.readFileSync(path.join(root,'contracts/http-native-v1.json'),'utf8'));
const SHA='a'.repeat(40), DIGEST='b'.repeat(64);
function receipt(backend='java', stage='native-execution') {
  const e={workflowUrl:`https://github.com/${contract.backends[backend]}/actions/runs/123`,runId:123,runnerId:45,executedSteps:10,conclusion:'success',exactHead:true,compilerBinarySha256:DIGEST,compilerChecked:true,guestExecuted:stage==='native-execution',nativeGuestSteps:stage==='native-execution'?7:0,targetArtifactSha256:DIGEST,caseResults:stage==='native-execution'?contract.cases.map(id=>({id,result:'pass'})):[]};
  return {schema:'oreslang.http-native-receipt/1',backend,repository:contract.backends[backend],profile:contract.profiles[backend][0],stage,contractSha256:contractDigest(contract),demoCommit:SHA,compilerCommit:SHA,evidence:stage==='unsupported'?null:e};
}
const all=()=>Object.keys(contract.backends).map(name=>receipt(name));
const fail=(mutate,regex)=>{const r=receipt();mutate(r);const x=verifyHttpReceipt(r,contract);assert.equal(x.ok,false,JSON.stringify(x));assert.match(x.errors.join(' '),regex);};

test('canonical contract is pinned and all five distinct native receipts qualify as shapes',()=>{
 assert.deepEqual(verifyHttpContract(contract),[]);
 const v=verifyHttpParity(all(),contract);assert.deepEqual(v,{ok:true,parity:true,errors:[]});
});
test('unsupported is valid disclosure but never counts toward parity',()=>{
 const r=receipt('cranelift','unsupported');assert.deepEqual(verifyHttpReceipt(r,contract),{ok:true,qualified:false,errors:[]});
 const mixed=all();mixed[3]=r;const x=verifyHttpParity(mixed,contract);assert.equal(x.ok,true);assert.equal(x.parity,false);
});
test('compiler check is not HTTP runtime parity',()=>{
 const r=receipt('wasm','compiler-check');const x=verifyHttpReceipt(r,contract);assert.equal(x.ok,true);assert.equal(x.qualified,false);
 const mixed=all();mixed[2]=r;assert.equal(verifyHttpParity(mixed,contract).parity,false);
});
test('zero steps, no runner, no guest, failure never qualify',()=>{
 for(const [field,value] of [['executedSteps',0],['runnerId',0],['nativeGuestSteps',0],['guestExecuted',false],['conclusion','failure'],['exactHead',false],['compilerChecked',false]]) {
   fail(r=>{r.evidence[field]=value}, /step|runner|guest|workflow|compiler/i);
 }
});
test('rejects substituted repo and mismatched run url',()=>{
 fail(r=>{r.repository='attacker/test'},/repository/);
 fail(r=>{r.evidence.workflowUrl='https://github.com/attacker/test/actions/runs/123'},/URL|run URL/i);
 fail(r=>{r.evidence.runId=124},/run URL/i);
});
test('rejects branch refs and invalid signed/digest inputs',()=>{
 fail(r=>{r.compilerCommit='main'},/compilerCommit/);
 fail(r=>{r.demoCommit=SHA.toUpperCase()},/demoCommit/);
 fail(r=>{r.evidence.compilerBinarySha256='f'.repeat(20)},/SHA256/);
 fail(r=>{r.contractSha256=DIGEST},/digest/);
});
test('rejects unknown or inherited backend and incorrect profile',()=>{
 for(const backend of ['__proto__','constructor','forge','Java']) {
   const r=receipt();r.backend=backend;assert.equal(verifyHttpReceipt(r,contract).ok,false);
 }
 fail(r=>{r.profile='node-host'},/profile/);
});
test('rejects case omissions, duplicates, reorder, failed result, and extra fields',()=>{
 fail(r=>{r.evidence.caseResults.pop()},/case evidence/);
 fail(r=>{r.evidence.caseResults[1].id=r.evidence.caseResults[0].id},/case evidence/);
 fail(r=>{r.evidence.caseResults.reverse()},/case evidence/);
 fail(r=>{r.evidence.caseResults[3].result='skipped'},/case evidence/);
 fail(r=>{r.evidence.caseResults[0].forged=true},/case evidence/);
});
test('rejects unsupported stage claiming execution',()=>{
 fail(r=>{r.stage='unsupported'},/unsupported stage/);
});
test('rejects compiler-only claimed runtime',()=>{
 fail(r=>{r.stage='compiler-check'},/compiler-check stage/);
});
test('rejects missing, duplicate and swapped backend receipts',()=>{
 assert.equal(verifyHttpParity(all().slice(0,4),contract).ok,false);
 const x=all();x[4]=receipt('java');assert.equal(verifyHttpParity(x,contract).ok,false);
});
test('contract mutations cannot redefine the parity bar',()=>{
 for(const mutate of [c=>c.cases.pop(), c=>c.cases.reverse(), c=>c.backends.java='other/java', c=>c.profiles.net=['managed'], c=>{c.backends.forge='other/forge'}]) {
  const altered=structuredClone(contract);mutate(altered);assert.ok(verifyHttpContract(altered).length>0);
  assert.equal(verifyHttpParity(all(),altered).parity,false);
 }
});
test('receipt rejects extra keys and ambiguous evidence',()=>{
 fail(r=>{r.evidence.hostOnly=true},/evidence keys/);
 fail(r=>{r.shadow=true},/receipt keys/);
 fail(r=>{r.evidence.caseResults=null},/case evidence/);
});
