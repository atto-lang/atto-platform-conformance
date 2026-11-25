import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {verifyUserlandReceipt,readBoundedJson} from '../tools/verify-userland-portability.mjs';
const c=JSON.parse(readFileSync(new URL('../contracts/userland-portability-v1.json',import.meta.url),'utf8'));
const H='a'.repeat(40), T='b'.repeat(40), D='d'.repeat(64), E='e'.repeat(64);
const profile='java';
function fixture(){
 return {schemaVersion:1,contract:c.contract,profile,compilerRepository:c.profiles[profile],
  fixtureRepository:c.fixtureRepository,fixtureCommitSha:c.fixtureCommitSha,fixtureTreeSha:T,
  compilerCommitSha:H,compilerTreeSha:T,compilerBinarySha256:D,guestArtifactSha256:E,
  run:{repository:c.fixtureRepository,headSha:c.fixtureCommitSha,id:7,attempt:1,status:'completed',conclusion:'success',
   jobs:[{id:11,runnerId:17,runId:7,attempt:1,headSha:c.fixtureCommitSha,status:'completed',conclusion:'success',steps:[
    'Checkout exact Oreslang sources','Compile Oreslang guest','Execute Oreslang guest'
   ].map(name=>({name,status:'completed',conclusion:'success'}))}]},
  cases:c.fixtures.map(f=>({id:f.id,sourceBlobSha:f.sourceBlobSha,oracleBlobSha:f.oracleBlobSha,
    stdout:f.stdout,exitCode:0,executionKind:'compiled-ores-guest',guestBinarySha256:E,jobId:11}))};
}
const grade=r=>verifyUserlandReceipt(r,c).classification;
const reject=(mutate)=>{const x=fixture();mutate(x);assert.equal(grade(x),'UNVERIFIED');};
test('six independent toolchain profiles including native Cranelift and Forge',()=>{
 assert.deepEqual(Object.keys(c.profiles),['java','llvm','wasm','cranelift','net','forge']);
 assert.equal(c.profiles.cranelift,'ores-truffle-oreslang/oreslang-source.cranelift');
 assert.equal(c.fixtures.length,5);
 assert.equal(c.fixtureCommitSha,'b7e92b77e86ffe2be29fa9163e61787285c2b245');
});
test('a complete report is a metadata candidate, not portable proof or source authorization',()=>{
 const x=verifyUserlandReceipt(fixture(),c);
 assert.equal(x.classification,'RECEIPT_METADATA_CONSISTENT');
 assert.equal(x.candidateCases,5);
 assert.equal(x.portable,false);assert.equal(x.independentlyAttested,false);
 assert.equal(x.privateSourceExportAuthorized,false);
});
test('each compiler can produce candidate only with its own exact repository identity',()=>{
 for(const [p,repo] of Object.entries(c.profiles)){const x=fixture(); x.profile=p;x.compilerRepository=repo;assert.equal(grade(x),'RECEIPT_METADATA_CONSISTENT');}
});
test('identity and artifact substitutions fail closed',()=>{
 for(const mutate of [x=>x.profile='unknown',x=>x.compilerRepository=c.profiles.llvm,
  x=>x.fixtureRepository='foreign/source',x=>x.fixtureCommitSha='short',x=>x.fixtureCommitSha=H,
  x=>x.fixtureTreeSha=null,x=>x.compilerCommitSha=null,x=>x.compilerTreeSha='A'.repeat(40),
  x=>x.compilerBinarySha256='bad',x=>x.guestArtifactSha256=null,
  x=>x.run.repository='evil/workflow',x=>x.run.repository=x.compilerRepository,
  x=>x.run.headSha=T,x=>x.run.headSha=x.compilerCommitSha])reject(mutate);
});
test('a failed, skipped, incomplete or identity-swapped run cannot certify a guest',()=>{
 for(const mutate of [x=>x.run.conclusion='failure',x=>x.run.status='queued',x=>x.run.id=0,
  x=>x.run.attempt=0,x=>x.run.jobs=[],x=>x.run.jobs.push(structuredClone(x.run.jobs[0])),
  x=>x.run.jobs[0].runnerId=0,x=>delete x.run.jobs[0].runnerId,
  x=>x.run.jobs[0].runId=12,x=>x.run.jobs[0].headSha=T,
  x=>x.run.jobs[0].attempt=3,x=>x.run.jobs[0].status='queued',
  x=>x.run.jobs[0].conclusion='failure',x=>x.run.jobs[0].steps=[],
  x=>x.run.jobs[0].steps[2].status='skipped',
  x=>x.run.jobs[0].steps[2].conclusion='failure',
  x=>x.run.jobs[0].steps.push(structuredClone(x.run.jobs[0].steps[2])),
  x=>x.run.jobs[0].steps=[null],x=>x.run.jobs[0]=null])reject(mutate);
});
test('forged, host-only or partial fixture outputs fail closed',()=>{
 for(const mutate of [x=>x.cases.pop(),x=>x.cases.push(structuredClone(x.cases[0])),
  x=>x.cases[0].id='foreign',x=>x.cases[0].sourceBlobSha=T,
  x=>x.cases[0].oracleBlobSha=T,x=>x.cases[0].stdout='PASS:other\n',
  x=>x.cases[0].stdout=x.cases[0].stdout.trim(),x=>x.cases[0].exitCode=42,
  x=>x.cases[0].executionKind='host-model',x=>x.cases[0].guestBinarySha256='bad',
  x=>x.cases[0].jobId=12,x=>x.cases[0]=null])reject(mutate);
});
test('malformed receipt and contract structures fail safely',()=>{
 for(const x of [null,[],true,'string',{}, {schemaVersion:1,contract:c.contract,profile:'java'}])
  assert.equal(grade(x),'UNVERIFIED');
 for(const faulty of [{...c,fixtures:[]},{...c,profiles:null},{...c,contract:'other'}])
  assert.equal(verifyUserlandReceipt(fixture(),faulty).classification,'UNVERIFIED');
});
test('bounded loader rejects untrusted special and oversized files', {skip:process.platform==='win32'},()=>{
 const dir=mkdtempSync(join(tmpdir(),'ores-userland-evidence-'));
 try{
  const ok=join(dir,'ok.json'),zero=join(dir,'empty.json'),big=join(dir,'big.json'),ln=join(dir,'link.json'),fifo=join(dir,'fifo');
  writeFileSync(ok,JSON.stringify(fixture()));writeFileSync(zero,'');writeFileSync(big,'x'.repeat(256*1024+1));
  symlinkSync(ok,ln);execFileSync('mkfifo',[fifo]);
  assert.equal(grade(readBoundedJson(ok)),'RECEIPT_METADATA_CONSISTENT');
  for(const p of [zero,big,ln,fifo])assert.throws(()=>readBoundedJson(p));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('CLI returns nonzero even on consistent self-reported evidence',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ores-userland-cli-'));
 try {
  const path=join(dir,'candidate.json');writeFileSync(path,JSON.stringify(fixture()));
  const p=spawnSync(process.execPath,[new URL('../tools/verify-userland-portability.mjs',import.meta.url).pathname,path],{encoding:'utf8'});
  assert.equal(p.status,3);assert.equal(JSON.parse(p.stdout).classification,'RECEIPT_METADATA_CONSISTENT');
  const q=spawnSync(process.execPath,[new URL('../tools/verify-userland-portability.mjs',import.meta.url).pathname,join(dir,'missing.json')],{encoding:'utf8'});
  assert.equal(q.status,2);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
