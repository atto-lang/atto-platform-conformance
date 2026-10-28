import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verify} from './verify.mjs';
import {readFileSync} from 'node:fs';
const m = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url)));
const receipt = () => ({
  backend: 'llvm', kind: 'ACTUAL_COMPILED_ORES_GUEST', sourceCommit:'a'.repeat(40),sourceTree:'b'.repeat(40),compilerSha256:'c'.repeat(64),guestArtifactSha256:'d'.repeat(64),sourceSha256:m.source.sha256,
  runId:11,jobId:12,attempt:1,guestStdout:['1','2','1','2'],guestExitCode:0,
  steps:['compiler_build','guest_compile','guest_execute','reject_foreign_access','reject_read_loan_write'].map((name,i)=>({name,number:i+1,executed:true,conclusion:'success'})),
  negatives:Object.fromEntries(m.negativeCases.map(c=>[c.id,{sourceSha256:c.sha256,exitCode:1,diagnosticClass:c.requiredDiagnosticClass,outputArtifacts:0}]))
});
test('consistent claimed receipt remains UNATTESTED, not physical or publication evidence',()=>{
  const x=verify(receipt());assert.equal(x.ok,true);assert.equal(x.independentlyAttested,false);assert.equal(x.physicallyQuiescentVerified,false);assert.equal(x.publiclyPromotable,false);
});
for (const [label,mutate] of [
  ['host substitute',r=>{r.kind='HOST_STORAGE'}],
  ['missing guest execution',r=>{r.steps[2].executed=false}],
  ['duplicate CI steps',r=>{r.steps[1].number=1}],
  ['actor state alias',r=>{r.guestStdout=['1','2','3','4']}],
  ['foreign access accepted',r=>{r.negatives['foreign-state'].exitCode=0}],
  ['read-loan illegal write accepted',r=>{r.negatives['read-loan-write'].outputArtifacts=1}],
  ['wrong source blob',r=>{r.sourceSha256='a'.repeat(64)}],
  ['zero-step workflow',r=>{r.steps=[]}]
]) test(`reject ${label}`,()=>{const r=receipt();mutate(r);assert.equal(verify(r).ok,false)});
