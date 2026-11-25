import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {decide} from "../src/declaration-taxonomy-v1.mjs";

const policy = JSON.parse(await readFile(
  new URL("../contracts/declaration-taxonomy-v1.json",import.meta.url), "utf8"
));
const clone = value => structuredClone(value);
test("50 nominal inheritance/state/capability policy vectors",()=>{
  assert.equal(policy.schema_version,"1.0.0-design");
  assert.equal(policy.status,"SOURCE_FREE_POLICY_MODEL_NOT_COMPILER_PARITY");
  assert.equal(policy.test_cases.length,50);
  assert.equal(new Set(policy.test_cases.map(c=>c.id)).size,50);
  for (const c of policy.test_cases)
    assert.equal(decide(policy,c),c.expected,c.id);
});
test("all six compiler backends remain NOT_EXECUTED",()=>{
  assert.deepEqual(policy.baseline_backends,["java","llvm","wasm","cranelift","net","forge"]);
  assert.deepEqual(Object.keys(policy.backend_execution).sort(),[...policy.baseline_backends].sort());
  assert.ok(Object.values(policy.backend_execution).every(x=>x==="NOT_EXECUTED"));
});
test("no inconsistent kind or unknown nominal parent may pass",()=>{
  for (const kind of Object.keys(policy.rules)) {
    const c={kind,options:{parents:[{kind:"never-defined"}]}};
    assert.equal(decide(policy,c),"PARENT_KIND",kind);
  }
  assert.equal(decide(policy,{kind:"unknown",options:{}}),"UNKNOWN_KIND");
});
test("mutation witnesses catch forged capabilities and escaping state",()=>{
  const c={kind:"actor",options:{traits:[],interfaces:[],state_blocks:1}};
  assert.equal(decide(policy,c),"OK");
  const changes=[
    [{direct_state_access:true},"DIRECT_STATE_ACCESS"],
    [{loan_escape:true},"STATE_LOAN_ESCAPE"],
    [{loan_across_await:true},"STATE_LOAN_SUSPEND"],
    [{override_intrinsic:true},"SEALED_INTRINSIC"],
    [{traits:[{capabilities:["gpu"]}]},"TRAIT_CAPABILITY_GRANT"],
    [{interfaces:[{kind:"interface",capabilities:["control"]}]},"INTERFACE_CAPABILITY_GRANT"],
    [{ordinary_fields:1},"PERSISTENT_STATE_OUTSIDE_SCHEMA"],
    [{state_blocks:2},"STATE_SCHEMA_COUNT"],
    [{parents:[{kind:"class"}]},"PARENT_KIND"],
  ];
  for (const [mutation,expected] of changes) {
    const bad=clone(c); Object.assign(bad.options,mutation);
    assert.equal(decide(policy,bad),expected,JSON.stringify(mutation));
  }
});
