import test from "node:test";
import assert from "node:assert/strict";
import { validateAsyncReceipt } from "../bin/verify-async-runtime-receipt.mjs";

const s40 = "a".repeat(40);
const s64 = "b".repeat(64);
function receipt() {
  return {
    schema: "oreslang.async-runtime-receipt/1",
    backend: "llvm",
    sourceCommit: s40,
    sourceTree: s40,
    contractBlob: s40,
    cases: [{
      id: "ASYNC-07",
      claim: "supported",
      evidence: "native-aot-executed",
      fixturePath: "fixtures/async/progress.ores",
      fixtureSha256: s64,
      execution: {
        runnerKind: "gha",
        runUrl: "https://github.com/owner/repo/actions/runs/42",
        executedSteps: 3,
        command: ["./oreslang-native", "fixtures/async/progress.ores"],
        exitCode: 0,
        assertionCount: 2,
        compilerSha256: s64,
        nativeExecutableSha256: s64
      }
    }]
  };
}
function check(mod, expected = false, message) {
  const obj=receipt();
  mod(obj);
  const res=validateAsyncReceipt(obj);
  assert.equal(res.ok, expected, JSON.stringify(res.errors));
  assert.equal(res.shapeOnly, true);
  if(message)assert.ok(res.errors.some(x=>x.includes(message)), JSON.stringify(res.errors));
  return res;
}

test("accepts internally consistent native guest execution receipt but does NOT certify it", () => {
  const res=check(()=>{},true);
  assert.deepEqual(res.shapeValidCases,["ASYNC-07"]);
  assert.equal(res.missingCases.length,14);
});
test("rejects zero-step Actions",()=>check(r=>{r.cases[0].execution.executedSteps=0},false,"zero-step"));
test("rejects host-only model promoted to supported",()=>check(r=>{r.cases[0].evidence="host-model"},false,"requires real guest execution"));
test("rejects compile-only evidence promoted to supported",()=>check(r=>{r.cases[0].evidence="source-compiled"},false,"requires real guest execution"));
test("rejects native AOT without executable hash",()=>check(r=>{delete r.cases[0].execution.nativeExecutableSha256},false,"native AOT"));
test("rejects missing fixture content hash",()=>check(r=>{delete r.cases[0].fixtureSha256},false,"fixture SHA"));
test("rejects unsafe relative paths",()=>check(r=>{r.cases[0].fixturePath="../private.ores"},false,"safe relative"));
test("rejects duplicate case IDs",()=>check(r=>{r.cases.push(structuredClone(r.cases[0]))},false,"duplicate"));
test("rejects incompatible unsupported claim",()=>check(r=>{r.cases[0].claim="unsupported"},false,"unsupported must"));
test("rejects unknown backend",()=>check(r=>{r.backend="nonesuch"},false,"unknown backend"));
test("rejects malformed source Git tree",()=>check(r=>{r.sourceTree="NO_SHA"},false,"sourceTree"));
test("rejects fake evidence schema",()=>check(r=>{r.schema="oreslang.async-runtime-receipt/0"},false,"schema"));
test("rejects terminal no-execution success",()=>check(r=>{r.cases[0].evidence="contract-only"},false,"requires real guest execution"));
test("rejects absent command",()=>check(r=>{r.cases[0].execution.command=[]},false,"executed argv"));
test("rejects missing executed assertions",()=>check(r=>{r.cases[0].execution.assertionCount=0},false,"assertions"));
test("rejects nonzero exit status",()=>check(r=>{r.cases[0].execution.exitCode=1},false,"exitCode"));
test("rejects spoofed GHA URL",()=>check(r=>{r.cases[0].execution.runUrl="https://example.com/runs/42"},false,"run URL"));
test("accepts explicitly unsupported without claiming execution",()=>{
  const res=check(r=>{r.cases=[{id:"ASYNC-01",claim:"unsupported",evidence:"not-implemented"}]},true);
  assert.equal(res.shapeValidCases.length,1);
});
test("accepts contract-only pending and does not certify support",()=>{
  const res=check(r=>{r.cases=[{id:"ASYNC-01",claim:"pending",evidence:"contract-only"}]},true);
  assert.equal(res.shapeValidCases.length,1);
});
test("guard requires compiler-rejection evidence",()=>check(r=>{r.cases[0].claim="guarded"},false,"guarded requires compiler rejection"));
test("guard with executed rejection is a shape-only record, not proof",()=>{
  const res=check(r=>{r.cases[0].claim="guarded";r.cases[0].evidence="rejected-as-required";delete r.cases[0].execution.nativeExecutableSha256;r.cases[0].execution.compilerExitCode=1;r.cases[0].execution.expectedDiagnostic="unsupported state loan"},true);
  assert.equal(res.shapeValidCases.length,1);
});
test("rejects invalid receipt objects without throwing",()=>{
  const res=validateAsyncReceipt(null);
  assert.equal(res.ok,false);
  assert.equal(res.shapeOnly,true);
});

test("expected compile rejection requires nonzero compiler exit",()=>check(r=>{
  r.cases[0].claim="guarded";
  r.cases[0].evidence="rejected-as-required";
  r.cases[0].execution.expectedDiagnostic="unsupported async state loan";
  r.cases[0].execution.compilerExitCode=0;
},false,"nonzero compilerExitCode"));
test("expected compile rejection requires diagnostic",()=>check(r=>{
  r.cases[0].claim="guarded";
  r.cases[0].evidence="rejected-as-required";
  r.cases[0].execution.compilerExitCode=1;
},false,"expectedDiagnostic"));
