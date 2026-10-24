import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

test("rejects host stub promoted as compiler guest",()=>{
  const receipt=baseReceipt();
  receipt.evidence.hostReferenceOnly=true;
  receipt.evidence.compilerProduced=false;
  const result=verifyPlatformCapabilityReceipt(receipt,contract);
  assert.equal(result.ok,false);
  assert.match(result.errors.join("\n"),/host-reference-only/);
  assert.match(result.errors.join("\n"),/compilerProduced/);
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
