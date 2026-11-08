#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const defaultContract=path.resolve(here,"../contracts/platform-capabilities-v1.json");

const hex40=/^[0-9a-f]{40}$/;
const hex64=/^[0-9a-f]{64}$/;
const expectedStages=Object.freeze([
  "host-reference",
  "abi-link",
  "compiler-guest",
  "target-execution",
  "physical-hardware"
]);
const expectedRepositories=Object.freeze({
  mobile:"ores-truffle-oreslang/oreslang-platform.mobile",
  desktop:"ores-truffle-oreslang/oreslang-platform.desktop",
  embedded:"ores-truffle-oreslang/oreslang-platform.embedded",
  iot:"ores-truffle-oreslang/oreslang-platform.iot",
  fpga:"ores-truffle-oreslang/oreslang-platform.fpga",
  asic:"ores-truffle-oreslang/oreslang-platform.asic"
});

const expectedTargetClasses=Object.freeze({
  mobile:"mobile-native",
  desktop:"desktop-native",
  embedded:"freestanding-mcu",
  iot:"iot-gateway",
  fpga:"fpga",
  asic:"asic"
});
const expectedPromotionRules=Object.freeze({
  all:["exact-head","executed-steps","target-artifact-digest"],
  "abi-link":["abi-linked"],
  "compiler-guest":["abi-linked","compiler-produced","compiler-source-revision",
    "compiler-binary-digest","not-host-reference-only"],
  "target-execution":["target-executed"],
  "physical-hardware":["physical-hardware-evidence"]
});
const expectedNonEvidence=Object.freeze([
  "zero-step-workflow",
  "queued-workflow",
  "host-stub-for-compiler-guest",
  "declared-source-sha-without-binary-provenance",
  "documentation-only-claim"
]);
function sameRegistryKeys(actual,expected) {
  if(!actual || typeof actual!=="object" || Array.isArray(actual)) return false;
  const keys=Object.keys(actual).sort();
  const wanted=Object.keys(expected).sort();
  return keys.length===wanted.length && keys.every((key,index)=>key===wanted[index]);
}
function sameSet(actual,expected) {
  return Array.isArray(actual) &&
    actual.length===expected.length &&
    new Set(actual).size===expected.length &&
    expected.every((member)=>actual.includes(member));
}

function validateContractV1(contract) {
  const errors=[];
  if(!contract || contract.schemaVersion!==1 ||
     contract.contract!=="oreslang.platform-capability/1")
    return ["unsupported or missing contract"];
  if(!Array.isArray(contract.stageOrder) ||
     contract.stageOrder.length!==expectedStages.length ||
     contract.stageOrder.some((value,index)=>value!==expectedStages[index]))
    errors.push("contract stageOrder does not match v1");
  const keys=Object.keys(contract.platforms||{}).sort();
  const expectedKeys=Object.keys(expectedRepositories).sort();
  if(keys.length!==expectedKeys.length ||
     keys.some((value,index)=>value!==expectedKeys[index]))
    errors.push("contract platform registry does not match v1");
  for(const [name,repo] of Object.entries(expectedRepositories)) {
    if(contract.platforms?.[name]?.repository!==repo)
      errors.push(`contract repository mismatch for ${name}`);
  }
  for(const name of Object.keys(expectedTargetClasses)) {
    if(contract.platforms?.[name]?.targetClass!==expectedTargetClasses[name])
      errors.push("contract targetClass mismatch for "+name);
  }
  // Hardcoded verifier logic does not make forged published policy metadata safe.
  // v1 must also bind the stage requirements and the non-evidence taxonomy.
  if(!sameRegistryKeys(contract.promotionRules,expectedPromotionRules))
    errors.push("contract promotionRules registry does not match v1");
  for(const [stage,members] of Object.entries(expectedPromotionRules)) {
    if(!sameSet(contract.promotionRules?.[stage],members))
      errors.push("contract promotionRules mismatch for "+stage);
  }
  if(!sameSet(contract.nonEvidence,expectedNonEvidence))
    errors.push("contract nonEvidence inventory does not match v1");
  return errors;
}

// A required proof property must be an own DATA property. Reading an accessor
// executes caller-controlled JavaScript and can fabricate a transient value.
// The CLI uses JSON.parse, but this exported verifier also accepts JS objects.
function ownData(value,key) {
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  return descriptor && Object.hasOwn(descriptor,"value") ? descriptor.value : undefined;
}

export function verifyPlatformCapabilityReceipt(receipt, contract) {
  const contractProblems=validateContractV1(contract);
  if(contractProblems.length)
    return {ok:false,errors:contractProblems};
  const errors=[];
  const fail=(message)=>errors.push(message);
  if(!receipt || typeof receipt!=="object" || Array.isArray(receipt)) {
    return {ok:false,errors:["receipt must be an object"]};
  }
  if(ownData(receipt,"schema")!=="oreslang.platform-capability/1")
    fail("schema must be oreslang.platform-capability/1");

  // The supplied contract must already match the fixed v1 registry. Use the
  // canonical registry for a receipt lookup, not prototype-accessible fields.
  const platformName=ownData(receipt,"platform");
  const repo=typeof platformName==="string" &&
    Object.hasOwn(expectedRepositories,platformName)
    ? expectedRepositories[platformName] : undefined;
  if(!repo) fail("unknown platform");
  else if(ownData(receipt,"repository")!==repo)
    fail("repository does not match registered platform repository");

  const sourceCommit=ownData(receipt,"sourceCommit");
  if(typeof sourceCommit!=="string" || !hex40.test(sourceCommit))
    fail("sourceCommit must be 40 lowercase hexadecimal digits");

  const stageIndex=expectedStages.indexOf(ownData(receipt,"stage"));
  if(stageIndex<0) fail("unknown promotion stage");

  const e=ownData(receipt,"evidence");
  if(!e || typeof e!=="object" || Array.isArray(e)) {
    fail("evidence must be an object");
    return {ok:false,errors};
  }

  if(ownData(e,"exactHead")!==true) fail("exactHead must be true");
  const executedSteps=ownData(e,"executedSteps");
  if(!Number.isSafeInteger(executedSteps) || executedSteps<=0)
    fail("executedSteps must be a positive integer; zero-step runs are not evidence");
  const targetArtifactSha256=ownData(e,"targetArtifactSha256");
  if(typeof targetArtifactSha256!=="string" || !hex64.test(targetArtifactSha256))
    fail("targetArtifactSha256 must be 64 lowercase hexadecimal digits");

  if(stageIndex>=1 && ownData(e,"abiLinked")!==true)
    fail("abi-link and higher stages require abiLinked=true");

  if(stageIndex>=2) {
    if(ownData(e,"hostReferenceOnly")!==false)
      fail("compiler-guest and higher stages require hostReferenceOnly=false");
    if(ownData(e,"compilerProduced")!==true)
      fail("compiler-guest and higher stages require compilerProduced=true");
    const compilerSourceCommit=ownData(e,"compilerSourceCommit");
    if(typeof compilerSourceCommit!=="string" || !hex40.test(compilerSourceCommit))
      fail("compiler-guest and higher stages require compilerSourceCommit");
    const compilerBinarySha256=ownData(e,"compilerBinarySha256");
    if(typeof compilerBinarySha256!=="string" || !hex64.test(compilerBinarySha256))
      fail("compiler-guest and higher stages require compilerBinarySha256");
  }

  if(stageIndex>=3 && ownData(e,"targetExecuted")!==true)
    fail("target-execution and higher stages require targetExecuted=true");

  if(stageIndex>=4 && ownData(e,"physicalHardware")!==true)
    fail("physical-hardware stage requires physicalHardware=true");

  /* An omitted conclusion is not successful CI. This is still receipt-shape
   * validation: independent reviewers must authenticate the Actions job. */
  if(ownData(e,"workflowConclusion")!=="success")
    fail("workflowConclusion must be success, not missing or non-success");

  return {ok:errors.length===0,errors};
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename,"utf8"));
}

export function verifyFile(filename, contractFilename=defaultContract) {
  return verifyPlatformCapabilityReceipt(readJson(filename),readJson(contractFilename));
}

const invoked=process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url;
if(invoked) {
  const filename=process.argv[2];
  if(!filename) {
    console.error("usage: verify-platform-capability-receipt.mjs RECEIPT.json [CONTRACT.json]");
    process.exit(64);
  }
  try {
    const result=verifyFile(filename,process.argv[3] || defaultContract);
    if(!result.ok) {
      for(const error of result.errors) console.error(`platform receipt: ${error}`);
      process.exit(1);
    }
    console.log("platform capability receipt: PASS");
  } catch(error) {
    console.error(`platform receipt: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
