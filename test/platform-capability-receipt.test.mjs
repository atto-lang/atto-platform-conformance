import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyPlatformCapabilityReceipt } from "../bin/verify-platform-capability-receipt.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const contract=JSON.parse(fs.readFileSync(
  path.join(root,"contracts/platform-capabilities-v1.json"),"utf8"));

function baseReceipt() {
  return {
    schema:"oreslang.platform-capability/1",
    platform:"desktop",
    repository:"ores-truffle-oreslang/oreslang-platform.desktop",
    sourceCommit:"a".repeat(40),
    stage:"compiler-guest",
    evidence:{
      exactHead:true,
      executedSteps:12,
      workflowConclusion:"success",
      targetArtifactSha256:"b".repeat(64),
      abiLinked:true,
      hostReferenceOnly:false,
      compilerProduced:true,
      compilerSourceCommit:"c".repeat(40),
      compilerBinarySha256:"d".repeat(64)
    }
  };
}

test("accepts exact-head compiler guest evidence",()=>{
  const result=verifyPlatformCapabilityReceipt(baseReceipt(),contract);
  assert.equal(result.ok,true,result.errors.join("\n"));
});

test("rejects zero-step workflow evidence",()=>{
  const receipt=baseReceipt();
  receipt.evidence.executedSteps=0;
  const result=verifyPlatformCapabilityReceipt(receipt,contract);
  assert.equal(result.ok,false);
  assert.match(result.errors.join("\n"),/zero-step/);
});

test("requires a successful workflow conclusion at every promotion stage",()=>{
  for(const stage of ["host-reference","abi-link","compiler-guest","target-execution","physical-hardware"]){
    const receipt=baseReceipt();
    receipt.stage=stage;
    receipt.evidence.targetExecuted=true;
    receipt.evidence.physicalHardware=true;
    for(const missing of [undefined,null,"", "queued","failure","cancelled"]){
      if(missing===undefined)delete receipt.evidence.workflowConclusion;
      else receipt.evidence.workflowConclusion=missing;
      const result=verifyPlatformCapabilityReceipt(receipt,contract);
      assert.equal(result.ok,false,stage+":"+String(missing));
      assert.match(result.errors.join("\\n"),/workflowConclusion must be success/);
    }
    receipt.evidence.workflowConclusion="success";
    assert.equal(verifyPlatformCapabilityReceipt(receipt,contract).ok,true,stage);
  }
});

test("rejects non-safe and non-integral executedSteps before stage promotion",()=>{
  const receipt=baseReceipt();
  for(const steps of [0,-1,0.25,Number.MAX_SAFE_INTEGER+1,1e100,NaN,Infinity,"5",null]){
    receipt.evidence.executedSteps=steps;
    const result=verifyPlatformCapabilityReceipt(receipt,contract);
    assert.equal(result.ok,false,String(steps));
    assert.match(result.errors.join("\\n"),/positive safe integer/);
  }
  for(const steps of [1,Number.MAX_SAFE_INTEGER]){
    receipt.evidence.executedSteps=steps;
    assert.equal(verifyPlatformCapabilityReceipt(receipt,contract).ok,true,String(steps));
  }
});

test("rejects host stub promoted as compiler guest",()=>{
  const receipt=baseReceipt();
  receipt.evidence.hostReferenceOnly=true;
  receipt.evidence.compilerProduced=false;
  const result=verifyPlatformCapabilityReceipt(receipt,contract);
  assert.equal(result.ok,false);
  assert.match(result.errors.join("\n"),/host-reference-only/);
  assert.match(result.errors.join("\n"),/compilerProduced/);
});

test("rejects omitted hostReferenceOnly at compiler-guest stage",()=>{
  const receipt=baseReceipt();
  delete receipt.evidence.hostReferenceOnly;
  const result=verifyPlatformCapabilityReceipt(receipt,contract);
  assert.equal(result.ok,false);
  assert.match(result.errors.join("\n"),/hostReferenceOnly=false/);
});

test("rejects a reordered alternate v1 contract",()=>{
  const weakened=structuredClone(contract);
  weakened.stageOrder=["compiler-guest"];
  const receipt=baseReceipt();
  delete receipt.evidence.abiLinked;
  delete receipt.evidence.hostReferenceOnly;
  delete receipt.evidence.compilerProduced;
  delete receipt.evidence.compilerSourceCommit;
  delete receipt.evidence.compilerBinarySha256;
  const result=verifyPlatformCapabilityReceipt(receipt,weakened);
  assert.equal(result.ok,false);
  assert.match(result.errors.join("\n"),/stageOrder/);
});

test("rejects alternate contract repository substitution",()=>{
  const weakened=structuredClone(contract);
  weakened.platforms.desktop.repository="attacker/private-carrier";
  const result=verifyPlatformCapabilityReceipt(baseReceipt(),weakened);
  assert.equal(result.ok,false);
  assert.match(result.errors.join("\n"),/repository mismatch for desktop/);
});

test("rejects inherited prototype names as fake registered platforms",()=>{
  for(const platform of ["__proto__","constructor","toString","valueOf","hasOwnProperty"]){
    const receipt=baseReceipt();
    receipt.platform=platform;
    delete receipt.repository; // formerly matched undefined inherited repository
    const result=verifyPlatformCapabilityReceipt(receipt,contract);
    assert.equal(result.ok,false,platform);
    assert.match(result.errors.join("\n"),/unknown platform/,platform);
  }
});

test("rejects nonstring platform keys even when coercion names a registered platform",()=>{
  const receipt=baseReceipt();
  for(const platform of [null,undefined,42,[],{toString:()=> "desktop"}]){
    receipt.platform=platform;
    const result=verifyPlatformCapabilityReceipt(receipt,contract);
    assert.equal(result.ok,false,String(platform));
    assert.match(result.errors.join("\n"),/unknown platform/);
  }
});

test("rejects repository/platform substitution",()=>{
  const receipt=baseReceipt();
  receipt.repository="ores-truffle-oreslang/oreslang-platform.mobile";
  const result=verifyPlatformCapabilityReceipt(receipt,contract);
  assert.equal(result.ok,false);
  assert.match(result.errors.join("\n"),/registered platform repository/);
});

test("target and physical stages require their own evidence",()=>{
  const target=baseReceipt();
  target.stage="target-execution";
  let result=verifyPlatformCapabilityReceipt(target,contract);
  assert.equal(result.ok,false);
  assert.match(result.errors.join("\n"),/targetExecuted/);

  target.evidence.targetExecuted=true;
  target.stage="physical-hardware";
  result=verifyPlatformCapabilityReceipt(target,contract);
  assert.equal(result.ok,false);
  assert.match(result.errors.join("\n"),/physicalHardware/);

  target.evidence.physicalHardware=true;
  result=verifyPlatformCapabilityReceipt(target,contract);
  assert.equal(result.ok,true,result.errors.join("\n"));
});

test("compiler promotion requires exact compiler revision and binary digest",()=>{
  const receipt=baseReceipt();
  delete receipt.evidence.compilerSourceCommit;
  delete receipt.evidence.compilerBinarySha256;
  const result=verifyPlatformCapabilityReceipt(receipt,contract);
  assert.equal(result.ok,false);
  assert.match(result.errors.join("\n"),/compilerSourceCommit/);
  assert.match(result.errors.join("\n"),/compilerBinarySha256/);
});

test("capability CLI never logs private paths or malformed JSON payloads",()=>{
  const secret="PRIVATE_RUNNER_PATH_OR_BEARER_MUST_NOT_LEAK";
  const cli=path.join(root,"bin/verify-platform-capability-receipt.mjs");
  const safeExpected="platform receipt: INVALID_OR_UNREADABLE_JSON_INPUT\\n";
  const run=input=>spawnSync(process.execPath,[cli,input],{
    encoding:"utf8",timeout:10000,
    env:{...process.env,NODE_OPTIONS:"",GITHUB_TOKEN:secret}
  });
  const missing=run(path.join(os.tmpdir(),secret,"missing-receipt.json"));
  assert.equal(missing.status,1);
  assert.equal(missing.stdout,"");
  assert.equal(missing.stderr,safeExpected);
  const work=fs.mkdtempSync(path.join(os.tmpdir(),"ores-platform-receipt-redact-"));
  try{
    const malicious=path.join(work,"input.json");
    fs.writeFileSync(malicious,secret+" INVALID_JSON");
    const bad=run(malicious);
    assert.equal(bad.status,1);
    assert.equal(bad.stdout,"");
    assert.equal(bad.stderr,safeExpected);
  }finally{fs.rmSync(work,{recursive:true,force:true})}
});
