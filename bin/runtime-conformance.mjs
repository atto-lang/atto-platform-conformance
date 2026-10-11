#!/usr/bin/env node
import {runTypedSuite} from "../src/runtime-proof.mjs";
try {
 const args=Object.fromEntries(process.argv.slice(2).map(x=>{
  const m=/^--(backend|argv|source-sha)=(.+)$/.exec(x);
  if(!m)throw Error("unexpected argument "+x);
  return [m[1],m[2]];
 }));
 const report=await runTypedSuite({backend:args.backend,argv:JSON.parse(args.argv),sourceSha:args["source-sha"]});
 console.log(JSON.stringify(report,null,2));
 if(!report.ok)process.exitCode=1;
}catch(e){console.error("typed runtime execution failed:",e.stack||e.message);process.exitCode=2;}
