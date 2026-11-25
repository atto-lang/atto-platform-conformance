import test from "node:test";
import assert from "node:assert/strict";
import { classifyActorMemoryEvidence as classify } from "../src/actor-memory-evidence.mjs";
const valid = () => ({
  backend: "llvm", fixture_id: "MEM-001", source_sha: "a".repeat(40),
  steps_observed: true, steps: ["compile guest", "execute guest"],
  generated_guest_executed: true, compiler_command: "oreslangc fixture.ores",
  guest_command: "./fixture", workflow_url: "https://github.com/example/repo/actions/runs/123",
  job_id: 123, source_binary_link_attested: true, exit_code: 0, assertions_passed: true
});
test("positive evidence is classified but does not authenticate external claims", () => {
  for (const backend of ["java","llvm","net","wasm","js"]) {
    const r=valid(); r.backend=backend; assert.equal(classify(r),"PASS_EXECUTED");
  }
});
test("no steps and unavailable steps are distinct", () => {
  const a=valid(); a.steps=[]; assert.equal(classify(a),"NOT_EXECUTED");
  const b=valid(); b.steps_observed=false; assert.equal(classify(b),"UNOBSERVED");
});
test("source-free canary and unlinked binary cannot promote", () => {
  const a=valid(); a.synthetic=true; assert.equal(classify(a),"UNOBSERVED");
  const b=valid(); b.source_binary_link_attested=false; assert.equal(classify(b),"UNOBSERVED");
});
test("compiler-only evidence is not guest execution", () => {
  const r=valid(); r.generated_guest_executed=false; assert.equal(classify(r),"NOT_EXECUTED");
});
test("observed guest failure stays failure", () => {
  const r=valid(); r.exit_code=1; assert.equal(classify(r),"FAIL_EXECUTED");
});
test("missing provenance or commands cannot promote", () => {
  for (const key of ["workflow_url","job_id","compiler_command","guest_command","exit_code"]) {
    const r=valid(); delete r[key]; assert.equal(classify(r),"UNOBSERVED");
  }
});
test("reject malformed identities and unknown fixture IDs", () => {
  for (const key of ["backend","fixture_id","source_sha"]) {
    const r=valid(); r[key]="invalid"; assert.throws(()=>classify(r));
  }
});
test("unsupported target is explicit", () => {
  const r=valid(); r.supported=false; assert.equal(classify(r),"UNSUPPORTED");
});

test("synthetic reports with empty steps never imply real execution", () => {
  const r=valid(); r.synthetic=true; r.steps=[];
  assert.equal(classify(r),"UNOBSERVED");
});
test("one step cannot establish both compilation and execution", () => {
  const r=valid(); r.steps=["execute guest"];
  assert.equal(classify(r),"UNOBSERVED");
});
test("excessive steps reject bounded evidence", () => {
  const r=valid(); r.steps=Array.from({length:101}, (_,i)=>"step "+i);
  assert.throws(()=>classify(r),/too many steps/);
});

test("two unrelated steps cannot masquerade as compile and execute", () => {
  const r=valid(); r.steps=["checkout","upload"];
  assert.equal(classify(r),"UNOBSERVED");
});
test("missing assertions are not successful guest results", () => {
  const r=valid(); delete r.assertions_passed;
  assert.equal(classify(r),"UNOBSERVED");
});
test("unbounded step names are rejected", () => {
  const r=valid(); r.steps=["compile "+"x".repeat(260),"execute guest"];
  assert.throws(()=>classify(r),/step name too long/);
});
