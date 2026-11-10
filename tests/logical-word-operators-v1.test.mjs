import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve, join} from "node:path";
import {fileURLToPath} from "node:url";
import {PINS,gitBlob,validateLogicalContract,assessLogicalReceipt} from "../lib/logical-word-operators-v1.mjs";

const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const manifest=JSON.parse(readFileSync(join(root,"contracts/logical-word-operators-v1.json"),"utf8"));
const clone=x=>structuredClone(x);
const baselineCases=manifest.fixtures.filter(f=>f.profile==="baseline").map(f=>
  f.kind==="GUEST_EXIT"
  ? {id:f.id,input_blob:f.git_blob,guest_exit_code:f.expected_exit,compiled_and_linked:true}
  : {id:f.id,input_blob:f.git_blob,compiler_exit_code:1,ir_bytes:0,executable_bytes:0,diagnostic_seen:true}
);
const receipt={
  backend:"llvm",repository:"ores-truffle-oreslang/oreslang-source.llvm",
  execution_repository:"ores-truffle-oreslang/oreslang-source.llvm",
  head_sha:"a".repeat(40),tree_sha:"b".repeat(40),
  compiled_guest_sha256:"c".repeat(64),
  job:{id:111,run_id:222,run_attempt:1,runner_id:333,steps:[
    ...["checkout-exact-head","compile-atto","execute-guest","reject-negative-no-output"].map((name,i)=>
      ({name,number:i+1,status:"completed",conclusion:"success"}))
  ]},
  profile:"baseline",test_kind:"COMPILER_LINKED_ATTO_GUEST",
  provenance_class:"GUEST_NOT_HOST_OR_SOURCE_FREE",cases:baselineCases
};

test("canonical exact-byte fixtures and five-backend inventory remain source-only",()=>{
  assert.deepEqual(validateLogicalContract(manifest,root),PINS);
  assert.deepEqual(Object.keys(manifest.backends).sort(),["forge","java","llvm","net","wasm"]);
  assert.equal(manifest.receipts.length,0);
  assert.equal(manifest.spelling.xor,"eager-on-success-ltr-once");
  assert.equal(manifest.fixtures.filter(f=>f.kind==="COMPILE_REJECT_NO_OUTPUT").length,10);
  assert.equal(manifest.fixtures.filter(f=>f.kind==="GUEST_EXIT").length,8);
});

test("a source mutation cannot silently retain a Git-blob pin",()=>{
  const temp=mkdtempSync(join(tmpdir(),"atto-logic-"));
  try {
    mkdirSync(join(temp,"fixtures/logical-word-operators-v1"),{recursive:true});
    for(const f of manifest.fixtures) {
      const bytes=readFileSync(join(root,f.path));
      assert.equal(gitBlob(bytes),f.git_blob);
      writeFileSync(join(temp,f.path),bytes);
    }
    assert.deepEqual(validateLogicalContract(manifest,temp),PINS);
    const target=manifest.fixtures.find(f=>f.id==="scalar-parity");
    writeFileSync(join(temp,target.path),readFileSync(join(root,target.path),"utf8")+" ");
    assert.throws(()=>validateLogicalContract(manifest,temp),/blob drift|invalid logical fixture bytes/);
  } finally {rmSync(temp,{recursive:true,force:true});}
});

test("contract cannot falsely self-promote verified runs or rewrite operator semantics",()=>{
  const mutations=[
    {...manifest,status:"VERIFIED"},
    {...manifest,receipts:[{ok:true}]},
    {...manifest,spelling:{...manifest.spelling,xor:"short-circuit"}},
    {...manifest,backends:{...manifest.backends,llvm:{...manifest.backends.llvm,state:"VERIFIED"}}},
    {...manifest,backends:{...manifest.backends,js:{repo:"fake"}}},
    {...manifest,fixtures:manifest.fixtures.slice(1)},
    {...manifest,fixtures:[...manifest.fixtures.slice(1),manifest.fixtures[1]]},
    {...manifest,fixtures:manifest.fixtures.map(f=>f.id==="reject-dead-and"?{...f,kind:"GUEST_EXIT",expected_exit:42}:f)}
  ];
  for(const x of mutations)assert.throws(()=>validateLogicalContract(x,root));
});

test("zero-step, runner_id=0, host-only canaries and forged guest outcomes never certify",()=>{
  const mutationList=[
    {job:{...receipt.job,steps:[]}},
    {job:{...receipt.job,steps:null}},
    {job:{...receipt.job,runner_id:0}},
    {job:{...receipt.job,run_attempt:0}},
    {job:{...receipt.job,steps:[{name:"checkout-exact-head",status:"completed",conclusion:"success"}]}},
    {job:{...receipt.job,steps:receipt.job.steps.map((s,i)=>i===2?{...s,conclusion:"failure"}:s)}},
    {test_kind:"HOST_ONLY_CANARY"},
    {provenance_class:"SOURCE_FREE_MODEL"},
    {claimed_state:"VERIFIED"},
    {head_sha:"unknown"},
    {tree_sha:"unknown"},
    {compiled_guest_sha256:null},
    {cases:receipt.cases.slice(1)},
    {cases:receipt.cases.map(c=>c.id==="scalar-parity"?{...c,guest_exit_code:7}:c)},
    {cases:receipt.cases.map(c=>c.id==="reject-dead-or"?{...c,ir_bytes:1}:c)},
    {cases:receipt.cases.map(c=>c.id==="reject-double-caret-xor"?{...c,diagnostic_seen:false}:c)}
  ];
  for(const mutation of mutationList) {
    const result=assessLogicalReceipt(manifest,{...clone(receipt),...mutation});
    assert.equal(result.state,"NOT_VERIFIED",JSON.stringify(mutation));
  }
});

test("cross-repository mirrors need independent exact-tree export authorization",()=>{
  const elsewhere={...clone(receipt),execution_repository:"other-org/test-runner"};
  assert.equal(assessLogicalReceipt(manifest,elsewhere).reason,"PRIVATE_SOURCE_EXPORT_NOT_AUTHORIZED");
  elsewhere.private_carrier_approval={
    authorized:true,destination_repository:"other-org/test-runner",destination_repository_id:123,
    approved_source_tree:"d".repeat(40),independent_reviewer:"independent-reviewer"
  };
  assert.equal(assessLogicalReceipt(manifest,elsewhere).state,"NOT_VERIFIED");
  elsewhere.private_carrier_approval.approved_source_tree=elsewhere.tree_sha;
  assert.match(assessLogicalReceipt(manifest,elsewhere).state,/^CANDIDATE_/);
});

test("even fully shaped synthetic receipts cannot prove native compilation or five-backend parity",()=>{
  const result=assessLogicalReceipt(manifest,receipt);
  assert.match(result.state,/^CANDIDATE_REQUIRES_LIVE_/);
  assert.doesNotMatch(result.state,/^VERIFIED$/);
  const effect={...clone(receipt),profile:"borrow_mut_class_effects",
    cases:manifest.fixtures.filter(f=>f.profile==="borrow_mut_class_effects").map(f=>
      ({id:f.id,input_blob:f.git_blob,compiled_and_linked:true,guest_exit_code:f.expected_exit}))};
  assert.match(assessLogicalReceipt(manifest,effect).state,/^CANDIDATE_/);
});


test("receipt schema rejects forged manifest fixtures, backend IDs and weaker execution gates",()=>{
  const tampered=[
    {...manifest,fixtures:manifest.fixtures.filter(f=>f.id!=="reject-dead-or")},
    {...manifest,fixtures:manifest.fixtures.map(f=>f.id==="scalar-parity"?{...f,expected_exit:7}:f)},
    {...manifest,backends:{...manifest.backends,llvm:{...manifest.backends.llvm,repo:"other-org/llvm"}}},
    {...manifest,required_execution:manifest.required_execution.filter(s=>s!=="INDEPENDENT_REVIEW")},
    {...manifest,receipts:[{state:"VERIFIED"}]},
    {...manifest,spelling:{...manifest.spelling,precedence_tight_to_loose:["or","xor","and"]}}
  ];
  for (const source of tampered) {
    assert.throws(()=>validateLogicalContract(source,root));
    assert.equal(assessLogicalReceipt(source,receipt).reason,"UNTRUSTED_CONTRACT_OR_BACKEND");
  }
});

test("receipt step identities cannot be duplicated or left unnumbered",()=>{
  for (const steps of [
    receipt.job.steps.map((s,i)=>i===1?{...s,number:1}:s),
    receipt.job.steps.map((s,i)=>i===1?{...s,number:undefined}:s),
    [...receipt.job.steps,{...receipt.job.steps[0],number:99}]
  ]) {
    assert.equal(assessLogicalReceipt(manifest,{...clone(receipt),
      job:{...receipt.job,steps}}).state,"NOT_VERIFIED");
  }
});

test("fixtures must not traverse symlinked parent directories",()=>{
  const base=mkdtempSync(join(tmpdir(),"atto-logical-safe-"));
  const external=mkdtempSync(join(tmpdir(),"atto-logical-external-"));
  try {
    mkdirSync(join(external,"logical-word-operators-v1"),{recursive:true});
    for (const f of manifest.fixtures)
      writeFileSync(join(external,"logical-word-operators-v1",f.id+".atto"),
        readFileSync(join(root,f.path)));
    symlinkSync(external,join(base,"fixtures"),"dir");
    assert.throws(()=>validateLogicalContract(manifest,base),/symlink/);
  } finally {
    rmSync(base,{recursive:true,force:true});
    rmSync(external,{recursive:true,force:true});
  }
});
