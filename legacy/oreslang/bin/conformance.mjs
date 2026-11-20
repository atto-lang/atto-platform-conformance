#!/usr/bin/env node
import {runSuite} from "../src/harness.mjs";
try{
 const args={};
 for(const x of process.argv.slice(2)){
  const m=x==="--require"?[x,"require","true"]:/^--(backend|argv|source-sha|timeout-ms)=(.+)$/.exec(x);
  if(!m)throw Error("unexpected argument: "+x);
  if(Object.hasOwn(args,m[1]))throw Error("duplicate conformance argument: "+m[1]);
  args[m[1]]=m[2];
 }
 const argv=args.argv?JSON.parse(args.argv):undefined;
 const result=await runSuite({backend:args.backend||"java",argv,sourceSha:args["source-sha"],
   timeoutMs:args["timeout-ms"]?Number(args["timeout-ms"]):10000,requireConfigured:args.require==="true"});
 console.log(JSON.stringify(result,null,2));
 if(!result.ok || !result.configured)process.exitCode= result.ok?3:1;
}catch(e){console.error(e.stack||e.message);process.exitCode=2}
