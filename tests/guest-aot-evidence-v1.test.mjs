import test from "node:test";
import assert from "node:assert/strict";
import {validateGuestAotEvidence as check} from "../lib/guest-aot-evidence-v1.mjs";

const sha40 = "a".repeat(40);
const sha64 = "b".repeat(64);
const valid = () => ({
  schemaVersion: 1, backend: "llvm", sourceCommit: sha40,
  sourceTree: "c".repeat(40), sourceProgramSha256: sha64,
  compilerSha256: sha64, artifactSha256: sha64, status: "EXECUTED",
  execution: {jobId: 12, runnerName: "real-worker", completedSteps: 7,
    kind: "source-org", guestBinaryRan: true, compiledGuestEntrypointRan: true,
    workflowSha256: sha64}
});

test("a complete declared guest receipt requires independent review", () => {
  assert.deepEqual(check(valid(), {sourceCommit: sha40}).classification, "REVIEW_REQUIRED");
});
test("zero-step red Actions is NOT_EXECUTED, not a compiler failure", () => {
  const x = valid();x.status = "NOT_EXECUTED";
  x.artifactSha256 = null;
  x.execution = {jobId: 12, runnerName: null, completedSteps: 0,
    kind: "none", guestBinaryRan: false, compiledGuestEntrypointRan: false,
    workflowSha256: null};
  assert.equal(check(x).classification, "NOT_EXECUTED");
  x.status = "FAILED";
  assert.equal(check(x).ok, false);
});
test("synthetic runner cannot make a guest proof", () => {
  const x = valid();x.execution.kind = "synthetic-canary";
  assert.equal(check(x).ok, false);
});
test("missing compiled guest entrypoint, hashes and runner all fail closed", () => {
  for (const mutate of [
    x => {x.execution.compiledGuestEntrypointRan=false},
    x => {x.execution.completedSteps=0},
    x => {x.execution.runnerName=null},
    x => {x.artifactSha256=null},
    x => {x.execution.workflowSha256=null},
    x => {x.sourceTree="0".repeat(40)}
  ]) {const x=valid();mutate(x);assert.equal(check(x,{sourceTree:"c".repeat(40)}).ok,false);}
});
test("unknown, inherited and accessor receipt fields do not count as evidence", () => {
  assert.equal(check({...valid(), bypass:true}).ok,false);
  assert.equal(check(Object.create(valid())).ok,false);
  const x = valid();let invoked = 0;
  Object.defineProperty(x, "execution", {get(){invoked++;return valid().execution}, enumerable:true});
  assert.equal(check(x).ok,false);
  assert.equal(invoked,0);
  const nested = valid();let nestedCalls=0;
  Object.defineProperty(nested.execution, "completedSteps", {
    enumerable:true,set(_v){nestedCalls++}
  });
  assert.equal(check(nested).ok,false);
  assert.equal(nestedCalls,0);
});

test("receipt reflection traps cannot crash evidence evaluation",()=>{
  const inputs=[
    new Proxy(valid(),{getPrototypeOf(){throw Error("trap")}}),
    new Proxy(valid(),{get(){throw Error("trap")}}),
    {...valid(),execution:new Proxy(valid().execution,{
      getOwnPropertyDescriptor(){throw Error("trap")}
    })},
  ];
  for(const x of inputs) {
    const result=check(x);
    assert.equal(result.ok,false);
    assert.equal(result.classification,"INVALID");
  }
});
test("hostile trusted-hash selector is denied rather than coerced",()=>{
  const expected=new Proxy({sourceTree:"c".repeat(40)},{
    get(){throw Error("unexpected selector trap")}
  });
  assert.equal(check(valid(),expected).classification,"INVALID");
});
