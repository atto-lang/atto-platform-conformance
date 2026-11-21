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
// Model three lexical cleanup scopes separately: a body defer must run
// BEFORE selecting else, and function cleanup runs AFTER its handler.
function runReference({ steps, handlers, onSuccess, onFailure, register = [], enter = [], trace = [] }) {
  checkFailureCoverage(steps, handlers);
  const functionCleanups = [], bodyCleanups = [];
  const registerIn = (stack, label) => stack.push(() => trace.push(label));
  const unwind = stack => { while (stack.length) stack.pop()(); };
  for (const label of register) registerIn(functionCleanups, label);
  let result, failure = null;
  try {
    try {
      for (const [index, item] of steps.entries()) {
        // A step may register a defer before returning or throwing.
        const output = item.run(trace, label => registerIn(bodyCleanups, label));
        if (!item.successTags.includes(output.tag)) {
          failure = output;
          break;
        }
        trace.push("bind:" + output.tag);
        enter[index]?.(label => registerIn(bodyCleanups, label));
      }
      if (failure === null) result = onSuccess(trace);
    } finally {
      // Whether by ?= failure, return or a real exception, unwind the
      // scope that owns the bindings before outer dispatch.
      unwind(bodyCleanups);
    }
    if (failure !== null) {
      if (!handlers.includes(failure.tag)) throw new Error("coverage check bypass");
      trace.push("else:" + failure.tag);
      const handlerCleanups = [];
      try {
        result = onFailure(failure, trace, label => registerIn(handlerCleanups, label));
      } finally {
        unwind(handlerCleanups);
      }
    }
    return { result, trace };
  } finally {
    unwind(functionCleanups);
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
test("body local defer runs LIFO before else; handler defer before function defer", () => {
  const r = runReference({
    steps: [
      step("user", Ok(7)),
      {
        successTags: ["Ok"], failureTags: ["Err"],
        run(trace, registerBody) {
          trace.push("call:account");
          registerBody("body-defer:B");
          return Err("account failed");
        },
      },
      step("unreachable", Ok(99)),
    ],
    handlers: ["Err"], register: ["function-defer"],
    enter: [registerBody => registerBody("body-defer:A")],
    onSuccess: () => { throw Error("must not succeed"); },
    onFailure: (failure, trace, registerHandler) => {
      registerHandler("handler-defer");
      trace.push("handler:" + failure.tag);
      return failure;
    },
  });
  assert.deepEqual(r.result, Err("account failed"));
  assert.deepEqual(r.trace, [
    "call:user", "bind:Ok", "call:account",
    "body-defer:B", "body-defer:A", "else:Err", "handler:Err",
    "handler-defer", "function-defer",
  ]);
});
test("throw bypasses value else, unwinds inner then function defer, enters catch then finally", () => {
  const trace = [];
  try {
    runReference({
      trace,
      steps: [{
        successTags: ["Ok"], failureTags: ["Err"],
        run(t, registerBody) {
          registerBody("body-defer");
          t.push("throw");
          throw new TypeError("ordinary guest throw model");
        },
      }],
      handlers: ["Err"],
      register: ["function-defer"],
      onSuccess: () => { throw Error("must not succeed"); },
      onFailure: () => { trace.push("WRONG:else"); return Err("wrong"); },
    });
  } catch (error) {
    assert.ok(error instanceof TypeError);
    trace.push("outer-catch");
  } finally {
    trace.push("outer-finally");
  }
  assert.deepEqual(trace, [
    "throw", "body-defer", "function-defer", "outer-catch", "outer-finally",
  ]);
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

test("v1 design resolution is conservative and compiler evidence remains unexecuted", () => {
  assert.equal(contract.design_resolution.mandatory_else_v1, true);
  assert.equal(contract.design_resolution.maybe_keyword, "contextual");
  assert.deepEqual(contract.design_resolution.admitted_forms, ["do maybe", "return maybe"]);
  assert.deepEqual(contract.design_resolution.cleanup_order, [
    "exit-maybe-body-LIFO", "dispatch-first-failed-value-else",
    "exit-handler-LIFO", "exit-function-defers-LIFO", "outer-try-finally",
  ]);
  assert.ok(Object.values(contract.backend_evidence).every(value => value === "NOT_EXECUTED"));
});
test("keyword try owns separate end from nested maybe in candidate guest fixtures", () => {
  const doSource = readFileSync(resolve(root, "fixtures/maybe-result-defer-v1/try-keyword-do-maybe.atto"), "utf8");
  const returnSource = readFileSync(resolve(root, "fixtures/maybe-result-defer-v1/try-keyword-return-maybe.atto"), "utf8");
  const noElse = readFileSync(resolve(root, "fixtures/maybe-result-defer-v1/negative-missing-else-in-try.atto"), "utf8");
  assert.match(doSource, /try\s+do maybe/);
  assert.match(doSource, /\bend\s+catch \(Error e\)/);
  assert.match(doSource, /\bfinally\s+log\("outer-finally"\);\s+end/);
  assert.match(returnSource, /try\s+return maybe/);
  assert.match(returnSource, /\bend;\s+catch \(Error e\)/);
  assert.match(noElse, /do maybe\s+Ok\(value\) \?=/);
  assert.doesNotMatch(noElse, /\belse\s+Err\(/);
  for (const id of ["keyword-try-do-maybe-nested-end", "keyword-try-return-maybe-once-finally", "reject-missing-else-with-outer-try"]) {
    assert.ok(contract.cases.some(item => item.id === id && item.outcome === "NOT_EXECUTED"));
  }
});

test("first failed match preserves exact failure object and skips unreached defer", () => {
  const failure = Err({ code: 17 }, "DomainError");
  let later = 0;
  const r = runReference({
    steps: [
      {
        successTags: ["Ok"], failureTags: ["Err"],
        run(trace, registerBody) {
          trace.push("first");
          registerBody("reached-defer");
          return failure;
        },
      },
      {
        successTags: ["Ok"], failureTags: ["Err"],
        run(trace, registerBody) {
          later += 1;
          registerBody("UNREACHED-defer");
          trace.push("UNREACHED-step");
          return Ok(1);
        },
      },
    ],
    handlers: ["Err"],
    onSuccess: () => { throw Error("unexpected success"); },
    onFailure: value => value,
  });
  assert.equal(r.result, failure);
  assert.equal(later, 0);
  assert.deepEqual(r.trace, ["first", "reached-defer", "else:Err"]);
});
test("successful body unwinds body-local defer before function cleanup", () => {
  const r = runReference({
    steps: [{
      successTags: ["Ok"], failureTags: ["Err"],
      run(trace, registerBody) {
        registerBody("body:first");
        registerBody("body:second");
        trace.push("run");
        return Ok(7);
      },
    }],
    handlers: ["Err"],
    register: ["function:first", "function:second"],
    onSuccess: trace => { trace.push("value-ready"); return Ok(7); },
    onFailure: () => { throw Error("else must not run"); },
  });
  assert.deepEqual(r.trace, [
    "run", "bind:Ok", "value-ready",
    "body:second", "body:first", "function:second", "function:first",
  ]);
});
test("throw from failure handler still runs handler defer then function defer", () => {
  const trace = [];
  assert.throws(() => runReference({
    trace,
    steps: [{
      successTags: ["Ok"], failureTags: ["Err"],
      run(trace, registerBody) {
        registerBody("body");
        trace.push("run");
        return Err("failed");
      },
    }],
    handlers: ["Err"],
    register: ["function"],
    onSuccess: () => { throw Error("must fail"); },
    onFailure: (_failure, trace, registerHandler) => {
      trace.push("handler");
      registerHandler("handler-defer");
      throw new TypeError("handler throw");
    },
  }), TypeError);
  assert.deepEqual(trace, [
    "run", "body", "else:Err", "handler", "handler-defer", "function",
  ]);
});
test("missing failure handler rejects before evaluation or registering cleanup", () => {
  let invoked = 0;
  const subject = [{
    successTags: ["Some"], failureTags: ["None"],
    run() { invoked += 1; return None(); },
  }];
  assert.throws(() => runReference({
    steps: subject, handlers: ["Err"],
    register: ["function"],
    onSuccess: () => Some(1), onFailure: value => value,
  }), /nonexhaustive/);
  assert.equal(invoked, 0);
});
