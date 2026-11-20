#!/usr/bin/env node
import {runValueMatchEvidence} from "../src/value-match-evidence.mjs";

function args(argv){
 const result={};
 for(const arg of argv){
  const m=/^--(backend|source-sha|check-argv|run-argv|timeout-ms)=(.+)$/.exec(arg);
  if(!m)throw Error("unknown or empty CLI argument: "+arg);
  if(Object.hasOwn(result,m[1]))throw Error("duplicate CLI argument: "+m[1]);
  result[m[1]]=m[2];
 }
 if(!result.backend||!result["source-sha"])throw Error("backend and exact source-sha are required");
 for(const key of ["check-argv","run-argv"])if(!result[key])throw Error(key+" is required");
 const parsed={};
 for(const key of ["check-argv","run-argv"]){
  try{parsed[key]=JSON.parse(result[key])}catch{throw Error("invalid JSON for "+key)}
 }
 return {backend:result.backend,sourceSha:result["source-sha"],
  checkArgv:parsed["check-argv"],runArgv:parsed["run-argv"],
  timeoutMs:result["timeout-ms"]===undefined?15000:Number(result["timeout-ms"])};
}
try {
 const result=await runValueMatchEvidence(args(process.argv.slice(2)));
 process.stdout.write(JSON.stringify(result,null,2)+"\n");
 process.exitCode=result.ok?0:1;
}catch(error){
 process.stderr.write("value match evidence: "+(error?.message||String(error))+"\n");
 process.exitCode=2;
}
