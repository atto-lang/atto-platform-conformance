import test from "node:test";
import assert from "node:assert/strict";
import {verifyOptionResultTrapReceipt} from "../bin/verify-option-result-trap-receipt.mjs";

const digest="b".repeat(64), source="a".repeat(40), compiler="c".repeat(64);
const manifest={
  schema:"oreslang.option-result-trap.fixtures/v1",
  backends:["java","llvm","wasm","cranelift","net"],
  cases:[
    {id:"P",kind:"guest_stdout",expected_stdout:"ORT1:11:END"},
    {id:"N",kind:"compile_reject"},
    {id:"F",kind:"guest_panic",forbidden_stdout:"UNREACHABLE",expected_diagnostic_contains:"Option::unwrap"}
  ]
};
const base=()=>({
  schema:"oreslang.option-result-trap.receipt/v1",
  backend:"java",caseId:"P",sourceCommit:source,stdlibCommit:source,
  compilerBinarySha256:compiler,fixtureSha256:digest,runtimeVersion:"test-only",
  evidence:{
    exactHead:true,sourceCommit:source,runnerId:123,runAttempt:1,
    steps:["compile Oreslang guest","execute Oreslang guest"],
    workflowConclusion:"success",hostReferenceOnly:false,compilerProduced:true,
    compilerExitCode:0,guestLaunched:true,guestExitCode:0,guestStep:"execute Oreslang guest",
    stdout:"ORT1:11:END",stderr:""
  }
});
const accepts=r=>verifyOptionResultTrapReceipt(r,manifest,digest).ok;
test("structure-valid positive (NOT guest attestation)",()=>assert.equal(accepts(base()),true));
test("wrong guest stdout fails",()=>{const r=base();r.evidence.stdout="ORT1:10:END";assert.equal(accepts(r),false)});
test("zero-step or runnerless report fails",()=>{const r=base();r.evidence.steps=[];r.evidence.runnerId=0;assert.equal(accepts(r),false)});
test("unexecuted guest fails",()=>{const r=base();r.evidence.guestLaunched=false;assert.equal(accepts(r),false)});
test("host-only/mock compiler fails",()=>{const r=base();r.evidence.hostReferenceOnly=true;assert.equal(accepts(r),false)});
test("fixture digest mismatch fails",()=>{const r=base();r.fixtureSha256="d".repeat(64);assert.equal(accepts(r),false)});
test("other backend or source-head substitution fails",()=>{const r=base();r.backend="forge";r.evidence.sourceCommit="0".repeat(40);assert.equal(accepts(r),false)});
test("typed compile rejection shape accepted",()=>{const r=base();r.caseId="N";Object.assign(r.evidence,{compilerExitCode:1,guestLaunched:false,guestExitCode:null,guestStep:null,diagnosticCategory:"type",stdout:"",stderr:"unknown Option member"});assert.equal(accepts(r),true)});
test("compile rejection that launched guest fails",()=>{const r=base();r.caseId="N";Object.assign(r.evidence,{compilerExitCode:1,guestLaunched:true,guestExitCode:null,guestStep:null,diagnosticCategory:"type",stdout:"",stderr:"not valid"});assert.equal(accepts(r),false)});
test("panic bypass shape accepted",()=>{const r=base();r.caseId="F";Object.assign(r.evidence,{guestExitCode:1,runtimeControl:"guest_panic",stderr:"Option::unwrap on None",stdout:""});assert.equal(accepts(r),true)});
test("panic swallowed into normal success fails",()=>{const r=base();r.caseId="F";Object.assign(r.evidence,{guestExitCode:0,runtimeControl:"normal",stderr:"",stdout:"UNREACHABLE"});assert.equal(accepts(r),false)});
test("unreported run-attempt fails",()=>{const r=base();r.evidence.runAttempt=0;assert.equal(accepts(r),false)});
