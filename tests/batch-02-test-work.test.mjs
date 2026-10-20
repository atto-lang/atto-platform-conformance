import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const manifest=JSON.parse(readFileSync(new URL(
  "../audits/batch-02-test-work.json",import.meta.url),"utf8"));
const REPO="ores-truffle-oreslang/";
const expected=[
  [11,"oreslang-source.java","issue",1417],
  [12,"oreslang-source.java","issue",1418],
  [13,"oreslang-source.java","issue",1446],
  [14,"oreslang-platform-conformance","issue",108],
  [15,"oreslang-platform-conformance","issue",92],
  [16,"oreslang-platform-conformance","issue",44],
  [17,"oreslang-platform-conformance","issue",80],
  [18,"oreslang-common-source","issue",58],
  [19,"oreslang-platform-conformance","issue",85],
  [20,"oreslang-platform-conformance","issue",19]
];
test("batch 02 contains exactly the ten original work items",()=>{
  assert.equal(manifest.schema,1);
  assert.equal(manifest.batch,2);
  assert.equal(manifest.items.length,10);
  assert.equal(manifest.status,"COORDINATION_ONLY");
  assert.deepEqual(manifest.items.map(x=>x.id),expected.map(x=>x[0]));
});
test("every GitHub issue/PR identity is exactly pinned",()=>{
  const seen=new Set();
  for(const [i,repo,type,n] of expected){
    const item=manifest.items[i-11];
    assert.equal(item.repository,REPO+repo);
    assert.equal(item.type,type);
    assert.equal(item.number,n);
    assert.equal(item.url,
      "https://github.com/"+REPO+repo+"/"+(type==="pr"?"pull":"issues")+"/"+n);
    assert.ok(!seen.has(item.url));
    seen.add(item.url);
  }
});
test("no task claims production guest verification based on synthetic oracle",()=>{
  for(const item of manifest.items){
    assert.equal(item.status,"PENDING_REAL_GUEST_EVIDENCE");
    assert.equal(item.sourceFreeOracle,"NON_CERTIFYING");
    assert.match(item.evidenceRequired,/\S.{15,}/);
    assert.match(item.goal,/\S.{15,}/);
    assert.match(item.releaseGate,/^[A-Z_]{8,80}$/);
  }
  assert.equal(manifest.security.zeroStepTests,"NOT_EVIDENCE");
  assert.equal(manifest.security.syntheticOracles,"NOT_GUEST_PROOF");
});
test("cross-org private source transfer cannot be admitted by inventory",()=>{
  assert.equal(manifest.security.privateSourceExport,
    "FORBIDDEN_UNTIL_INDEPENDENT_APPROVAL");
  assert.equal(Object.hasOwn(manifest,"approvedCarrier"),false);
});

test("original task list anchors release gates to the correct request",()=>{
  const gates=["GUEST_MEMORY_INSTRUMENTATION","DETERMINISTIC_GUEST_REPLAY",
    "IMPORT_CLOSURE_REPLAY_INTEGRITY","GUEST_TASK_SCOPE_CONFORMANCE",
    "SOURCE_LEVEL_ERROR_LINEAGE","COMPILER_EXECUTABLE_DRIFT",
    "BENCHMARK_PROVENANCE_SCHEMA","FIVE_BACKEND_EXACT_HEAD",
    "FORMAL_ASSURANCE_LEDGER","INDEPENDENT_RELEASE_REVIEW"];
  assert.deepEqual(manifest.items.map(x=>x.releaseGate),gates);
  assert.ok(!manifest.items.some(x=>x.type==="pr"),
    "implementation PR references are dependencies, not a substitute for requested issues");
  assert.equal(new Set(manifest.items.map(x=>x.url)).size,10);
});
