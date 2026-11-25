import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const data=JSON.parse(readFileSync(
  new URL("../audits/batch-04-actor-lifecycle.json",import.meta.url),"utf8"));
const expected=[
  [31,"oreslang-source.llvm",606],
  [32,"oreslang-common-source",73],
  [33,"oreslang-source.llvm",628],
  [34,"oreslang-source.java",1343],
  [35,"oreslang-source.java",1342],
  [36,"oreslang-source.java",1341],
  [37,"oreslang-source.java",1340],
  [38,"oreslang-source.java",1339],
  [39,"oreslang-source.java",1344],
  [40,"oreslang-common-source",79]
];
test("batch four contains the exact next ten GitHub issue trackers",()=>{
  assert.equal(data.schema,1);assert.equal(data.batch,4);
  assert.equal(data.tasks.length,10);
  assert.deepEqual(data.tasks.map(x=>x.index),expected.map(x=>x[0]));
  const unique=new Set();
  expected.forEach(([index,repo,id],i)=>{
    const x=data.tasks[i];
    assert.equal(x.repository,"ores-truffle-oreslang/"+repo);
    assert.equal(x.kind,"issue");
    assert.equal(x.number,id);
    assert.equal(x.url,"https://github.com/"+x.repository+"/issues/"+id);
    assert.equal(unique.has(x.url),false);
    unique.add(x.url);
  });
});
test("none of ten issues is claimed to have passed source-level release gates",()=>{
  assert.equal(data.claim,"PARTIAL_IMPLEMENTATION_DO_NOT_CLOSE_ISSUES");
  for(const task of data.tasks){
    assert.equal(task.status,"PENDING_SOURCE_LEVEL_EXECUTION");
    assert.equal(task.conformanceModel,"SOURCE_FREE_ONLY");
    assert.match(task.releaseGate,/^[A-Z_]{10,80}$/);
  }
});
test("physical Done safety correction does not claim termination liveness",()=>{
  assert.equal(data.directlyChangedSource.pr,1471);
  assert.equal(data.directlyChangedSource.liveness,"NOT_ESTABLISHED");
  assert.equal(data.directlyChangedSource.kind,"physical_done_safety_fix_only");
  assert.equal(data.directlyChangedSource.stackedOn,
    "feat/source-linear-actorstream-authenticated-routing-current-20261017");
});
test("private source and steps-null observations never authorize source export",()=>{
  assert.equal(data.privacy.privateSourceMirroring,
    "BLOCKED_PENDING_ADMIN_AND_INDEPENDENT_APPROVAL");
  assert.equal(data.privacy.stepsNull,"EXECUTION_UNOBSERVED");
  assert.equal(data.privacy.skipIsPass,false);
  assert.equal(data.priorDrafts.nativeCodeOwner,602);
  assert.equal(data.priorDrafts.javaRouteTransfer,1270);
  assert.equal(data.priorDrafts.javaActorStream,1145);
});
