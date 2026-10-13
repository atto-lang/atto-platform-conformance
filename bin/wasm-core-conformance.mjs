#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
const seen=new Set();
const options=Object.fromEntries(process.argv.slice(2).map(x=>{
 const m=/^--(wasm|manifest|browser-module|expected-i64)=(.+)$/.exec(x);
 if(!m)throw Error("unexpected wasm-core conformance argument: "+x);
 if(seen.has(m[1]))throw Error("duplicate wasm-core conformance argument: "+m[1]);
 seen.add(m[1]);
 return [m[1],m[2]];
}));
for(const key of ["wasm","manifest","browser-module"])
 if(!isAbsolute(options[key]||""))throw Error(key+" must be an absolute path");
const rawExpected=options["expected-i64"]||"";
if(rawExpected.length>20||!/^(?:0|-?[1-9][0-9]*)$/.test(rawExpected)||
   BigInt(rawExpected)<-(1n<<63n)||BigInt(rawExpected)>(1n<<63n)-1n)
 throw Error("expected-i64 must be a canonical signed 64-bit integer");
const child=fileURLToPath(new URL("../src/wasm-guest-child.mjs",import.meta.url));
const run=spawnSync(process.execPath,[child,options.wasm,options.manifest,options["browser-module"],options["expected-i64"]],{
 timeout:5000,encoding:"utf8",maxBuffer:65536,windowsHide:true
});
if(run.error||run.signal||run.status!==0){
 console.error(JSON.stringify({ok:false,reason:run.error?.code||run.signal||"guest mismatch",
  stderr:(run.stderr||"").slice(0,3000)}));
 process.exitCode=1;
}else{
 try{const report=JSON.parse(run.stdout);if(report.ok!==true)throw Error("invalid report");
 console.log(JSON.stringify(report,null,2))}
 catch(error){console.error(error.message);process.exitCode=1}
}
