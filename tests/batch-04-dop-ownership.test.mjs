import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const manifest=JSON.parse(readFileSync(
  new URL("../audits/batch-04-dop-ownership.json",import.meta.url),"utf8"));
const expected=[
  [31,"oreslang-source.java",1424,"DOP_GUEST_INVERTED_CLASS"],
  [32,"oreslang-source.llvm",658,"NATIVE_SOURCE_SOA_LOWERING"],
  [33,"oreslang-source.java",1349,"SEALED_ACTOR_RW_GUEST"],
  [34,"oreslang-source.llvm",635,"NATIVE_LINEAR_RW_GUARDS"],
  [35,"oreslang-source.llvm",636,"NATIVE_STOP_CONTROL_RW"],
  [36,"oreslang-source.java",853,"WRITABLE_RECORD_INVARIANCE"],
  [37,"oreslang-source.java",821,"RECORD_STRUCT_CONTRACT"],
  [38,"oreslang-source.llvm",579,"OWNERSHIP_PROVEN_SIMD"],
  [39,"oreslang-source.llvm",462,"NATIVE_IMMUTABLE_REDUCER"],
  [40,"oreslang-data-science",9,"OWNED_NDARRAY_ABI"]
];

test("original Batch 4 identity and release gates are exact",()=>{
  assert.equal(manifest.schema,1);
  assert.equal(manifest.batch,4);
  assert.equal(manifest.items.length,10);
  expected.forEach(([task,repo,num,gate],index)=>{
    const item=manifest.items[index];
    assert.equal(item.task,task);
    assert.equal(item.repository,"ores-truffle-oreslang/"+repo);
    assert.equal(item.number,num);
    assert.equal(item.gate,gate);
    assert.equal(item.url,"https://github.com/"+item.repository+"/issues/"+num);
    assert.equal(item.state,"PENDING_REAL_GUEST_EVIDENCE");
  });
  assert.equal(new Set(manifest.items.map(x=>x.url)).size,10);
});

test("missing source-local runtime/compiler execution cannot be certified",()=>{
  for(const key of ["guestRuntime","javaCompiler","llvmCompiler"])
    assert.equal(manifest.evidence[key],"NOT_ATTESTED");
  assert.equal(manifest.evidence.sourceFreeChecks,"NON_CERTIFYING");
  assert.equal(manifest.evidence.privateSourceExport,"DENIED_WITHOUT_APPROVAL");
});

test("an audit entry is never a release artifact or an authority token",()=>{
  for(const item of manifest.items){
    assert.equal("githubToken" in item,false);
    assert.equal("sourceTreeExport" in item,false);
    assert.equal("guestPassed" in item,false);
    assert.equal("releaseCertified" in item,false);
  }
});
