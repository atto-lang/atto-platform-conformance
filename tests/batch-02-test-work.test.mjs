import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const manifest=JSON.parse(readFileSync(new URL(
  "../audits/batch-02-test-work.json",import.meta.url),"utf8"));
const REPO="ores-truffle-oreslang/";
const expected=[
  [11,"oreslang-source.java","issue",589],
  [12,"oreslang-source.java","pr",1429],
  [13,"oreslang-source.java","issue",1417],
  [14,"oreslang-source.java","issue",1418],
  [15,"oreslang-source.java","pr",1415],
  [16,"oreslang-source.llvm","pr",655],
  [17,"oreslang-test.cli","pr",8],
  [18,"oreslang-platform-conformance","issue",92],
  [19,"oreslang-platform-conformance","issue",108],
  [20,"oreslang-platform-conformance","issue",99]
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
