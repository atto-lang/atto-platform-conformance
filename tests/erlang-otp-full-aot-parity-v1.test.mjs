import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {
  validate_erlang_aot_contract, SelectiveMailboxReference, supervisor_restart_plan
} from "../lib/erlang-otp-full-aot-model-v1.mjs";

const contractPath = fileURLToPath(new URL("../contracts/erlang-otp-full-aot-parity-v1.json", import.meta.url));
const read = () => JSON.parse(readFileSync(contractPath, "utf8"));
const clone = x => structuredClone(x);

test("24 Erlang/OTP capabilities stay source-only; all five backends require full guest AOT", () => {
  const c = read();
  const verdict = validate_erlang_aot_contract(c);
  assert.deepEqual(verdict, {
    status:"SOURCE_ONLY_NOT_EXECUTED",
    aot_parity_certified:false,
    executed_guest_backends:0,
    feature_count:24,
    deferred:["function_clause_matching"]
  });
  assert.ok(c.feature_plan.every(x => x.id !== "function_clause_matching"));
  assert.deepEqual(Object.keys(c.aot_policy.backend_modes).sort(), ["forge","java","llvm","net","wasm"]);
  assert.ok(c.required_negative_cases.includes("reject_runtime_guest_code_generation"));
});

test("operator regression, forged PASS receipt, missing backend, dynamic guest JIT all fail closed", () => {
  const source = read();
  const mutations = [
    x => {x.operator_contract.equality = "==";},
    x => {x.operator_contract.inequality = "!=";},
    x => {x.operator_contract.inequality_alias = "!=";},
    x => {x.operator_contract.no_implicit_numeric_cross_type_coercion = false;},
    x => {x.operator_contract.short_circuit_logic = "and";},
    x => {x.aot_policy.no_runtime_guest_jit = false;},
    x => {x.aot_policy.no_runtime_guest_code_generation = false;},
    x => {x.aot_policy.no_reflection_based_guest_dispatch = false;},
    x => {delete x.aot_policy.backend_modes.net;},
    x => {x.feature_plan.pop();},
    x => {x.feature_plan[1].status = "PASS";},
    x => {x.feature_plan[1].aot_lowering = "TODO";},
    x => {x.deferred = [];},
    x => {x.backend_evidence.java.aot_artifact = "VERIFIED";},
    x => {delete x.backend_evidence.wasm;},
    x => {x.receipts.push({passed:true});},
    x => {x.promotion_rules.source_free_model_never_proves_guest_parity = false;},
    x => {x.required_actor_cases = ["only one"];},
    x => {x.required_negative_cases = [];},
  ];
  for(const mutate of mutations) {
    const m=clone(source); mutate(m);
    assert.throws(() => validate_erlang_aot_contract(m), /INVALID_ERLANG_AOT_CONTRACT/);
  }
});

test("selective receive picks first matching message without destroying unmatched prefix", () => {
  const m = new SelectiveMailboxReference({capacity:3,generation:7});
  for(const [sender,type] of [["s1","Payment"],["s2","InventoryUpdate"],["s1","Shutdown"]])
    assert.equal(m.admit({sender,type,recipient_generation:7,payload:type}).status,"ACCEPTED");
  assert.deepEqual(m.pending_types(),["Payment","InventoryUpdate","Shutdown"]);
  assert.equal(m.admit({sender:"s2",type:"Extra",recipient_generation:7}).status,"FULL");
  const matched=m.receive_matching(x => x.type === "Shutdown");
  assert.equal(matched.status,"MATCHED");
  assert.equal(matched.message.type,"Shutdown");
  assert.deepEqual(m.pending_types(),["Payment","InventoryUpdate"]);
  assert.equal(m.receive_matching(x => x.type === "Nope").status,"NO_MATCH");
  assert.equal(m.receive_matching(x => x.type === "Payment").message.type,"Payment");
  assert.equal(m.receive_matching(x => x.type === "InventoryUpdate").message.type,"InventoryUpdate");
  assert.deepEqual(m.pending_types(),[]);
});

test("timeout, cancellation and guard miss retain mailbox order and quota", () => {
  const m=new SelectiveMailboxReference({capacity:2});
  m.admit({sender:"alice",type:"A",recipient_generation:1,payload:1});
  m.admit({sender:"bob",type:"B",recipient_generation:1,payload:2});
  assert.equal(m.receive_matching(x=>x.type==="B",{cancelled:true}).status,"CANCELLED");
  assert.equal(m.receive_matching(x=>x.type==="B",{deadline_expired:true,cancelled:true}).status,"CANCELLED");
  assert.equal(m.receive_matching(x=>x.type==="C",{deadline_expired:true}).status,"TIMED_OUT");
  assert.deepEqual(m.pending_types(),["A","B"]);
  assert.equal(m.admit({sender:"alice",type:"C",recipient_generation:1}).status,"FULL");
  assert.equal(m.receive_matching(x=>x.type==="B").status,"MATCHED");
  assert.deepEqual(m.pending_types(),["A"]);
});

test("actor reincarnation fences stale references and resets the old queue", () => {
  const m=new SelectiveMailboxReference({capacity:2,generation:19});
  assert.equal(m.admit({sender:"a",type:"Pending",recipient_generation:19}).status,"ACCEPTED");
  assert.equal(m.restart(),20);
  assert.deepEqual(m.pending_types(),[]);
  assert.equal(m.admit({sender:"a",type:"Old",recipient_generation:19}).status,"STALE_GENERATION");
  assert.equal(m.admit({sender:"a",type:"New",recipient_generation:20}).status,"ACCEPTED");
  m.close();
  assert.equal(m.admit({sender:"a",type:"Closed",recipient_generation:20}).status,"CLOSED");
  assert.equal(m.receive_matching(x=>x.type==="DoesNotExist").status,"CLOSED_NO_MATCH");
  assert.equal(m.receive_matching(x=>x.type==="New").status,"MATCHED");
});

test("one_for_one, one_for_all, rest_for_one child sets and stop/start ordering", () => {
  const children=["A","B","C","D"];
  assert.deepEqual(supervisor_restart_plan("one_for_one",children,"B"),{
    restart:["B"],stop_survivors:[],unaffected:["A","C","D"]});
  assert.deepEqual(supervisor_restart_plan("one_for_all",children,"B"),{
    restart:["A","B","C","D"],stop_survivors:["D","C","A"],unaffected:[]});
  assert.deepEqual(supervisor_restart_plan("rest_for_one",children,"B"),{
    restart:["B","C","D"],stop_survivors:["D","C"],unaffected:["A"]});
});

test("malformed supervisor definitions and invalid mailbox capacities reject", () => {
  for(const [strategy,children,failed] of [
    ["all",["A"],"A"],["one_for_one",[],"A"],
    ["one_for_one",["A","A"],"A"],["one_for_one",["A"],"B"]])
    assert.throws(()=>supervisor_restart_plan(strategy,children,failed), TypeError);
  for(const capacity of [0,-1,1.1,Number.NaN,Number.POSITIVE_INFINITY])
    assert.throws(()=>new SelectiveMailboxReference({capacity}),TypeError);
  const m=new SelectiveMailboxReference({capacity:2});
  assert.throws(()=>m.admit({sender:"",type:"Bad",recipient_generation:1}),TypeError);
  assert.throws(()=>m.receive_matching("not a matcher"),TypeError);
});

test("source-free reference results explicitly never confer backend parity", () => {
  const c = read();
  assert.equal(c.status,"DRAFT_SOURCE_CONTRACT_NOT_GUEST_EXECUTION");
  assert.ok(Object.values(c.backend_evidence).every(e=>Object.values(e).every(x=>x==="NOT_EXECUTED")));
  const m=new SelectiveMailboxReference({capacity:1});
  assert.equal(m.receive_matching(() => true).status,"NO_MATCH");
});
