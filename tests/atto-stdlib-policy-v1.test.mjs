import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectAttoStdlibPolicyV1} from '../src/atto-stdlib-policy-v1.mjs';
const original=JSON.parse(readFileSync(new URL('../contracts/atto-stdlib-policy-v1.json',import.meta.url),'utf8'));
const changed=mutate=>{const obj=structuredClone(original);mutate(obj);return obj;};
test('source-only five-backend contract never claims guest execution',()=>{
  assert.deepEqual(inspectAttoStdlibPolicyV1(original),{
    evidence_class:'SOURCE_ONLY',module_count:5,backend_count:5,guest_executed:false
  });
});
for(const [name,change] of [
  ['schema spoof',d=>{d.schema='success';}],
  ['unexpected promotion field',d=>{d.promotion={safe_to_merge:true};}],
  ['source head spoof',d=>{d.source.head_sha='f'.repeat(40);}],
  ['source tree spoof',d=>{d.source.tree_sha='f'.repeat(40);}],
  ['parent head spoof',d=>{d.source.parent_head_sha='f'.repeat(40);}],
  ['module removed',d=>{d.policies.pop();}],
  ['module cloned',d=>{d.policies[4]={...d.policies[0]};}],
  ['module blob spoof',d=>{d.policies[0].source_blob_sha='a'.repeat(40);}],
  ['legacy .ores imported',d=>{d.policies[1].source_path='stdlib/region_policy.ores';}],
  ['guest fixture replacement',d=>{d.policies[0].guest_fixture='fake.atto';}],
  ['Java oracle replacement',d=>{d.policies[2].java_oracle='Object';}],
  ['backend missing',d=>{d.backends.pop();}],
  ['backend duplicate',d=>{d.backends[4]={...d.backends[3]};}],
  ['forge impersonates cranelift repo',d=>{d.backends[4].repository='ores-truffle-oreslang/oreslang-source.cranelift';}],
  ['Java claims PASS',d=>{d.backends[0].status='PASS';}],
  ['Java fake runner',d=>{d.backends[0].runner_id=42;}],
  ['Java fake steps',d=>{d.backends[0].executed_steps=5;}],
  ['Java forged guest receipt',d=>{d.backends[0].guest_receipt={passed:true};}],
  ['LLVM forged compiler receipt',d=>{d.backends[1].compiler_receipt='green';}],
  ['LLVM false PASS',d=>{d.backends[1].status='PASS';}],
  ['cross-backend fake verification',d=>{d.gates.cross_backend_verified=true;}],
  ['review fake approval',d=>{d.gates.independent_review_approved=true;}],
  ['merge gate bypass',d=>{d.gates.safe_to_merge=true;}]
]) {
  test('reject '+name,()=>assert.throws(()=>inspectAttoStdlibPolicyV1(changed(change))));
}
