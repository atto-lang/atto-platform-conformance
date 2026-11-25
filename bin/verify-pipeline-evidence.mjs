#!/usr/bin/env node
/* Bounded offline conformance evidence checker. The caller/CI runner owns
 * provenance: these JSON objects are not signed runtime attestations. */
import {readFile,stat} from "node:fs/promises";
import {verifyPipelineTrace,verifyNativeGuestSummary} from "../src/pipeline-runtime-evidence.mjs";
const [mode,path,...extra]=process.argv.slice(2);
if(extra.length||!["--trace","--native-summary"].includes(mode)||!path){
 console.error("usage: verify-pipeline-evidence.mjs (--trace|--native-summary) file.json");
 process.exitCode=2;
}else{
 try{
  const st=await stat(path);
  if(!st.isFile()||st.size>262144||st.size<2)throw Error("evidence file size/type rejected");
  const value=JSON.parse(await readFile(path,"utf8"));
  const result=mode==="--trace"?verifyPipelineTrace(value):verifyNativeGuestSummary(value);
  if(!result.ok)throw Error(result.errors.join("; "));
  console.log(JSON.stringify({ok:true,mode,result}));
 }catch(e){
  console.error("rejected pipeline evidence:",e.message);
  process.exitCode=1;
 }
}
