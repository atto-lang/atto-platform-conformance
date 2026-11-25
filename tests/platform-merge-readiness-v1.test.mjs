import test from "node:test";
import assert from "node:assert/strict";
import {assessPlatformMergeCandidate as assess} from "../src/platform-merge-readiness-v1.mjs";
const sha = "a".repeat(40), other="b".repeat(40);
const names = [
  "oreslang-platform-conformance","oreslang-platform.mobile",
  "oreslang-platform.iot","oreslang-platform.asic","oreslang-platform.fpga",
  "oreslang-platform.desktop","oreslang-platform.embedded"
];
const good = {
  repository:names[0],head_sha:sha,review_head_sha:sha,draft:false,
  mergeable:true,protected_base:true,approvers:["independent-reviewer"],
  checks:[{name:"native-host",conclusion:"success",executed_steps:5}]
};
test("all seven targets preserve a non-authorizing verdict",()=>{
  for (const repository of names) {
    const r=assess({...good,repository});
    assert.equal(r.classification,"REPORTED_CHECKS_PASS_EXTERNAL_VERIFICATION_REQUIRED");
    assert.equal(r.authorizes_merge,false);
    assert.equal(r.certifies_review_identity,false);
    assert.equal(r.authenticates_ci_logs,false);
    assert.equal(r.proves_guest_or_device_execution,false);
    assert.equal(Object.isFrozen(r),true);
  }
});
test("draft, unprotected, unmergeable, stale, and missing review hold",()=>{
  const cases=[
    [{draft:true},"DRAFT_HOLD"],
    [{protected_base:false},"UNPROTECTED_BASE_HOLD"],
    [{mergeable:false},"UNMERGEABLE_HOLD"],
    [{review_head_sha:other},"STALE_REVIEW_HOLD"],
    [{approvers:[]},"NO_APPROVER_HOLD"],
    [{checks:[]},"INCOMPLETE_CHECKS_HOLD"]
  ];
  for (const [patch,expected] of cases)
    assert.equal(assess({...good,...patch}).classification,expected);
});
test("no zero-step, skipped, cancelled, pending or failed job can pass",()=>{
  for (const conclusion of ["success","skipped","cancelled","pending","failure"]) {
    const r=assess({...good,checks:[{name:"native-host",conclusion,
      executed_steps:conclusion==="success"?0:5}]});
    assert.equal(r.classification,"INCOMPLETE_CHECKS_HOLD");
  }
});
test("duplicate, malformed, excess, or fabricated evidence shape is rejected",()=>{
  for (const malformed of [
    {...good,repository:"oreslang-source.java"},
    {...good,head_sha:sha.toUpperCase()},
    {...good,checks:[good.checks[0],good.checks[0]]},
    {...good,approvers:["same","same"]},
    {...good,checks:[{name:"CI",conclusion:"success",executed_steps:-1}]},
    {...good,checks:[{name:"CI",conclusion:"neutral",executed_steps:2}]},
    {...good,extra:true}, null, [], {},
  ]) assert.throws(()=>assess(malformed),TypeError);
});
