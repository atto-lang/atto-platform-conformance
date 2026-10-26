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
  return errors;
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
  if(receipt.schema!=="oreslang.platform-capability/1")
    fail("schema must be oreslang.platform-capability/1");

  // A parsed JSON object still has Object.prototype. Indexing a normal
  // registry with "__proto__", "constructor" or "toString" returns inherited
  // values, which could incorrectly certify an unknown platform when the
  // receipt omits its repository. Resolve ONLY an own, explicitly registered
  // string key, never a property inherited from the prototype chain.
  const platformName=receipt.platform;
  const knownPlatform=typeof platformName==="string" &&
    Object.hasOwn(expectedRepositories,platformName) &&
    Object.hasOwn(contract.platforms,platformName);
  if(!knownPlatform) fail("unknown platform");
  else if(receipt.repository!==contract.platforms[platformName].repository)
    fail("repository does not match registered platform repository");

  if(typeof receipt.sourceCommit!=="string" || !hex40.test(receipt.sourceCommit))
    fail("sourceCommit must be 40 lowercase hexadecimal digits");

  const stageIndex=expectedStages.indexOf(receipt.stage);
  if(stageIndex<0) fail("unknown promotion stage");

  const e=receipt.evidence;
  if(!e || typeof e!=="object" || Array.isArray(e)) {
    fail("evidence must be an object");
    return {ok:false,errors};
  }

  if(e.exactHead!==true) fail("exactHead must be true");
  // The step count is an observed *count*, not an arbitrary-magnitude
  // integer. Numbers beyond MAX_SAFE_INTEGER lose integer precision.
  if(!Number.isSafeInteger(e.executedSteps) || e.executedSteps<=0)
    fail("executedSteps must be a positive safe integer; zero-step runs are not evidence");
  if(typeof e.targetArtifactSha256!=="string" || !hex64.test(e.targetArtifactSha256))
    fail("targetArtifactSha256 must be 64 lowercase hexadecimal digits");

  if(stageIndex>=1 && e.abiLinked!==true)
    fail("abi-link and higher stages require abiLinked=true");

  if(stageIndex>=2) {
    if(e.hostReferenceOnly!==false)
      fail("compiler-guest and higher stages forbid host-reference-only evidence; require hostReferenceOnly=false");
    if(e.compilerProduced!==true)
      fail("compiler-guest and higher stages require compilerProduced=true");
    if(typeof e.compilerSourceCommit!=="string" || !hex40.test(e.compilerSourceCommit))
      fail("compiler-guest and higher stages require compilerSourceCommit");
    if(typeof e.compilerBinarySha256!=="string" || !hex64.test(e.compilerBinarySha256))
      fail("compiler-guest and higher stages require compilerBinarySha256");
  }

  if(stageIndex>=3 && e.targetExecuted!==true)
    fail("target-execution and higher stages require targetExecuted=true");

  if(stageIndex>=4 && e.physicalHardware!==true)
    fail("physical-hardware stage requires physicalHardware=true");

  // A missing conclusion must not be treated as a successful run.
  // This remains a schema-level assertion, not an independent GitHub check.
  if(e.workflowConclusion!=="success")
    fail("workflowConclusion must be success");

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
