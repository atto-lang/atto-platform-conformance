#!/usr/bin/env node
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {verifyBuildEvidence,validatePins} from "../src/build-evidence.mjs";
try {
  if(process.argv.length!==4)throw Error("usage: verify-build.mjs java-build.json llvm-build.json");
  const pins=validatePins(JSON.parse(await readFile(fileURLToPath(new URL("../fixtures/compiler-pins.json",import.meta.url)))));
  const [java,llvm]=await Promise.all(process.argv.slice(2).map(x=>readFile(x,"utf8").then(JSON.parse)));
  if(java.backend!=="java"||llvm.backend!=="llvm")throw Error("paired build evidence has wrong backend order");
  const results=await Promise.all([verifyBuildEvidence(java,pins),verifyBuildEvidence(llvm,pins)]);
  console.log(JSON.stringify({status:"PINNED_PAIRED_BUILD_ARTIFACTS_VERIFIED",results,
    certifiesIndependentAttestation:false,certifiesReproducibility:false},null,2));
}catch(error){console.error("paired build evidence rejected:",error.message);process.exitCode=1;}
