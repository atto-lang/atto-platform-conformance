import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Source-free admission: verifies fixture bytes and receipt scope, not a compiler or a guest.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const registry=JSON.parse(readFileSync(path.join(root,"contracts/functor-adt-v1.json"),"utf8"));
const expectedOutput=new Map([
  ["nested-functor-positive","FNV1:"+"1".repeat(16)+":END"],
  ["nested-functor-depth-positive","FNV2:"+"1".repeat(20)+":END"],
]);

test("versioned functor contract has pinned current Java JVM evidence, not fake backend parity",()=>{
  assert.equal(registry.contract_id,"functor-adt-v1");
  assert.equal(registry.schema_version,1);
  assert.equal(registry.status,"PARTIAL_JAVA_JVM_AND_AOT_NOT_FIVE_BACKEND_PARITY");
  assert.deepEqual(registry.target_backends,["java","llvm","wasm","forge","net","cranelift"]);
  assert.equal(registry.source.source_commit,"faa149c6bcc7510a659c86499f614efdaffcc4e8");
  assert.equal(registry.source.fixture_tree,"be201b1c667057582a6e7e53025bb1d1938179c6");
  assert.equal(registry.evidence.java.tier,"EXACT_BLOB_SUBSET_GUEST_EXECUTED");
  assert.equal(registry.evidence.java.junit_tests,3);
  assert.equal(registry.evidence.java.positive_assertions,36);
  assert.equal(registry.evidence.java.negative_fixtures,15);
  assert.equal(registry.evidence.java_native_aot.current_source_verified,true);
  assert.equal(registry.evidence.java_native_aot.tier,"NATIVE_IMAGE_AOT_GUEST_EXECUTED_EXACT_BLOB_SUBSET");
  assert.equal(registry.evidence.java_native_aot.positive_guest_cases,2);
  assert.equal(registry.evidence.java_native_aot.positive_assertions,36);
  assert.equal(registry.evidence.java_native_aot.negative_compiler_cases,15);
  assert.equal(registry.evidence.java_native_aot.remaining_negative_cases,0);
  assert.equal(registry.evidence.java_native_aot.build_mode,"aot");
  assert.equal(registry.evidence.java_native_aot.guest_execution,"interpreter-no-jit");
  assert.equal(registry.evidence.java_native_aot.source_head,registry.source.source_commit);
  assert.notEqual(registry.evidence.historical_java_native_aot.source_head,registry.source.source_commit);
  assert.equal(registry.evidence.other_backends,"NOT_EXECUTED");
});

test("all 17 original .atto source fixtures match Git blob SHA and required diagnostics",()=>{
  assert.equal(registry.cases.length,17);
  const ids=new Set();
  for(const c of registry.cases){
    assert.ok(!ids.has(c.id),"duplicate "+c.id);ids.add(c.id);
    assert.match(c.path,/^fixtures\/functor-adt-v1\/[a-z0-9-]+\.atto$/);
    const content=readFileSync(path.join(root,c.path));
    const git=createHash("sha1").update(Buffer.from("blob "+content.length+"\0")).update(content).digest("hex");
    assert.equal(git,c.blob_sha,"blob mismatch "+c.path);
    assert.equal(c.backends.java,"GUEST_EXECUTED_EXACT_BLOB_SUBSET");
    for(const b of ["llvm","wasm","forge","net","cranelift"])assert.equal(c.backends[b],"PENDING");
    assert.equal(c.execution_profiles.java_graalvm_native_aot,"GUEST_EXECUTED_EXACT_BLOB_SUBSET");
    assert.ok(content.toString("utf8").endsWith("\n"));
    if(expectedOutput.has(c.id)){
      assert.equal(c.kind,"compile_and_execute");
      assert.equal(c.expected_stdout,expectedOutput.get(c.id));
      assert.equal(c.diagnostic_category,null);
    }else{
      assert.equal(c.kind,"compile_reject");
      assert.equal(c.expected_stdout,null);
      assert.ok(c.diagnostic_category);
    }
  }
  assert.equal(registry.cases.filter(c=>c.kind==="compile_and_execute").length,2);
  assert.equal(registry.cases.filter(c=>c.kind==="compile_reject").length,15);
});
