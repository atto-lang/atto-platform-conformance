import test from "node:test";
import assert from "node:assert/strict";
import {verifyLifecycleV2,verifyFiveBackendObservations,REQUIRED_BACKENDS}
  from "../contracts/testkit-lifecycle-v2/verify.mjs";

const resources = [["callback","cb"],["task","task"],["actor","actor"],["await","wait"]];
const begin = "ORES_TEST_V2|RUN_BEGIN|2\nORES_TEST_V2|CASE_BEGIN|suite/async\n";
const end = "ORES_TEST_V2|CASE_END|suite/async|PASS\nORES_TEST_V2|RUN_END|total=1|passed=1|failed=0|skipped=0|filtered=0\n";
const record = fields => "ORES_TEST_V2|" + fields.join("|") + "\n";
const allOpen = resources.map(([kind,id])=>record(["OPEN","suite/async",kind,id])).join("");
function source(order=resources,outcomes=["ok","ok","ok","ok"]) {
  return begin + allOpen + order.map(([kind,id]) =>
    record(["CLOSE","suite/async",kind,id,outcomes[resources.findIndex(x=>x[1]===id)]])
  ).join("") + end;
}
const invalid = text => assert.throws(()=>verifyLifecycleV2(text),/INVALID_LIFECYCLE/);

test("24 callback/task/actor/await completion orderings and incomplete prefixes",()=>{
  let tested=0;
  for(let a=0;a<4;a++) for(let b=0;b<4;b++) for(let c=0;c<4;c++) for(let d=0;d<4;d++) {
    if(new Set([a,b,c,d]).size!==4) continue;
    const order=[a,b,c,d].map(i=>resources[i]);
    assert.equal(verifyLifecycleV2(source(order)).passed,1);
    invalid(source(order.slice(0,3)));
    tested++;
  }
  assert.equal(tested,24);
});
test("81 terminal outcome vectors: cancelled/error work cannot be PASS",()=>{
  let tested=0;
  for(const a of ["ok","error","cancel"]) for(const b of ["ok","error","cancel"])
  for(const c of ["ok","error","cancel"]) for(const d of ["ok","error","cancel"]) {
    const result=source(resources,[a,b,c,d]);
    if([a,b,c,d].every(x=>x==="ok")) assert.equal(verifyLifecycleV2(result).passed,1);
    else invalid(result);
    tested++;
  }
  assert.equal(tested,81);
});
test("resource isolation: no cross-case, cross-kind or duplicate completion",()=>{
  const valid=source();
  for(const altered of [
    valid.replace(record(["OPEN","suite/async","actor","actor"]),
                  record(["OPEN","suite/async","actor","cb"])),
    valid.replace(record(["CLOSE","suite/async","actor","actor","ok"]),
                  record(["CLOSE","other","actor","actor","ok"])),
    valid.replace(record(["CLOSE","suite/async","callback","cb","ok"]),""),
    valid.replace(record(["CLOSE","suite/async","task","task","ok"]),""),
    valid.replace(record(["CLOSE","suite/async","actor","actor","ok"]),""),
    valid.replace(record(["CLOSE","suite/async","await","wait","ok"]),""),
    valid.replace(record(["CLOSE","suite/async","await","wait","ok"]),
                  record(["CLOSE","suite/async","await","wait","ok"]).repeat(2)),
    valid.replace(record(["CASE_END","suite/async","PASS"]),""),
    valid + record(["CASE_BEGIN","too-late"]),
    valid.replace(record(["RUN_BEGIN","2"]),record(["RUN_BEGIN","2"]).repeat(2))
  ]) invalid(altered);
});
test("machine namespace, count and case controls fail closed",()=>{
  const valid=source();
  for(const altered of [
    valid+"ORES_TEST\n",valid+"ORES_TEST_V2\n",valid+"ORES_TEST|PASS|forged\n",
    valid.replaceAll("\n","\r\n"), valid.slice(0,-1),
    valid.replace("passed=1","passed=0"),valid.replace("filtered=0","filtered=10001"),
    valid.replace("total=1","total=10001"),valid.replace("total=1","total=1|total=1"),
    valid.replace("passed=1","passed=184467440737095516160000"),
    valid.replace(record(["CASE_END","suite/async","PASS"]),record(["CASE_END","suite/async","SKIP"]))
  ]) invalid(altered);
});
test("five backend observations demand exact coverage and stepful execution metadata",()=>{
  const empty=Object.fromEntries(REQUIRED_BACKENDS.map(x=>[x,{state:"NOT_EXECUTED"}]));
  assert.equal(verifyFiveBackendObservations(empty).length,5);
  assert.throws(()=>verifyFiveBackendObservations({...empty,net:undefined}),/INVALID_LIFECYCLE/);
  assert.throws(()=>verifyFiveBackendObservations({...empty,wasm:{state:"GUEST_EXECUTED",steps:0,
    receipt:source(),source_sha:"1".repeat(40),compiler_sha256:"2".repeat(64)}}),/INVALID_LIFECYCLE/);
  assert.throws(()=>verifyFiveBackendObservations({...empty,java:{state:"HOST_MODEL",receipt:source()}}),/INVALID_LIFECYCLE/);
  const report=verifyFiveBackendObservations({...empty,java:{state:"GUEST_EXECUTED",steps:1,
    receipt:source(),source_sha:"1".repeat(40),compiler_sha256:"2".repeat(64)}});
  assert.equal(report[0].claim,"UNAUTHENTICATED_METADATA_ONLY");
});

test("ten-thousand case boundary is admitted, overflow rejected and all-skipped denied",()=>{
  const events=["ORES_TEST_V2|RUN_BEGIN|2\n"];
  for(let i=0;i<10_000;i++){
    events.push(record(["CASE_BEGIN","case/"+i]));
    events.push(record(["CASE_END","case/"+i,"PASS"]));
  }
  const before=events.join("");
  const full=before+record(["RUN_END","total=10000","passed=10000","failed=0","skipped=0","filtered=0"]);
  assert.equal(verifyLifecycleV2(full).total,10_000);
  const over=before+record(["CASE_BEGIN","case/overflow"])+
    record(["CASE_END","case/overflow","PASS"])+
    record(["RUN_END","total=10001","passed=10001","failed=0","skipped=0","filtered=0"]);
  invalid(over);
  const skipped="ORES_TEST_V2|RUN_BEGIN|2\n"+
    record(["CASE_BEGIN","case/skip"])+record(["CASE_END","case/skip","SKIP"])+
    record(["RUN_END","total=1","passed=0","failed=0","skipped=1","filtered=0"]);
  invalid(skipped);
});
test("two interleaved actor/task test scopes can reuse local handles safely",()=>{
  const trace="ORES_TEST_V2|RUN_BEGIN|2\n"+
    record(["CASE_BEGIN","a"])+record(["CASE_BEGIN","b"])+
    record(["OPEN","a","actor","shared"])+record(["OPEN","b","actor","shared"])+
    record(["CLOSE","b","actor","shared","ok"])+record(["CLOSE","a","actor","shared","ok"])+
    record(["CASE_END","a","PASS"])+record(["CASE_END","b","PASS"])+
    record(["RUN_END","total=2","passed=2","failed=0","skipped=0","filtered=0"]);
  assert.equal(verifyLifecycleV2(trace).passed,2);
  invalid(trace.replace(record(["CLOSE","b","actor","shared","ok"]),
    record(["CLOSE","a","actor","shared","ok"])));
});
test("backend evidence cannot be promoted by missing, extra or forged receipts",()=>{
  const base=Object.fromEntries(REQUIRED_BACKENDS.map(id=>[id,{state:"UNSUPPORTED"}]));
  assert.equal(verifyFiveBackendObservations(base).length,5);
  for (const forged of [
    {...base,cranelift:undefined},
    {...base,forge:{state:"UNSUPPORTED"}},
    {...base,net:{state:"GUEST_EXECUTED",steps:1,source_sha:"0".repeat(40),
      compiler_sha256:"1".repeat(64),receipt:source().replace("passed=1","passed=0")}},
    {...base,llvm:{state:"GUEST_EXECUTED",steps:0,source_sha:"0".repeat(40),
      compiler_sha256:"1".repeat(64),receipt:source()}},
    {...base,java:{state:"HOST_MODEL",steps:99}},
    {...base,wasm:{state:"UNSUPPORTED",receipt:source()}}
  ]) assert.throws(()=>verifyFiveBackendObservations(forged),/INVALID_LIFECYCLE/);
});
