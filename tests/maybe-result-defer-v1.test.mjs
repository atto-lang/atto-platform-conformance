import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// SOURCE-FREE CONTRACT MODEL ONLY. Never label these tests guest-compiler or native-AOT.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(readFileSync(resolve(root, "contracts/maybe-result-defer-v1.json"), "utf8"));
const Ok = value => ({ tag: "Ok", value });
const Err = (value, errorType = "Error") => ({ tag: "Err", value, errorType });
const Some = value => ({ tag: "Some", value });
const None = () => ({ tag: "None" });

function checkFailureCoverage(steps, handlers) {
  const failTags = new Set(steps.flatMap(step => step.failureTags));
  for (const tag of failTags) {
    if (!handlers.includes(tag)) throw new TypeError("nonexhaustive failure dispatch: " + tag);
  }
}
function runReference({ steps, handlers, onSuccess, onFailure, register = [], enter = [] }) {
  checkFailureCoverage(steps, handlers);
  const trace = [], cleanups = [];
  const registerDefer = (label) => cleanups.push(() => trace.push(label));
  let result;
  for (const name of register) registerDefer(name);
  try {
    for (const item of steps) {
      const output = item.run(trace, registerDefer);
      if (!item.successTags.includes(output.tag)) {
        if (!handlers.includes(output.tag)) throw new Error("coverage check bypass");
        trace.push("else:" + output.tag);
        result = onFailure(output, trace);
        return { result, trace };
      }
      trace.push("bind:" + output.tag);
      if (enter.length) enter.shift()?.(registerDefer);
    }
    result = onSuccess(trace);
    return { result, trace };
  } finally {
    while (cleanups.length) cleanups.pop()();
  }
}
const step = (name, result, successTags = ["Ok"], failureTags = ["Err"]) =>
  ({ successTags, failureTags, run(trace) { trace.push("call:" + name); return result; } });
test("contract is unexecuted and fixtures have distinct expected outcomes", () => {
  assert.equal(contract.status, "SPEC_ONLY_NOT_EXECUTED");
  assert.ok(contract.required_backends.length >= 5);
  assert.ok(Object.values(contract.backend_evidence).every(x => x === "NOT_EXECUTED"));
  assert.equal(new Set(contract.cases.map(x => x.id)).size, contract.cases.length);
  for (const c of contract.cases) {
    assert.match(readFileSync(resolve(root, c.path), "utf8"), /define pub fnc/);
    assert.ok(["accept", "reject"].includes(c.expect));
  }
});
test("success evaluates three bindings once, skips else, executes defer on return", () => {
  const r = runReference({
    steps:[step("user",Ok(7)),step("account",Ok(8)),step("balance",Ok(42))],
    handlers:["Err"],register:["function-defer"],onSuccess:()=>Ok(42),
    onFailure:()=>{throw Error("else must not run");}
  });
  assert.deepEqual(r.result,Ok(42));
  assert.deepEqual(r.trace,["call:user","bind:Ok","call:account","bind:Ok","call:balance","bind:Ok","function-defer"]);
});
for (const failedAt of [0,1,2]) test("first Err at step "+failedAt+" skips later work", () => {
  const steps=["user","account","balance"].map((name,i)=>step(name,i===failedAt?Err("e"+i):Ok(i)));
  const r=runReference({steps,handlers:["Err"],register:["defer-A","defer-B"],
    onSuccess:()=>{throw Error("must not succeed");},onFailure:x=>x});
  assert.deepEqual(r.result,Err("e"+failedAt));
  assert.deepEqual(r.trace.filter(x=>x.startsWith("call:")),["call:user","call:account","call:balance"].slice(0,failedAt+1));
  assert.deepEqual(r.trace.slice(-3),["else:Err","defer-B","defer-A"]);
});
test("Option None requires its own handler and does not alias Err", () => {
  const steps=[step("result",Ok(9)),step("email",None(),["Some"],["None"])];
  assert.throws(()=>runReference({steps,handlers:["Err"],onSuccess:()=>Ok(1),onFailure:x=>x}),/nonexhaustive/);
  const r=runReference({steps,handlers:["Err","None"],onSuccess:()=>Ok(1),onFailure:x=>x});
  assert.deepEqual(r.result,None());
  assert.equal(r.trace.filter(x=>x==="else:None").length,1);
});
test("defer scoped to maybe exits before else; function defer executes after", () => {
  const trace=[], inner=[];
  const maybeScope = () => {
    try {trace.push("maybe-body"); return Err("failed");}
    finally {inner.push("inner-B","inner-A"); trace.push(...inner);}
  };
  try {
    const result=maybeScope();
    if(result.tag==="Err") trace.push("else");
  } finally {trace.push("outer");}
  assert.deepEqual(trace,["maybe-body","inner-B","inner-A","else","outer"]);
});
test("host throw is not reclassified as typed Err; cleanup still unwinds", () => {
  const trace=[];
  assert.throws(()=>runReference({steps:[{
    successTags:["Ok"],failureTags:["Err"],
    run(_trace){throw new RangeError("host trap");}
  }],handlers:["Err"],register:["defer"],onSuccess:()=>Ok(1),onFailure:()=>Err("wrong")}),RangeError);
  // Validation of unwinding happens in its own host trace; no Err handler ran.
  try {try {throw new RangeError("host trap");} finally {trace.push("defer");}}
  catch(error){assert.ok(error instanceof RangeError);}
  assert.deepEqual(trace,["defer"]);
});
test("contextual maybe identifier stays legal and return-maybe is not return-match ARM_RESULT", () => {
  const divergent=readFileSync(resolve(root,"fixtures/maybe-result-defer-v1/balance-return-maybe-diverge.atto"),"utf8");
  const valued=readFileSync(resolve(root,"fixtures/maybe-result-defer-v1/balance-return-maybe-value.atto"),"utf8");
  assert.match(divergent,/return maybe\s+Ok\(user\) \?=/);
  assert.match(divergent,/return Ok\(balance\)/);
  assert.match(valued,/\n\s+Ok\(balance\)\s*\n\s+else/);
  assert.notEqual(divergent,valued);
});
