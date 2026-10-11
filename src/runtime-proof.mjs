import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {validateCommand,loadManifest} from "./harness.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const SHA40=/^[a-f0-9]{40}$/;
const SHA64=/^[a-f0-9]{64}$/;
const INTEGER=/^(0|-?[1-9][0-9]*)$/;
const I64MIN=-(1n<<63n),I64MAX=(1n<<63n)-1n;

export function canonicalI64(s){
 if(typeof s!=="string" || !INTEGER.test(s))throw Error("noncanonical signed i64");
 const n=BigInt(s);
 if(n<I64MIN || n>I64MAX)throw Error("signed i64 out of range");
 return s;
}
export async function loadRuntimeCases(){
 const m=JSON.parse(await readFile(resolve(root,"fixtures/runtime-manifest.json"),"utf8"));
 if(m?.schemaVersion!==1 || !Array.isArray(m.cases) || m.cases.length===0)
   throw Error("runtime manifest missing/invalid");
 const compiler=await loadManifest();
 const source=new Map(compiler.cases.filter(x=>x.expect==="accept" && ["java","llvm"].every(b=>x.backends.includes(b))).map(x=>[x.id,x.file]));
 const ids=new Set(),result=[];
 for(const c of m.cases){
  if(typeof c.id!=="string" || !/^[a-z0-9-]+$/.test(c.id) || ids.has(c.id) ||
     c.file!==source.get(c.id) || c.type!=="i64")throw Error("runtime fixture absent from shared compiler manifest/duplicate");
  canonicalI64(c.expect);
  const bytes=await readFile(resolve(root,"fixtures",c.file));
  ids.add(c.id);
  result.push({...c,fixtureSha256:createHash("sha256").update(bytes).digest("hex")});
 }
 return result;
}
export async function runTypedSuite({backend,argv,sourceSha,spawn=spawnSync,timeoutMs=30000}={}){
 if(!["java","llvm"].includes(backend) || !SHA40.test(sourceSha || ""))
   throw Error("runtime backend and pinned source commit required");
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw Error("invalid runtime timeout");
 validateCommand(argv);
 const fixtures=await loadRuntimeCases();
 const binary=await readFile(argv[0]);
 const executableSha256=createHash("sha256").update(binary).digest("hex");
 const results=[];
 for(const c of fixtures){
  const args=argv.map(x=>x==="{file}"?resolve(root,"fixtures",c.file):x);
  const o=spawn(args[0],args.slice(1),{encoding:"utf8",cwd:root,timeout:timeoutMs,maxBuffer:1024*1024,windowsHide:true});
  const out=o.stdout||"",err=o.stderr||"";
  let status="MISMATCH",value=null;
  if(o.error)status=o.error.code==="ETIMEDOUT"?"TIMEOUT":"SPAWN_ERROR";
  else if(o.signal)status="SIGNALED";
  else if(o.status===0){
   // A single typed decimal line, not a lossy process exit code or log scraper.
   const match=/^(-?(?:0|[1-9][0-9]*))\r?\n$/.exec(out);
   if(match){
    try{value=canonicalI64(match[1]);if(value===c.expect)status="VERIFIED"}catch{}
   }
  }
  results.push({id:c.id,fixtureSha256:c.fixtureSha256,status,type:"i64",value,
   exitCode:o.status??null,signal:o.signal||null,stdout:out,stderr:err});
 }
 const verified=results.filter(x=>x.status==="VERIFIED").length;
 return {schemaVersion:1,backend,configured:true,declaredSourceSha:sourceSha,executableSha256,
   verified,failed:results.length-verified,skipped:0,ok:verified===fixtures.length,results,
   certifiesGeneralRuntimeParity:false};
}
export function verifyTypedRuntimeReports(java,llvm,cases,sourcePins,buildReports){
 if(!Array.isArray(cases)||!cases.length||!sourcePins||!buildReports)
   throw Error("missing independent runtime manifest/source pins/build artifacts");
 const expected=new Map();
 for(const c of cases){
  if(expected.has(c.id) || !/^[a-z0-9-]+$/.test(c.id) || !SHA64.test(c.fixtureSha256||"") || c.type!=="i64")
    throw Error("invalid pinned runtime case");
  canonicalI64(c.expect);expected.set(c.id,c);
 }
 for(const [backend,report] of [["java",java],["llvm",llvm]]){
  const artifact=buildReports[backend]?.artifacts?.find(x=>x.role==="runtime-runner");
  if(report?.schemaVersion!==1 || report.backend!==backend || report.configured!==true ||
    report.ok!==true || report.failed!==0 || report.skipped!==0 ||
    report.verified!==expected.size || !Array.isArray(report.results) || report.results.length!==expected.size ||
    report.declaredSourceSha!==sourcePins.backends[backend].sourceCommit ||
    !SHA64.test(report.executableSha256||"") || artifact?.sha256!==report.executableSha256 ||
    report.certifiesGeneralRuntimeParity!==false)
    throw Error(backend+" has incomplete/unbound typed runtime evidence");
  const seen=new Set();
  for(const item of report.results){
   const c=expected.get(item.id);
   if(!c || seen.has(item.id) || item.status!=="VERIFIED" || item.type!=="i64" ||
      item.fixtureSha256!==c.fixtureSha256 || item.exitCode!==0 || item.signal!==null ||
      item.value!==c.expect || typeof item.stdout!=="string" || !/^(-?(?:0|[1-9][0-9]*))\r?\n$/.test(item.stdout) ||
      item.stdout.trim()!==c.expect)
    throw Error(backend+" typed runtime fixture mismatch: "+item.id);
   canonicalI64(item.value);seen.add(item.id);
  }
 }
 return {status:"PAIRED_TYPED_I64_RUNTIME_PASS",cases:expected.size,
   certifiesGeneralRuntimeParity:false,certifiesActorParity:false,
   certifiesIndependentBuildAttestation:false};
}
