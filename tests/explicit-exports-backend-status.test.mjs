import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const contractPath=new URL("../fixtures/explicit-exports-v1/contract.json",import.meta.url);
const ledgerPath=new URL("../fixtures/explicit-exports-v1/backend-status.json",import.meta.url);
const contract=JSON.parse(fs.readFileSync(contractPath,"utf8"));
const ledger=JSON.parse(fs.readFileSync(ledgerPath,"utf8"));
const backends=["java","llvm","net","wasm","forge","js"];

test("explicit export backend ledger pins the reconciled contract",()=>{
  assert.equal(ledger.schema,"oreslang.explicit-exports.backend-status.v1");
  assert.deepEqual(Object.keys(ledger.backends).sort(),backends.slice().sort());
  assert.equal(ledger.contract.pull_request,156);
  assert.equal(ledger.contract.git_blob_sha1,"30ac6fd83c25a2f4a62b6c9611bb86daebf39cbb");
  assert.equal(ledger.contract.oracle_git_blob_sha1,"8844f67fd2a678c2c29118c1f74f6b1e91dcd455");
  assert.equal(ledger.contract.revision,"explicit-exports-v1.2026-10-26.5");
  assert.equal(contract.syntax_cases.length,32);
  assert.equal(contract.cases.length,46);
  assert.equal(contract.modifier_cases.length,5);
  assert.equal(contract.abi_cases.length,7);
  assert.equal(contract.access_cases.length,7);
  assert.equal(ledger.contract.required_backend_report_rows,97);
  assert.equal(contract.native_exposure,"separate");
});

test("no backend can be certified from source-free reference evidence",()=>{
  assert.equal(ledger.policy.confirmed_requires_real_exact_head_execution,true);
  assert.equal(ledger.policy.zero_step_is_not_execution,true);
  assert.equal(ledger.policy.private_source_cross_org_mirror_authorized,false);
  assert.equal(ledger.policy.no_backend_may_mark_complete_from_reference_oracle_only,true);
  assert.equal(ledger.policy.current_contract_execution,"NOT_EXECUTED");
  for(const backend of backends){
    const status=ledger.backends[backend];
    assert.equal(status.runtime_evidence,"NOT_EXECUTED",backend);
    assert.notEqual(status.syntax,"confirmed",backend);
    assert.notEqual(status.semantic_bindings,"confirmed",backend);
  }
});

test("canonical implementation PRs remain pinned",()=>{
  assert.equal(ledger.backends.java.implementation_pr,2066);
  assert.equal(ledger.backends.llvm.implementation_pr,1015);
  assert.equal(ledger.backends.net.implementation_pr,149);
  assert.equal(ledger.backends.net.syntax_pr,152);
  assert.equal(ledger.backends.wasm.implementation_pr,124);
  assert.equal(ledger.backends.forge.implementation_pr,105);
  assert.equal(ledger.backends.js.implementation_pr,55);
  assert.equal(ledger.policy.backend_report_protocol_pr,166);
});

test("integrated .NET syntax and JS source-qualified calls are not false backend confirmations",()=>{
  const net=ledger.backends.net,js=ledger.backends.js;
  assert.equal(net.semantic_bindings,"draft-implemented-scalar-main-only");
  assert.ok(net.notes.some(note=>note.includes("staged from #152 onto semantic #149")));
  assert.ok(net.blockers.includes("general multi-declaration namespace frontend"));
  assert.equal(js.semantic_bindings,"draft-implemented-program-v2-subset");
  assert.ok(js.notes.some(note=>note.includes("PUBLIC SourceExportBinding")));
  assert.ok(js.blockers.includes("program-v2 lacks imports"));
  for(const backend of [net,js]){
    assert.match(backend.implementation_head,/^[0-9a-f]{40}$/);
    assert.equal(backend.runtime_evidence,"NOT_EXECUTED");
  }
});

test("native linkage remains separate and partial backends keep blockers",()=>{
  for(const backend of ["java","llvm","net","forge","js"]){
    assert.equal(ledger.backends[backend].native_linkage_separation,"implemented-in-draft",backend);
    assert.ok(ledger.backends[backend].blockers.length>0,backend);
  }
  assert.equal(ledger.backends.wasm.native_linkage_separation,"draft-real-compiler-boundary-gate");
  assert.ok(ledger.backends.wasm.blockers.length>0);
});
