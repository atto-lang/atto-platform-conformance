import test from 'node:test';
import assert from 'node:assert/strict';
import {CANARY_SOURCE,CANARY_PATH,CANARY_BLOB_SHA,CANARY_JOB,CANARY_STEP,
  gitBlobSha,verifyCanonicalCarrierWorkflow,CanaryPolicyError} from './canonical-carrier-workflow.mjs';
function valid() {return {type:'file',path:CANARY_PATH,encoding:'base64',
  sha:CANARY_BLOB_SHA,content:Buffer.from(CANARY_SOURCE).toString('base64')};}
test('canonical source-free workflow, SHA and job/step are stable',()=>{
  const v=verifyCanonicalCarrierWorkflow(valid(),CANARY_BLOB_SHA);
  assert.equal(v.source_free,true); assert.equal(v.blob_sha,CANARY_BLOB_SHA);
  assert.equal(gitBlobSha(CANARY_SOURCE),CANARY_BLOB_SHA);
  assert.equal(CANARY_JOB,'source-free-check');assert.equal(CANARY_STEP,'ADMISSION_PROOF');
  assert.doesNotMatch(CANARY_SOURCE,/checkout|pull_request_target|secret|\buses:|\bwrite:\s/);
});
const mutations=[
 ['null record',()=>null],['not object',()=>3],['wrong type',x=>(x.type='dir',x)],
 ['wrong path',x=>(x.path='.github/workflows/malicious.yml',x)],
 ['unsupported encoding',x=>(x.encoding='utf-8',x)],['non-string content',x=>(x.content=null,x)],
 ['empty content',x=>(x.content='',x)],['malformed content',x=>(x.content='%%%%',x)],
 ['missing padding',x=>(x.content=x.content.slice(0,-1),x)],
 ['extra whitespace inside encoded payload',x=>(x.content=' X'+x.content,x)],
 ['valid but altered workflow bytes',x=>(x.content=Buffer.from(CANARY_SOURCE+'#evil\n').toString('base64'),x)],
 ['public checkout inserted',x=>(x.content=Buffer.from(CANARY_SOURCE.replace('set -euo pipefail','git clone PRIVATE')).toString('base64'),x)],
 ['wrong Git API blob SHA',x=>(x.sha='b'.repeat(40),x)],
 ['missing API blob sha',x=>(delete x.sha,x)],
 ['wrong expected approved digest',x=>x],
 ['empty expected digest',x=>x],
 ['invalid expected digest',x=>x],
];
for(const [name,mutate] of mutations)test('reject '+name,()=>{
  const x=mutate(valid());
  const approved=name==='wrong expected approved digest'?'c'.repeat(40):
    name==='empty expected digest'?'':name==='invalid expected digest'?'notsha':CANARY_BLOB_SHA;
  assert.throws(()=>verifyCanonicalCarrierWorkflow(x,approved),CanaryPolicyError);
});


test('published carrier YAML has exactly the audited source-free bytes and blob SHA',async()=>{
  const {readFile} = await import('node:fs/promises');
  const bytes = await readFile(new URL('../templates/source-free-canary.yml',import.meta.url));
  assert.ok(bytes.equals(Buffer.from(CANARY_SOURCE,'utf8')));
  assert.equal(gitBlobSha(bytes),CANARY_BLOB_SHA);
});
