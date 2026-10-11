#!/usr/bin/env node
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {loadRuntimeCases,verifyTypedRuntimeReports} from "../src/runtime-proof.mjs";
import {verifyBuildEvidence,validatePins} from "../src/build-evidence.mjs";
try{
 if(process.argv.length!==6)throw Error("usage: verify-runtime.mjs java-runtime.json llvm-runtime.json java-build.json llvm-build.json");
 const [java,llvm,jbuild,lbuild]=await Promise.all(process.argv.slice(2).map(x=>readFile(x,"utf8").then(JSON.parse)));
 const pins=validatePins(JSON.parse(await readFile(fileURLToPath(new URL("../fixtures/compiler-pins.json",import.meta.url)))));
 if(jbuild.backend!=="java"||lbuild.backend!=="llvm")throw Error("wrong build report order");
 await Promise.all([verifyBuildEvidence(jbuild,pins),verifyBuildEvidence(lbuild,pins)]);
 const cases=await loadRuntimeCases();
 const result=verifyTypedRuntimeReports(java,llvm,cases,pins,{java:jbuild,llvm:lbuild});
 console.log(JSON.stringify(result,null,2));
}catch(error){console.error("typed runtime evidence rejected:",error.message);process.exitCode=1;}
