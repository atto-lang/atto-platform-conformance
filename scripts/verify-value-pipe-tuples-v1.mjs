#!/usr/bin/env node
// Executes an actual compiler/guest, not a source-only model. No backend CLI
// is auto-assumed and absent executable/configuration is a hard failure.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
const fixtureRoot=fileURLToPath(new URL("../contracts/value-pipe-tuples/v1/", import.meta.url));
const plan=JSON.parse(fs.readFileSync(path.join(fixtureRoot,"runner-contract.json"),"utf8"));
const getEnv=(key)=>{const v=process.env[key];if(!v?.trim())throw Error(key+" is required: no source-only or missing-tool PASS");return v.trim();};
const cmd=(key)=>{const val=JSON.parse(getEnv(key));if(!Array.isArray(val)||!val.length||val.some(x=>typeof x!=="string"||!x)||!val.some(x=>x.includes("{fixture}")))throw Error(key+" must be JSON argv containing {fixture}");return val;};
const run=cmd("ATTO_TUPLE_RUN_ARGV_JSON"),check=cmd("ATTO_TUPLE_CHECK_ARGV_JSON");
const backend=getEnv("ATTO_TUPLE_BACKEND"),compiler=getEnv("ATTO_TUPLE_COMPILER_ID"),binary=getEnv("ATTO_TUPLE_COMPILER_BINARY");
if(!plan.target_backends.includes(backend))throw Error("unlisted backend: "+backend);
if(!fs.statSync(binary).isFile())throw Error("compiler binary must be a regular file");
const binSha=createHash("sha256").update(fs.readFileSync(binary)).digest("hex");
const blobSha=(data)=>createHash("sha1").update(Buffer.concat([Buffer.from("blob "+data.length+String.fromCharCode(0)),data])).digest("hex");
function verifyFixture(item){
  if(typeof item.path!=="string"||!item.path.endsWith(".atto"))throw Error("invalid fixture path");
  const full=path.resolve(fixtureRoot,item.path);
  const relative=path.relative(fixtureRoot,full);
  if(!relative||relative===".."||relative.startsWith(".."+path.sep)||path.isAbsolute(relative)){
    throw Error("fixture escapes root");
  }
  const canonicalRoot=fs.realpathSync(fixtureRoot),canonicalFile=fs.realpathSync(full);
  if(!canonicalFile.startsWith(canonicalRoot+path.sep)){
    throw Error("symlinked fixture escapes canonical root");
  }
  const bytes=fs.readFileSync(canonicalFile),sha=blobSha(bytes);
  if(sha!==item.git_blob_sha1)throw Error("source fixture Git blob mismatch: "+item.path);
  return canonicalFile;
}
function invoke(argv,file){
  const expanded=argv.map(x=>x.replaceAll("{fixture}",file));
  const result=spawnSync(expanded[0],expanded.slice(1),{cwd:getEnv("ATTO_TUPLE_WORKDIR"),encoding:"utf8",shell:false,timeout:180000,maxBuffer:1048576});
  if(result.error)throw result.error;
  return {status:result.status,signal:result.signal,stdout:result.stdout||"",stderr:result.stderr||""};
}
const positive=invoke(run,verifyFixture(plan.positive));
if(positive.status!==0||positive.stdout!==plan.positive.stdout||positive.signal)throw Error("positive guest output/exit mismatch "+JSON.stringify(positive));
const negatives=[];
for(const item of plan.negative){
  const full=verifyFixture(item),res=invoke(check,full);
  const diagnostic=(res.stdout+"\n"+res.stderr).replaceAll(full,"<fixture>");
  if(!Number.isInteger(res.status)||res.status<=0||res.signal
      ||!new RegExp(item.diagnostic_family,"i").test(diagnostic)){
    throw Error("negative source not soundly rejected: "+item.path+" "+JSON.stringify(res));
  }
  negatives.push({fixture:item.path,status:res.status,diagnostic_family_matched:true});
}
process.stdout.write(JSON.stringify({schema:"atto.tuple-guest-evidence/v1",backend,compiler,binary_sha256:binSha,github_run_id:process.env.GITHUB_RUN_ID||null,github_run_attempt:process.env.GITHUB_RUN_ATTEMPT||null,positive_fixture:plan.positive.git_blob_sha1,positive_stdout:positive.stdout,negative_checks:negatives,real_executable_invoked:true,scope:"source guest + binary only; runner and AOT provenance separately required"},null,2)+"\n");
