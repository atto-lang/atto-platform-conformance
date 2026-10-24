#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const defaultContract=path.resolve(here,"../contracts/platform-capabilities-v1.json");

const hex40=/^[0-9a-f]{40}$/;
const hex64=/^[0-9a-f]{64}$/;

export function verifyPlatformCapabilityReceipt(receipt, contract) {
  const errors=[];
  const fail=(message)=>errors.push(message);
  if(!receipt || typeof receipt!=="object" || Array.isArray(receipt)) {
    return {ok:false,errors:["receipt must be an object"]};
  }
  if(!contract || contract.contract!=="oreslang.platform-capability/1")
    return {ok:false,errors:["unsupported or missing contract"]};

  if(receipt.schema!=="oreslang.platform-capability/1")
    fail("schema must be oreslang.platform-capability/1");

  const platform=contract.platforms?.[receipt.platform];
  if(!platform) fail("unknown platform");
  else if(receipt.repository!==platform.repository)
    fail("repository does not match registered platform repository");

  if(typeof receipt.sourceCommit!=="string" || !hex40.test(receipt.sourceCommit))
    fail("sourceCommit must be 40 lowercase hexadecimal digits");

  const stages=contract.stageOrder || [];
  const stageIndex=stages.indexOf(receipt.stage);
  if(stageIndex<0) fail("unknown promotion stage");

  const e=receipt.evidence;
  if(!e || typeof e!=="object" || Array.isArray(e)) {
    fail("evidence must be an object");
    return {ok:false,errors};
  }

  if(e.exactHead!==true) fail("exactHead must be true");
  if(!Number.isInteger(e.executedSteps) || e.executedSteps<=0)
    fail("executedSteps must be a positive integer; zero-step runs are not evidence");
  if(typeof e.targetArtifactSha256!=="string" || !hex64.test(e.targetArtifactSha256))
    fail("targetArtifactSha256 must be 64 lowercase hexadecimal digits");

  if(stageIndex>=1 && e.abiLinked!==true)
    fail("abi-link and higher stages require abiLinked=true");

  if(stageIndex>=2) {
    if(e.hostReferenceOnly===true)
      fail("host-reference-only evidence cannot promote to compiler-guest");
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

  if(e.workflowConclusion && e.workflowConclusion!=="success")
    fail("workflowConclusion must be success when supplied");

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
