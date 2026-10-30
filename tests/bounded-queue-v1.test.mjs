import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  BACKENDS, INVARIANTS,
  validateBoundedQueueContract,
  validateBoundedQueueBackendStatus
} from "../src/bounded-queue-v1.mjs";

const contractPath=new URL("../contracts/v1/bounded-queue/bounded-queue-v1.json",import.meta.url);
const statusPath=new URL("../contracts/v1/bounded-queue/backend-status.pending.json",import.meta.url);

async function json(url){return JSON.parse(await readFile(url,"utf8"))}

test("bounded queue v1 has all safety and progress invariants",async()=>{
  const result=validateBoundedQueueContract(await json(contractPath));
  assert.equal(result.ok,true);
  assert.equal(result.invariants,15);
  assert.equal(result.scenarios,6);
  assert.equal(result.backends,5);
  assert.equal(INVARIANTS[0],"BQ01");
  assert.equal(INVARIANTS.at(-1),"BQ15");
});

test("pending backend ledger is five-backend and never self-certifies",async()=>{
  const status=await json(statusPath);
  const result=validateBoundedQueueBackendStatus(status);
  assert.deepEqual(status.records.map(x=>x.backend),BACKENDS);
  assert.equal(result.executedBackendCount,0);
  assert.equal(result.parityCertified,false);
  assert.equal(result.releaseReady,false);
  assert.equal(result.blocked.length,5);
});

test("runtime substrate does not impersonate source or guest parity",async()=>{
  const status=await json(statusPath);
  const java=status.records.find(x=>x.backend==="oreslang-source.java");
  const llvm=status.records.find(x=>x.backend==="oreslang-source.llvm");
  const net=status.records.find(x=>x.backend==="oreslang-source.net");
  assert.equal(java.runtime_substrate,"implementation-added-unexecuted");
  assert.equal(java.source_lowering,"implemented-unexecuted");
  assert.equal(java.guest_execution,"NOT_EXECUTED");
  assert.equal(llvm.runtime_substrate,"contract-tests-added-unexecuted");
  assert.equal(llvm.source_lowering,"unsupported");
  assert.equal(net.runtime_substrate,"contract-tests-added-unexecuted");
  assert.equal(net.source_lowering,"unsupported");
  assert.equal(llvm.guest_execution,"NOT_EXECUTED");
  assert.equal(net.guest_execution,"NOT_EXECUTED");
});

test("WASM and Forge stay fail-closed until selectable channel substrate exists",async()=>{
  const status=await json(statusPath);
  for(const backend of ["oreslang-source.wasm","oreslang-source.forge"]){
    const record=status.records.find(x=>x.backend===backend);
    assert.equal(record.source_lowering,"unsupported");
    assert.equal(record.runtime_substrate,"unsupported");
    assert.equal(record.guest_execution,"NOT_EXECUTED");
  }
});

test("reject fake promotion and vector drift",async()=>{
  const status=await json(statusPath);
  status.records[0].guest_execution="passed";
  assert.throws(()=>validateBoundedQueueBackendStatus(status),/INVALID_BOUNDED_QUEUE_V1/);

  const contract=await json(contractPath);
  contract.arbitration.close_linearization=
    "publish a consumable synthetic close token";
  assert.throws(()=>validateBoundedQueueContract(contract),/INVALID_BOUNDED_QUEUE_V1/);
});

test("cancelled older waiter vector forbids ghost delivery",async()=>{
  const contract=await json(contractPath);
  const scenario=contract.scenarios.find(x=>x.id==="cancel_older_then_progress");
  assert.deepEqual(scenario.expected,[
    "admitted:0","pending:t1","pending:t2","cancelled:t1",
    "value:0","admitted:t2","value:2"
  ]);
  assert.equal(scenario.expected.includes("value:1"),false);
});

test("close linearizes through actual channel rather than a consumable token",async()=>{
  const contract=await json(contractPath);
  assert.match(contract.arbitration.close_linearization,/actual item channel/);
  assert.match(contract.arbitration.pending_push[1],/Channel\.close/);
  assert.match(contract.arbitration.receive_linearization,/FIFO/);
});

test("full returns exact payload ownership instead of consuming it",async()=>{
  const contract=await json(contractPath);
  const scenario=contract.scenarios.find(x=>x.id==="full_returns_payload");
  assert.deepEqual(scenario.expected,[
    "admitted:owned-0","full:t1:return-exact-owned-1"
  ]);
  assert.match(
    contract.required_invariants.find(x=>x.id==="BQ15").rule,
    /exact original payload/
  );
});
