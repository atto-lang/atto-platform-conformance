import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadManifest,validateManifest,expectedPrivateHookDiagnostic,runCompilerCandidates} from '../src/manifest.mjs';
const sha='a'.repeat(40);const argv=[process.execPath,'{file}'];
const mock=(_bin,args)=>{
 const file=args.at(-1);if(file.includes('-reject.ores'))return {status:1,stdout:'',stderr:'error: receive is private and not callable from user source'};
 return {status:0,stdout:'',stderr:''};
};
test('all six Git-blob/SHA256-pinned files and five tasks validate',async()=>{const x=await loadManifest();assert.equal(x.tasks.length,5);assert.equal(x.sourceCases.length,6);assert.equal(x.certifiedParity,false);});
test('schema rejects unreviewed promotion, missing backend and tampered pins',async()=>{
 const x=await loadManifest();
 for(const change of [m=>m.certifiedParity=true,m=>m.sourceBackends.pop(),m=>m.tasks[0].id=16,m=>m.sourceCases[0].sha256='0',m=>m.sourceCases[0].backendReadiness.java='verified',m=>m.sourceCases[0].path='../escape.ores']){
  const m=structuredClone(x);change(m);assert.throws(()=>validateManifest(m),/wave3:/);
 }
});
test('unknown and generic syntax errors do not verify private receive policy',()=>{
 assert.equal(expectedPrivateHookDiagnostic('error: unexpected token receive'),false);
 assert.equal(expectedPrivateHookDiagnostic('warning: receive is private'),false);
 assert.equal(expectedPrivateHookDiagnostic('error: receive is private and not callable'),true);
});
test('unconfigured compiler is never verified',async()=>{
 const r=await runCompilerCandidates({backend:'java'});assert.equal(r.configured,false);assert.equal(r.parityVerified,false);assert.equal(r.cases.length,6);
});
test('fake compiler observation checks runner boundaries but never certifies parity',async()=>{
 const r=await runCompilerCandidates({backend:'java',argv,sourceSha:sha,spawn:mock});
 assert.equal(r.status,'SOURCE_ADMISSION_OBSERVED');assert.equal(r.verified,false);assert.equal(r.provenanceVerified,false);
});
test('reject-all and generic syntax rejections cannot be promoted',async()=>{
 const r=await runCompilerCandidates({backend:'java',argv,sourceSha:sha,spawn:()=>({status:1,stdout:'',stderr:'error: unsupported source syntax'})});
 assert.equal(r.status,'INCOMPLETE');assert.ok(r.cases.every(c=>c.status==='MISMATCH'));
});
test('timeout, signal and malformed command are denied',async()=>{
 for(const response of [{status:null,error:{code:'ETIMEDOUT'}},{status:null,signal:'SIGSEGV'},{status:127,stdout:'',stderr:'error: receive is private'}]){
  const r=await runCompilerCandidates({backend:'java',argv,sourceSha:sha,spawn:()=>response});assert.equal(r.status,'INCOMPLETE');
 }
 await assert.rejects(runCompilerCandidates({backend:'java',argv:['node','{file}'],sourceSha:sha}),/wave3:/);
});
test('CLI --validate is contract-only, and no runner exits unconfigured',()=>{
 const cli=new URL('../bin/wave3.mjs',import.meta.url).pathname;
 const x=spawnSync(process.execPath,[cli,'--validate'],{encoding:'utf8'});
 assert.equal(x.status,0);assert.match(x.stdout,/SOURCE_CONTRACT_VALID_ONLY/);
 const y=spawnSync(process.execPath,[cli,'--backend=llvm'],{encoding:'utf8'});
 assert.equal(y.status,3);assert.match(y.stdout,/UNCONFIGURED/);
 const z=spawnSync(process.execPath,[cli,'--backend=java','--backend=llvm'],{encoding:'utf8'});assert.equal(z.status,2);
});
