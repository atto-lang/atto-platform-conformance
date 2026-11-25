import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyPlatformCapabilityReceipt } from "../bin/verify-platform-capability-receipt.mjs";

const contract=JSON.parse(readFileSync(
  new URL("../contracts/platform-capabilities-v1.json",import.meta.url),"utf8"
));
const canonical=()=>({
  schema:"oreslang.platform-capability/1",
  platform:"desktop",
  repository:"ores-truffle-oreslang/oreslang-platform.desktop",
  sourceCommit:"a".repeat(40),
  stage:"physical-hardware",
  evidence:{
    exactHead:true,
    executedSteps:8,
    workflowConclusion:"success",
    targetArtifactSha256:"b".repeat(64),
    abiLinked:true,
    hostReferenceOnly:false,
    compilerProduced:true,
    compilerSourceCommit:"c".repeat(40),
    compilerBinarySha256:"d".repeat(64),
    targetExecuted:true,
    physicalHardware:true
  }
});
const accepted=(receipt)=>verifyPlatformCapabilityReceipt(receipt,contract);

test("ordinary own-data receipts preserve all five stage shapes",()=>{
  for(const platform of Object.keys(contract.platforms)) {
    for(const stage of contract.stageOrder) {
      const receipt=canonical();
      receipt.platform=platform;
      receipt.repository=contract.platforms[platform].repository;
      receipt.stage=stage;
      const result=accepted(receipt);
      assert.equal(result.ok,true,platform+"/"+stage+": "+result.errors.join("; "));
    }
  }
});

test("every required evidence getter is rejected without executing getter code",()=>{
  const fields=[
    "exactHead","executedSteps","workflowConclusion","targetArtifactSha256",
    "abiLinked","hostReferenceOnly","compilerProduced","compilerSourceCommit",
    "compilerBinarySha256","targetExecuted","physicalHardware"
  ];
  for(const field of fields) {
    const candidate=canonical();
    const prior=candidate.evidence[field];
    let reads=0;
    Object.defineProperty(candidate.evidence,field,{
      configurable:true,enumerable:true,
      get(){reads++;return prior;}
    });
    const result=accepted(candidate);
    assert.equal(result.ok,false,field+" accessor must not be accepted");
    assert.match(result.errors.join("; "),new RegExp(field),field);
    assert.equal(reads,0,field+" accessor must never execute");
  }
});

test("every required top-level getter is rejected without executing getter code",()=>{
  for(const field of ["schema","platform","repository","sourceCommit","stage","evidence"]) {
    const candidate=canonical();
    const prior=candidate[field];
    let reads=0;
    Object.defineProperty(candidate,field,{
      configurable:true,enumerable:true,
      get(){reads++;return prior;}
    });
    const result=accepted(candidate);
    assert.equal(result.ok,false,field+" getter must not supply proof");
    assert.ok(result.errors.length>0,field+" must have rejection diagnostics");
    assert.equal(reads,0,field+" getter must not execute");
  }
});

test("flapping getters cannot switch failed proofs into accepted proofs",()=>{
  for(const field of ["executedSteps","workflowConclusion","compilerProduced","physicalHardware"]) {
    const candidate=canonical();
    let reads=0;
    Object.defineProperty(candidate.evidence,field,{
      configurable:true,enumerable:true,
      get(){reads++;return reads===1
        ? field==="executedSteps" ? 12 : field==="workflowConclusion" ? "success" : true
        : null;}
    });
    const result=accepted(candidate);
    assert.equal(result.ok,false,field+" flapping getter must fail");
    assert.equal(reads,0,field+" getter must not run");
  }
});

test("malformed receipt values cannot promote source-free, host-only or zero-step evidence",()=>{
  const mutations=[
    (r)=>{r.evidence.executedSteps=0;},
    (r)=>{r.evidence.executedSteps="8";},
    (r)=>{r.evidence.workflowConclusion="failure";},
    (r)=>{r.evidence.hostReferenceOnly=true;},
    (r)=>{r.evidence.compilerProduced=false;},
    (r)=>{r.evidence.targetExecuted=false;},
    (r)=>{r.evidence.physicalHardware=false;},
    (r)=>{r.evidence.exactHead=false;},
    (r)=>{r.sourceCommit="a".repeat(39);},
    (r)=>{r.evidence.compilerBinarySha256="0".repeat(63);}
  ];
  for(const [index,mutate] of mutations.entries()) {
    const candidate=canonical();
    mutate(candidate);
    const result=accepted(candidate);
    assert.equal(result.ok,false,"mutation "+index+" must not be admitted");
  }
});

// This only verifies the *shape* of self-reported evidence; a valid object
// does not authenticate the underlying source tree, runner, logs or hardware.
