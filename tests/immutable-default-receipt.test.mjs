import test from "node:test";
import assert from "node:assert/strict";
import {assessImmutableReceipt, mandatoryAttoBackends} from "../bin/immutable-default-receipt.mjs";

// These are adversarial SHAPE controls only, not compiler or Actions execution.
const HEAD = "a".repeat(40), TREE = "b".repeat(40);
const pin = {backend:"java", headSha:HEAD, treeSha:TREE};
const cases = [
  ["IDB-01", "guest", "7"], ["IDB-02", "guest", "7"],
  ["IDB-03", "guest", "7"], ["IDB-07", "semantic-reject"],
  ["IDB-08", "semantic-reject"], ["IDB-17", "checked-trap"],
  ["IDB-19", "guest", "8"], ["IDB-20", "guest", "8"],
  ["IDB-24", "guest", "8"]
].map(([id, kind, observedI64]) => ({
  id, kind, backend:"java", headSha:HEAD, fixtureBlobSha1:"c".repeat(40),
  ...(kind === "guest" ? {stage:"guest", observedI64} : {}),
  ...(id === "IDB-19" ? {args_i64:["7"]} : {}),
  ...(kind === "semantic-reject" ? {stage:"typecheck", diagnosticFamily:"immutable-binding", artifactPublished:false} : {}),
  ...(kind === "checked-trap" ? {stage:"runtime", diagnosticFamily:"checked-i64-overflow"} : {})
}));
const receipt = () => ({
  backend:"java", sourceHead:HEAD, sourceTree:TREE,
  workflow:{id:42, head_sha:HEAD, run_attempt:1, status:"completed", conclusion:"success"},
  job:{id:93, run_id:42, runner_id:17, status:"completed", conclusion:"success",
    steps:[{number:1, name:"source checkout", started_at:"start", completed_at:"end", status:"completed", conclusion:"success"},
      {number:2, name:"real compiler", started_at:"start", completed_at:"end", status:"completed", conclusion:"success"},
      {number:3, name:"compiled guest", started_at:"start", completed_at:"end", status:"completed", conclusion:"success"}]},
  compilerSha256:"d".repeat(64), binarySha256:"e".repeat(64),
  cases:structuredClone(cases),
});
function check(change, status) {
  const r = receipt(); change(r);
  assert.equal(assessImmutableReceipt(r, pin).status, status);
}

test("immutable release lanes are Java/Graal, LLVM, Wasm, NativeAOT and Forge (Cranelift separate)", () => {
  assert.deepEqual(mandatoryAttoBackends, ["java","llvm","wasm","net","forge"]);
});
test("structurally sound synthetic data still requires independent GitHub readback/review", () => {
  assert.equal(assessImmutableReceipt(receipt(), pin).status, "REVIEW_REQUIRED");
});
test("negative mutation controls deny false guest/CI credit", () => {
  check(r => {r.job.steps = null;}, "RUNNER_NOT_ADMITTED");
  check(r => {r.job.steps = [];}, "RUNNER_NOT_ADMITTED");
  check(r => {r.job.runner_id = 0;}, "RUNNER_NOT_ADMITTED");
  check(r => {r.sourceHead = "f".repeat(40);}, "STALE_OR_WRONG_SOURCE");
  check(r => {r.sourceTree = "f".repeat(40);}, "STALE_OR_WRONG_SOURCE");
  check(r => {r.workflow.head_sha = "f".repeat(40);}, "STALE_OR_WRONG_SOURCE");
  check(r => {r.backend = "cranelift";}, "STALE_OR_WRONG_SOURCE");
  check(r => {r.job.run_id = 49;}, "INVALID_JOB_BINDING");
  check(r => {r.workflow.run_attempt = 0;}, "INVALID_JOB_BINDING");
  check(r => {r.job.steps[2].number = 1;}, "INVALID_STEPS");
  check(r => {r.job.steps[2].conclusion = "skipped";}, "EXECUTED_NOT_SUCCESSFUL");
  check(r => {r.workflow.conclusion = "failure";}, "EXECUTED_NOT_SUCCESSFUL");
  check(r => {r.compilerSha256 = "";}, "UNPINNED_ARTIFACT");
  check(r => {r.binarySha256 = "";}, "UNPINNED_ARTIFACT");
  check(r => {r.cases = null;}, "NO_GUEST_PROOF");
  check(r => {r.cases[1].id = "IDB-01";}, "INVALID_CASES");
  check(r => {r.cases[0].observedI64 = "8";}, "INCORRECT_GUEST_RESULT");
  check(r => {r.cases[3].stage = "parse";}, "INCOMPLETE_GUEST_PROOF");
  check(r => {r.cases[4].artifactPublished = true;}, "INCOMPLETE_GUEST_PROOF");
  check(r => {r.cases[5].stage = "compile";}, "INCOMPLETE_GUEST_PROOF");
  check(r => {r.cases[6].observedI64 = "7";}, "INCORRECT_GUEST_RESULT");
  check(r => {r.cases.pop();}, "INCOMPLETE_GUEST_PROOF");
  check(r => {r.cases[0].fixtureBlobSha1 = "unknown";}, "INCOMPLETE_GUEST_PROOF");
  check(r => {r.cases.find(c => c.id === "IDB-19").observedI64 = "9";}, "INCORRECT_GUEST_RESULT");
  check(r => {r.cases.find(c => c.id === "IDB-19").args_i64 = ["8"];}, "INCORRECT_GUEST_RESULT");
  check(r => {r.cases.find(c => c.id === "IDB-20").observedI64 = "7";}, "INCORRECT_GUEST_RESULT");
});
