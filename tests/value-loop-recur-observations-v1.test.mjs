import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const mBytes=read('fixtures/value-loop-recur-v1/manifest.json');
const manifest=JSON.parse(mBytes);
const observations=JSON.parse(read('evidence/value-loop-recur-observations-v1.json'));
const exact=[
 ['rs-wasm','atto-lang/atto-source.rs','rs','11ad063c15cf493eb5660c7aaa3aa961da51f171','bfc048678138f2bea6669bb33cb2d9cc037fe740','https://github.com/streempilot-test/contract-conformance-tests/actions/runs/45947337466/job/140334944579','native and wasm32 hosts of the same Rust compiler; one family'],
 ['js-esm','atto-lang/atto-source.js','js','00fe167ac44b99de631f6f84388379054d952b65','400b38cf4e6cdb4bd6d8d0645864aff225e3d486','https://github.com/streempilot-test/contract-conformance-tests/actions/runs/45947833608/job/140336510523','independent JS program-v2 compiler and generated ESM execution'],
 ["java-graalvm","atto-lang/atto-source.java","java","ea83ff9b315d616301040d31539d9389d0996a4c","680f6014b04571179b4e7a843db257fea8b4a6b3","https://github.com/streempilot-test/contract-conformance-tests/actions/runs/45949439905/job/140342249220","GraalVM JVM guest passed; five baseline failures reproduced; Native Image unverified"],
 ["llvm-native","atto-lang/atto-source.llvm","llvm","a8be9cfac34127e0c328d8f20c315e56ebb4eb74","48e6ce8bef37707510ec35aa108a44995eb55e75","https://github.com/streempilot-test/contract-conformance-tests/actions/runs/45949589996/job/140342108204","native i64 observer O0/O2 passed; broader scalar suite stops at reproduced baseline double-caret failure"],
];
function validate(doc){
 assert.equal(doc.schema,'atto.value-loop-recur.observations.v1');
 assert.equal(doc.full_parity_certified,false);
 assert.equal(doc.manifest_blob,blob(mBytes));
 assert.equal(doc.cases.length,1);
 const c=doc.cases[0];
 assert.equal(c.id,'230-stateless-value-loop');
 const target=manifest.cases.find(x=>x.id===c.id);
 assert.equal(c.source_blob,target.blob);
 assert.equal(blob(read('fixtures/value-loop-recur-v1/'+target.path)),c.source_blob);
 assert.equal(c.observations.length,4);
 for(let i=0;i<4;i++){
  const r=c.observations[i];
  assert.deepEqual([r.profile,r.repo,r.compiler_family,r.commit,r.tree,r.receipt,r.scope],exact[i]);
  assert.equal(r.return_i64,target.expected.return_i64);
  assert.equal(r.stdout,target.expected.stdout);
 }
 assert.equal(new Set(c.observations.map(r=>r.compiler_family)).size,4);
 assert.equal(new Set(c.observations.map(r=>r.receipt)).size,4);
 assert.ok(Object.values(manifest.profile_status).every(x=>x==='NOT_EXECUTED'));
}
test('one exact source executed by four independent compiler families',()=>validate(observations));
test('reject evidence drift, family duplication, mismatched source and false full certification',()=>{
 for(const mutate of [
  d=>d.full_parity_certified=true,
  d=>d.cases[0].source_blob='0'.repeat(40),
  d=>d.cases[0].observations[0].return_i64='43',
  d=>d.cases[0].observations[1].stdout='extra',
  d=>d.cases[0].observations[1].compiler_family='rs',
  d=>d.cases[0].observations[1].receipt=d.cases[0].observations[0].receipt,
  d=>d.cases[0].observations[0].tree='0'.repeat(40),
  d=>d.cases[0].observations.push(d.cases[0].observations[0])
 ]){
  const d=structuredClone(observations);mutate(d);assert.throws(()=>validate(d));
 }
});
