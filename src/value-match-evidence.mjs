import {readFile,mkdtemp,mkdir,writeFile,rm,lstat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {join,isAbsolute,resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";

const root=resolve(fileURLToPath(new URL("../fixtures/value-match/v1/",import.meta.url)));
const BACKENDS=["java-graalvm","llvm","wasm","browser-worker"];
const FIXTURES=[
 ["value-option-braced.ores","accept","d06e10a5c50d2794521ca0bdbc2aae11ab4e69ca","42:0"],
 ["value-vs-procedural.ores","accept","6e533b1204e2ae03098739e82fd6a0e729fb0866","142:42"],
 ["value-guard-over-end.ores","accept","1f4514dc885c52a77c1f6048d7cce50d232b50ed","42:0:0:2"],
 ["reject-nonexhaustive.ores","reject","a44aec379e32d18f502e098ab92bef3fc3375241",null],
 ["reject-mismatched-types.ores","reject","5640484a4c302032b208d5c498cd1d816e66ca00",null],
 ["reject-no-value.ores","reject","cfb364840df4303f40cc4a8898d5cbb2553d3b2b",null]
];
const DIAGNOSTICS={
 "reject-no-value.ores":/value match arms require exactly one/i,
 "reject-nonexhaustive.ores":/non-exhaustive match/i,
 "reject-mismatched-types.ores":/value match arm/i
};
const sha256=b=>createHash("sha256").update(b).digest("hex");
const gitBlob=b=>createHash("sha1").update("blob "+b.length+"\0").update(b).digest("hex");
const harness=[
 "pub fnc main(): void {",
 "  stdio.stdout.write(compute(41));",
 "  stdio.stdout.write(\":\");",
 "  stdio.stdout.write(compute(0));",
 "  stdio.stdout.write(\":\");",
 "  stdio.stdout.write(compute(-3));",
 "  stdio.stdout.write(\":\");",
 "  stdio.stdout.write(compute(1));",
 "  return;",
 "}"
].join("\n");
export function validateEvidenceCommand(argv){
 if(!Array.isArray(argv)||!argv.length||argv.some(x=>typeof x!=="string"||!x||x.includes("\0")))throw Error("invalid compiler argv");
 if(!isAbsolute(argv[0]))throw Error("compiler executable needs absolute path");
 if(argv.filter(x=>x==="{file}").length!==1||argv.some(x=>x!=="{file}"&&x.includes("{file}")))throw Error("one standalone {file} required");
 if(argv.some(x=>x.includes("{output}")||x.includes("{source}")))throw Error("unsupported command placeholder");
 return argv;
}
function validateManifest(m){
 if(!m||m.schemaVersion!==1||m.scope!=="value-match-expression-v1"||!Array.isArray(m.cases)||m.cases.length!==FIXTURES.length)throw Error("bad match manifest");
 const found=new Set();
 for(const c of m.cases){
  const canonical=FIXTURES.find(x=>x[0]===c?.file);
  if(!canonical||found.has(c.file)||c.id!==c.file.slice(0,-5)||c.expect!==canonical[1]||c.sourceGitBlobSha1!==canonical[2]||
     JSON.stringify(c.confirmedBackends)!=="[]"||JSON.stringify(c.pendingBackends)!==JSON.stringify(BACKENDS))throw Error("forged manifest case or backend claim");
  found.add(c.file);
 }
 if(m.evidence?.exactFixtureExecution!==false)throw Error("manifest execution claim requires independent attestation");
}
function hasCompilerErrorDiagnostic(p){
 // Error lines from stderr, not guest stdout or source echoed in a log.
 return (p.stderr||"").split(/\r?\n/).some(line=>
  /^\s*(?:error\b|oreslang:\s*(?!warning\b|info\b|notice\b)|oreslang\s+(?:parse|type)\s+error\b)/i.test(line));
}
function processFailure(p){
 if(p?.error)return p.error.code==="ETIMEDOUT"?"TIMEOUT":"SPAWN_ERROR";
 if(p?.signal)return "SIGNALED";
 if(!Number.isInteger(p?.status)||p.status<0)return "INVALID_EXIT";
 if(/\b(?:panic|segmentation fault|uncaught exception|fatal error|stack trace|stacktrace|assertion failed|aborted|core dumped)\b/i.test((p.stderr||"")+"\n"+(p.stdout||"")))return "CRASH";
 return null;
}
function invoke(spawn,argv,file,timeoutMs){
 return spawn(argv[0],argv.slice(1).map(x=>x==="{file}"?file:x),{encoding:"utf8",timeout:timeoutMs,maxBuffer:1048576,shell:false,windowsHide:true});
}
async function sourceUnchanged(path,originalBytes){
 // Detect deleted, swapped, symlinked, truncated, or rewritten staged input.
 // Re-reading bounded by its expected byte length prevents an oversized
 // compiler-created file from exhausting test-runner memory.
 try{
  const metadata=await lstat(path);
  if(!metadata.isFile()||metadata.size!==originalBytes.length)return false;
  return (await readFile(path)).equals(originalBytes);
 }catch{return false}
}
function correctRejection(p,name){
 if(p.status===0||!hasCompilerErrorDiagnostic(p)||p.stdout)return false;
 // Require a specific, stderr-emitted semantic error. Generic compiler
 // failures or quoted guest output must not count as correct rejection.
 return p.stderr.split(/\r?\n/).some(line=>
  /^\s*(?:error\b|oreslang:\s*(?!warning\b|info\b|notice\b)|oreslang\s+(?:parse|type)\s+error\b)/i.test(line)&&DIAGNOSTICS[name].test(line));
}
/**
 * Requires a real executable compiler/checker and runtime command (never shell).
 * Returned evidence is UNATTESTED: sourceSha is caller supplied, and this function
 * never changes confirmedBackends or makes backend parity claims.
 */
export async function runValueMatchEvidence({backend,sourceSha,checkArgv,runArgv,timeoutMs=15000,spawn=spawnSync}={}){
 if(!BACKENDS.includes(backend))throw Error("unknown backend");
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw Error("invalid timeout");
 const manifest=JSON.parse(await readFile(join(root,"manifest.json"),"utf8"));
 validateManifest(manifest);
 const files=[];
 for(const [name,expect,sha,stdout] of FIXTURES){
  const bytes=await readFile(join(root,name));
  if(gitBlob(bytes)!==sha)throw Error("mutated fixture: "+name);
  files.push({name,expect,sha,stdout,bytes,sha256:sha256(bytes)});
 }
 const configured=Boolean(checkArgv&&runArgv);
 const info={backend,declaredSourceSha:sourceSha||null,configured,attested:false,
  simulated:spawn!==spawnSync,confirmedBackends:[],
  provenanceNote:"Caller supplied source revision; executable provenance is not independently attested."};
 if(!configured)return {...info,ok:false,checksPassed:0,runsPassed:0,results:files.map(f=>({id:f.name.slice(0,-5),status:"UNCONFIGURED",fixtureGitBlobSha1:f.sha}))};
 validateEvidenceCommand(checkArgv);validateEvidenceCommand(runArgv);
 if(typeof sourceSha!=="string"||!/^[0-9a-f]{40}$/.test(sourceSha))throw Error("exact source SHA is required");
 const executableSha256=[sha256(await readFile(checkArgv[0])),sha256(await readFile(runArgv[0]))];
 let dir;const results=[];let checksPassed=0,runsPassed=0;
 try{
  dir=await mkdtemp(join(tmpdir(),"ores-vmatch-"));
  const checkDir=join(dir,"check");
  const runDir=join(dir,"run");
  await mkdir(checkDir,{mode:0o700});
  await mkdir(runDir,{mode:0o700});
  for(const f of files){
   // A checker could mutate its own staged file, even though the canonical
   // repo fixture is untouched. Give checking and runtime separate fresh
   // snapshots and reject in-place modification of either one.
   const checkPath=join(checkDir,f.name);
   await writeFile(checkPath,f.bytes,{mode:0o600,flag:"wx"});
   const checked=invoke(spawn,checkArgv,checkPath,timeoutMs);
   const error=processFailure(checked);
   const checkUnchanged=await sourceUnchanged(checkPath,f.bytes);
   const admitted=!error&&checkUnchanged&&(f.expect==="accept"?
     checked.status===0&&!hasCompilerErrorDiagnostic(checked) : correctRejection(checked,f.name));
   if(!admitted){results.push({id:f.name.slice(0,-5),status:checkUnchanged?(error||"CHECK_MISMATCH"):"SOURCE_MUTATED",
    stage:"compile",fixtureGitBlobSha1:f.sha,fixtureSha256:f.sha256});continue}
   checksPassed++;
   if(f.expect==="reject"){results.push({id:f.name.slice(0,-5),status:"VERIFIED_REJECTION",stage:"compile",fixtureGitBlobSha1:f.sha,fixtureSha256:f.sha256});continue}
   let runPath=join(runDir,f.name),supplementalHarness=false;
   let runBytes=f.bytes;
   if(f.name==="value-guard-over-end.ores"){
    runPath=join(runDir,"guard-with-entrypoint.ores");
    runBytes=Buffer.from(f.bytes.toString("utf8")+"\n"+harness+"\n","utf8");
    supplementalHarness=true;
   }
   await writeFile(runPath,runBytes,{mode:0o600,flag:"wx"});
   const executed=invoke(spawn,runArgv,runPath,timeoutMs);
   const runtimeError=processFailure(executed);
   const runUnchanged=await sourceUnchanged(runPath,runBytes);
   const output=executed.stdout||"";
   const exact=runUnchanged&&!runtimeError&&executed.status===0&&
    !hasCompilerErrorDiagnostic(executed)&&output===f.stdout;
   if(exact)runsPassed++;
   results.push({id:f.name.slice(0,-5),status:exact?"VERIFIED_OUTPUT":runUnchanged?(runtimeError||"OUTPUT_MISMATCH"):"SOURCE_MUTATED",
    stage:"runtime",fixtureGitBlobSha1:f.sha,fixtureSha256:f.sha256,supplementalHarness,
    expectedStdout:f.stdout,observedStdoutSha256:sha256(Buffer.from(output,"utf8"))});
  }
 }finally{if(dir)await rm(dir,{recursive:true,force:true})}
 return {...info,ok:checksPassed===6&&runsPassed===3&&results.length===6,
  executableSha256,checksPassed,runsPassed,results};
}
