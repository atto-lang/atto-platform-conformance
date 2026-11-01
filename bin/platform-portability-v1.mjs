#!/usr/bin/env node
// Source-local inventory is NOT executed guest evidence. This command is a
// deliberately fail-closed staging gate until exact-head native receipts and
// independent runner/artifact authentication exist.
import {loadAndCheckCorpus,pendingMatrix} from "../src/platform-portability-v1.mjs";

try {
  const argv=process.argv.slice(2);
  if(argv.length>1 || (argv.length===1 && argv[0]!=="--require-executed")){
    throw Error("usage: node bin/platform-portability-v1.mjs [--require-executed]");
  }
  const result=pendingMatrix(await loadAndCheckCorpus());
  console.log(JSON.stringify(result,null,2));
  if(argv.includes("--require-executed")){
    console.error("NOT_EXECUTED: compiler guest/target parity cannot be certified from source fixtures or host reference tests");
    process.exitCode=3;
  }
}catch(error){
  console.error("PLATFORM_PORTABILITY_ADMISSION_REJECTED: "+(error?.message||String(error)));
  process.exitCode=2;
}
