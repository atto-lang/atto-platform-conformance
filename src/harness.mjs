import {readFile,lstat,realpath} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve,dirname,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
export const COMPILER_BACKENDS=Object.freeze(["java","llvm","net","wasm","forge"]);
const SUPPORTED_BACKENDS=new Set([...COMPILER_BACKENDS,"browser"]);
function validSha(s){return typeof s==="string" && /^[0-9a-f]{40}$/.test(s)}
function validDiagnosticSymbol(s){
 return typeof s==="string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(s);
}
/** Literal unresolved-name diagnostic only: no regex-injected manifest or source echo. */
export function isExpectedCompilerDiagnostic(output,symbol){
 if(typeof output!=="string"||!validDiagnosticSymbol(symbol))return false;
 // Admit only the *primary* unresolved-name diagnostic immediately after
 // severity; later notes, hints and unrelated errors are not independent proof.
 const patterns=[
  /^(?:use\s+of\s+)?(?:unresolved|undefined|undeclared|unknown|unbound)\s+(?:(?:identifier|name|symbol|variable|reference|value)\s+)?["'\x60]?([A-Za-z_][A-Za-z0-9_]*)/i,
  /^(?:cannot find|cannot resolve)\s+(?:(?:identifier|name|symbol|variable|reference|value)\s+)?["'\x60]?([A-Za-z_][A-Za-z0-9_]*)/i,
  /^["'\x60]?([A-Za-z_][A-Za-z0-9_]*)["'\x60]?\s+(?:is\s+)?(?:not found|not defined|undefined|undeclared|unresolved|unknown|unbound)\b/i
 ];
 for(const line of output.split(/\r?\n/)){
  const severity=/^(?:.*?:\d+(?::\d+)?:\s*)?error(?:\[[A-Za-z0-9_-]{1,20}\])?\s*:/i.exec(line);
  if(!severity)continue;
  const detail=line.slice(severity[0].length).trimStart();
  for(const pattern of patterns){
   const match=pattern.exec(detail);
   if(match)return match[1]===symbol;
  }
 }

 return false;
}
export function hasCompilerErrorSeverity(output){
 // Accept fixtures must not be promoted when a compiler reports an error
 // yet exits zero. Match standard diagnostic severity, not arbitrary prose.
 return output.split(/\r?\n/).some(line=>
  /^\s*(?:.*?:\d+(?::\d+)?:\s*)?(?:fatal\s+)?error(?:\[[A-Za-z0-9_-]{1,20}\])?\s*:/i.test(line));
}
export function validateCommand(argv){
 if(!Array.isArray(argv)||argv.length===0||argv.some(x=>typeof x!=="string"||!x||x.includes("\0")))throw Error("compiler argv must be nonempty strings without NUL");
 if(!isAbsolute(argv[0]))throw Error("compiler executable path must be absolute (no PATH lookup)");
 if(argv.filter(x=>x.includes("{file}")).length!==1 || argv.some(x=>x.includes("{file}")&&x!=="{file}"))
  throw Error("exactly one standalone {file} positional token is required");
 return argv;
}
export function validateManifestSchema(manifest){
 if(!manifest||typeof manifest!=="object"||Array.isArray(manifest)||
    manifest.schemaVersion!==1||!Array.isArray(manifest.cases)||
    manifest.cases.length===0||manifest.cases.length>1000)
   throw Error("invalid manifest schema");
 const ids=new Set(),files=new Set(),coverage=new Map();
 for(const item of manifest.cases){
  if(!item||typeof item!=="object"||Array.isArray(item)||
     typeof item.id!=="string"||item.id.length>128||
     !/^[a-z0-9-]+$/.test(item.id)||ids.has(item.id))
   throw Error("invalid/duplicate test id");
  ids.add(item.id);
  if(typeof item.file!=="string"||item.file.length>128||
     !/^[-a-z0-9]+\.ores$/.test(item.file)||files.has(item.file))
   throw Error("invalid/duplicate fixture path");
  files.add(item.file);
  if(!["accept","reject"].includes(item.expect)||
     !Array.isArray(item.backends)||item.backends.length===0||
     item.backends.some(x=>!SUPPORTED_BACKENDS.has(x))||
     new Set(item.backends).size!==item.backends.length)
   throw Error("invalid fixture expectation/backends");
  if(item.expect==="reject"&&!validDiagnosticSymbol(item.diagnostic))
   throw Error("negative fixture must require a literal identifier diagnostic");
  if(item.expect==="accept"&&item.diagnostic!==undefined)
   throw Error("accept fixture may not declare a rejection diagnostic");
  for(const backend of item.backends){
   if(!coverage.has(backend))coverage.set(backend,new Set());
   coverage.get(backend).add(item.expect);
  }
 }
 // A passing compiler must be challenged with both valid and invalid source.
 // Missing target backends may not silently disappear from the test inventory.
 for(const backend of COMPILER_BACKENDS){
  const kinds=coverage.get(backend);
  if(!kinds?.has("accept")||!kinds.has("reject"))
   throw Error("missing positive/negative fixture coverage for "+backend);
 }
 for(const [backend,kinds] of coverage){
  if(!kinds.has("accept")||!kinds.has("reject"))
   throw Error("missing positive/negative fixture coverage for "+backend);
 }
 return manifest;
}
export async function assertRegularFixture(file){
 const stat=await lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink())
  throw Error("fixture must be a regular non-symlink file");
}
export async function loadManifest(){
 const manifestPath=resolve(root,"fixtures/manifest.json");
 await assertRegularFixture(manifestPath);
 const manifest=validateManifestSchema(JSON.parse(await readFile(manifestPath,"utf8")));
 for(const item of manifest.cases){
  const fixturePath=resolve(root,"fixtures",item.file);
  await assertRegularFixture(fixturePath);
 }
 return manifest;
}
async function snapshotExecutable(file){
 try{
  const pathStat=await lstat(file);
  const resolvedPath=await realpath(file);
  const targetStat=await lstat(resolvedPath);
  if(!targetStat.isFile())return null;
  const sha256=createHash("sha256").update(await readFile(resolvedPath)).digest("hex");
  return Object.freeze({
   sha256,resolvedPath,pathIsSymlink:pathStat.isSymbolicLink(),
   pathDev:pathStat.dev,pathIno:pathStat.ino,pathMode:pathStat.mode,
   targetDev:targetStat.dev,targetIno:targetStat.ino,targetMode:targetStat.mode,
   targetSize:targetStat.size
  });
 }catch{return null}
}
function sameExecutableSnapshot(a,b){
 return !!a&&!!b&&a.sha256===b.sha256&&a.resolvedPath===b.resolvedPath&&
  a.pathIsSymlink===b.pathIsSymlink&&a.pathDev===b.pathDev&&a.pathIno===b.pathIno&&
  a.pathMode===b.pathMode&&a.targetDev===b.targetDev&&a.targetIno===b.targetIno&&
  a.targetMode===b.targetMode&&a.targetSize===b.targetSize;
}
export async function runSuite({backend,argv,sourceSha,timeoutMs=10000,requireConfigured=false,spawn=spawnSync}={}){
 if(!SUPPORTED_BACKENDS.has(backend))throw Error("unknown backend");
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw Error("timeoutMs must be 100..120000");
 const manifest=await loadManifest();
 const relevant=manifest.cases.filter(x=>x.backends.includes(backend));
 if(!argv){
  return {backend,sourceSha:sourceSha||null,configured:false,verified:0,failed:0,
   skipped:relevant.length,ok:false,results:relevant.map(c=>({id:c.id,status:"UNCONFIGURED"}))};
 }
 validateCommand(argv);
 if(!validSha(sourceSha))throw Error("configured backend requires exact 40-character lowercase source commit SHA");
 const initialExecutable=await snapshotExecutable(argv[0]);
 const executableSha256=initialExecutable?.sha256||null;
 const results=[];
 for(const c of relevant){
  const fixturePath=resolve(root,"fixtures",c.file);
  await assertRegularFixture(fixturePath);
  const fixtureSha256=createHash("sha256").update(await readFile(fixturePath)).digest("hex");
  const executableBefore=await snapshotExecutable(argv[0]);
  const cmd=argv.map(x=>x==="{file}"?fixturePath:x);
  const output=spawn(cmd[0],cmd.slice(1),{encoding:"utf8",timeout:timeoutMs,cwd:root,maxBuffer:1024*1024,windowsHide:true});
  const executableAfter=await snapshotExecutable(argv[0]);
  let status;
  const combined=(output.stdout||"")+"\n"+(output.stderr||"");
  // The executable must remain the exact same path/target/file identity and bytes
  // across every invocation. This detects replacement, deletion and symlink
  // retargeting around a subprocess, but cannot eliminate the final exec TOCTOU.
  if(initialExecutable &&
     (!sameExecutableSnapshot(initialExecutable,executableBefore)||
      (executableBefore&&!sameExecutableSnapshot(executableBefore,executableAfter))))
   status="EXECUTABLE_CHANGED";
  else if(output.error)status=output.error.code==="ETIMEDOUT"?"TIMEOUT":"SPAWN_ERROR";
  else if(output.signal)status="SIGNALED";
  // A missing/invalid process exit code cannot be evidence of a compiler rejection.
  else if(!Number.isSafeInteger(output.status)||output.status<0)status="INVALID_EXIT_STATUS";
  // A successful-looking mock/wrapper still cannot certify an unhashable executable.
  else if(!initialExecutable||!executableBefore||!executableAfter)status="UNHASHABLE_EXECUTABLE";
  else if(c.expect==="accept")status=output.status===0 && !hasCompilerErrorSeverity(combined)?"VERIFIED":"MISMATCH";
  else {
   status=output.status!==0 && isExpectedCompilerDiagnostic(combined,c.diagnostic)
     ?"VERIFIED":"MISMATCH";
  }
  results.push({id:c.id,status,fixtureSha256,
    executableSha256Before:executableBefore?.sha256||null,
    executableSha256After:executableAfter?.sha256||null,
    executableResolvedPathBefore:executableBefore?.resolvedPath||null,
    executableResolvedPathAfter:executableAfter?.resolvedPath||null,
    exitCode:output.status,signal:output.signal||null,
    stdout:output.stdout||"",stderr:output.stderr||""});
 }
 const verified=results.filter(x=>x.status==="VERIFIED").length;
 const failed=results.filter(x=>x.status!=="VERIFIED").length;
 return {backend,declaredSourceSha:sourceSha,executableSha256,provenanceNote:"Source revision was supplied by caller; this harness does not attest that it produced the binary.",configured:true,verified,failed,skipped:0,ok:failed===0 && verified>0 &&
  relevant.some(x=>x.expect==="accept") && relevant.some(x=>x.expect==="reject"),results};
}
