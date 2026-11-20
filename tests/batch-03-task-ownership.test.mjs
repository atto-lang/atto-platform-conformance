import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const manifest=JSON.parse(readFileSync(
  new URL("../audits/batch-03-task-ownership.json",import.meta.url),"utf8"));
const expected=[
  [21,"oreslang-source.java","issue",1437],
  [22,"oreslang-source.java","issue",1403],
  [23,"oreslang-source.llvm","issue",651],
  [24,"oreslang-source.java","issue",1434],
  [25,"oreslang-source.java","issue",1435],
  [26,"oreslang-source.java","issue",1436],
  [27,"oreslang-source.llvm","issue",659],
  [28,"oreslang-common-source","issue",80],
  [29,"oreslang-source.java","issue",400],
  [30,"oreslang-source.llvm","issue",45],
];
test("exactly ten next batch tasks are pinned with unique GitHub identities",()=>{
  assert.equal(manifest.schema,1);
  assert.equal(manifest.batch,3);
  assert.equal(manifest.tasks.length,10);
  assert.deepEqual(manifest.tasks.map(x=>x.task),expected.map(x=>x[0]));
  const observed=new Set();
  expected.forEach(([i,repo,type,id],n)=>{
    const t=manifest.tasks[n];
    assert.equal(t.repository,"ores-truffle-oreslang/"+repo);
    assert.equal(t.githubNumber,id);
    assert.equal(t.kind,type);
    assert.equal(t.url,"https://github.com/"+t.repository+"/"+(type==="pr"?"pull":"issues")+"/"+id);
    assert.ok(!observed.has(t.url));
    observed.add(t.url);
  });
});
test("source-free proofs remain explicitly non-certifying",()=>{
  assert.equal(manifest.claim,"IMPLEMENTED_SOURCE_FREE_SAFETY_REFERENCE_NOT_COMPILER_RUNTIME");
  for(const t of manifest.tasks){
    assert.equal(t.status,"PENDING_REAL_SOURCE_EXECUTION");
    assert.equal(t.referenceModelOnly,true);
    assert.match(t.releaseGate,/^[A-Z_]{12,80}$/);
  }
});
test("no CI shortcut or private mirroring release can be inferred",()=>{
  assert.equal(manifest.security.privateCrossOrgSourceExport,
    "FORBIDDEN_WITHOUT_INDEPENDENT_PROTECTED_MAIN_APPROVAL");
  assert.equal(manifest.security.noStepCi,"UNKNOWN_EXECUTION_NOT_A_TEST_FAILURE");
  assert.equal(manifest.security.reviewedDestination,"NONE_CONFIRMED");
  assert.equal("admittedSourceTree" in manifest,false);
});

test("requested Batch 3 release gates cannot drift back to carrier-only substitutions",()=>{
  assert.deepEqual(manifest.tasks.map(t=>t.releaseGate),[
    "COMPILER_TYPED_CAPTURE_PROOFS","RUNTIME_PHYSICAL_QUIESCENCE",
    "LLVM_NATIVE_TASK_CONTINUATIONS","JAVA_GUEST_SHARED_STATE_LOWERING",
    "JAVA_GUEST_ETS_CAPABILITY_API","JAVA_GUEST_STM_TRANSACTIONS",
    "LLVM_GUEST_SHARED_STATE_PARITY","FFI_PHYSICAL_LEASE_CONTRACT",
    "CHANNEL_AND_LINKED_IMPORT_TYPES","LLVM_CFG_SUSPENSION_LOWERING"
  ]);
  assert.ok(manifest.tasks.every(t=>t.kind==="issue"));
});
