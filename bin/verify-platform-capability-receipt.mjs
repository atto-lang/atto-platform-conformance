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
  "compiler-guest":[
    "abi-linked","compiler-produced","compiler-source-revision",
    "compiler-binary-digest","not-host-reference-only"
  ],
  "target-execution":["target-executed"],
  "physical-hardware":["physical-hardware-evidence"]
});
const expectedNonEvidence=Object.freeze([
  "zero-step-workflow","queued-workflow","host-stub-for-compiler-guest",
  "declared-source-sha-without-binary-provenance","documentation-only-claim"
]);
function sameExactKeys(object,expected) {
  if(!object||typeof object!=="object"||Array.isArray(object))return false;
  const actual=Object.keys(object).sort(),required=[...expected].sort();
  return actual.length===required.length&&
    actual.every((value,index)=>value===required[index]);
}
function sameStringSequence(actual,expected) {
  return Array.isArray(actual)&&actual.length===expected.length&&
    actual.every((v,i)=>typeof v==="string"&&v===expected[i]);
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
    const info=contract.platforms?.[name];
    if(info?.repository!==repo)
      errors.push(`contract repository mismatch for ${name}`);
    if(!sameExactKeys(info,["repository","targetClass"])||
       info?.targetClass!==expectedTargetClasses[name])
      errors.push(`contract target class or platform fields mismatch for ${name}`);
  }
  if(!sameExactKeys(contract.promotionRules,Object.keys(expectedPromotionRules)))
    errors.push("contract promotionRules keys do not match v1");
  else for(const [stage,rules] of Object.entries(expectedPromotionRules)) {
    if(!sameStringSequence(contract.promotionRules[stage],rules))
      errors.push(`contract promotionRules mismatch for ${stage}`);
  }
  if(!sameStringSequence(contract.nonEvidence,expectedNonEvidence))
    errors.push("contract nonEvidence does not match v1");
  if(!sameExactKeys(contract,[
    "schemaVersion","contract","stageOrder","platforms","promotionRules","nonEvidence"
  ]))
    errors.push("contract top-level fields do not match v1");
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
  } catch {
    // Raw JSON parser and filesystem exceptions routinely embed absolute
    // private checkout paths, fragments of input, and untrusted metadata.
    // CI logs are public to more principals than local runner files.
    console.error("platform receipt: INVALID_OR_UNREADABLE_JSON_INPUT");
    process.exit(1);
  }
}
