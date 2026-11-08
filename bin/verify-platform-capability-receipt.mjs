#!/usr/bin/env node
import fs from "node:fs";
import { parseStrictJson } from "./strict-receipt-json.mjs";
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

/* v1 is a closed-world contract. Validate the policy itself, not merely the
 * receipts: otherwise an edited registry can misrepresent a promotion gate. */
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
  "compiler-guest":["abi-linked","compiler-produced","compiler-source-revision","compiler-binary-digest","not-host-reference-only"],
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
function sameOrderedStrings(value,expected) {
  return Array.isArray(value) && value.length===expected.length &&
    value.every((part,index)=>part===expected[index]);
}
function exactObjectKeys(value,expected) {
  if(!value || typeof value!=="object" || Array.isArray(value))
    return false;
  const actual=Object.keys(value).sort();
  const wanted=[...expected].sort();
  return sameOrderedStrings(actual,wanted);
}
const expectedContractKeys=Object.freeze([
  "schemaVersion","contract","stageOrder","platforms","promotionRules","nonEvidence"
]);
const expectedPlatformKeys=Object.freeze(["repository","targetClass"]);


function validateContractV1(contract) {
  const errors=[];
  if(!contract || contract.schemaVersion!==1 ||
     contract.contract!=="oreslang.platform-capability/1")
    return ["unsupported or missing contract"];
  if(!exactObjectKeys(contract,expectedContractKeys))
    errors.push("contract top-level field registry does not match v1");
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
    if(contract.platforms?.[name]?.targetClass!==expectedTargetClasses[name])
      errors.push(`contract targetClass mismatch for ${name}`);
    if(!exactObjectKeys(contract.platforms?.[name],expectedPlatformKeys))
      errors.push(`contract platform fields mismatch for ${name}`);
  }
  const rules=contract.promotionRules;
  const actualRuleKeys=rules && typeof rules==="object" && !Array.isArray(rules)
    ? Object.keys(rules).sort() : [];
  const expectedRuleKeys=Object.keys(expectedPromotionRules).sort();
  if(!sameOrderedStrings(actualRuleKeys,expectedRuleKeys)) {
    errors.push("contract promotionRules keys do not match v1");
  }
  for(const [stage,expected] of Object.entries(expectedPromotionRules)) {
    if(!sameOrderedStrings(rules?.[stage],expected))
      errors.push(`contract promotionRules mismatch for ${stage}`);
  }
  if(!sameOrderedStrings(contract.nonEvidence,expectedNonEvidence))
    errors.push("contract nonEvidence policy does not match v1");
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

  // Never resolve platform names through Object.prototype: '__proto__' or
  // 'constructor' must not bypass canonical repository binding.
  const platform=typeof receipt.platform === "string" &&
    Object.hasOwn(contract.platforms,receipt.platform)
    ? contract.platforms[receipt.platform] : undefined;
  if(!platform) fail("unknown platform");
  else if(receipt.repository!==platform.repository)
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
  if(!Number.isSafeInteger(e.executedSteps) || e.executedSteps<=0)
    fail("executedSteps must be a positive integer; zero-step runs are not evidence");
  if(typeof e.targetArtifactSha256!=="string" || !hex64.test(e.targetArtifactSha256))
    fail("targetArtifactSha256 must be 64 lowercase hexadecimal digits");

  if(stageIndex>=1 && e.abiLinked!==true)
    fail("abi-link and higher stages require abiLinked=true");

  if(stageIndex>=2) {
    if(e.hostReferenceOnly!==false)
      fail("compiler-guest and higher stages require hostReferenceOnly=false");
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

  /* An omitted conclusion is not successful CI. This is still receipt-shape
   * validation: independent reviewers must authenticate the Actions job. */
  if(e.workflowConclusion!=="success")
    fail("workflowConclusion must be success, not missing or non-success");

  return {ok:errors.length===0,errors};
}

function readJson(filename) {
  const bytes=fs.readFileSync(filename);
  if(bytes.length>1048576) throw Error(filename+" JSON exceeds size limit");
  const decoded=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
  return parseStrictJson(decoded,filename);
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
    console.log("platform capability receipt: PASS (SCHEMA_ONLY; NOT_AUTHENTICATED; independent CI/artifact review required)");
  } catch(error) {
    console.error(`platform receipt: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
