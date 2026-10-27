import {lstat,realpath,open,mkdtemp,writeFile,rm} from "node:fs/promises";
import {constants} from "node:fs";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {resolve,dirname,isAbsolute,join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
export const COMPILER_BACKENDS=Object.freeze(["java","llvm","net","wasm","forge","js"]);
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
  if(item.unsupportedBackends!==undefined){
   if(item.expect!=="accept"||!Array.isArray(item.unsupportedBackends)||
      new Set(item.unsupportedBackends).size!==item.unsupportedBackends.length||
      item.unsupportedBackends.some(x=>!item.backends.includes(x)))
    throw Error("invalid unsupported backend capability ledger");
  }
  if(item.expect==="reject"&&!validDiagnosticSymbol(item.diagnostic))
   throw Error("negative fixture must require a literal identifier diagnostic");
  if(item.expect==="accept"&&item.diagnostic!==undefined)
   throw Error("accept fixture may not declare a rejection diagnostic");
  for(const backend of item.backends){
   if(!coverage.has(backend))coverage.set(backend,new Set());
   const unsupportedPositive =
     item.expect==="accept" && item.unsupportedBackends?.includes(backend);
   coverage.get(backend).add(unsupportedPositive ? "unsupported" : item.expect);
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
const MAX_FIXTURE_BYTES=1024*1024;
const MAX_EXECUTABLE_BYTES=512*1024*1024;
function sameFileIdentity(a,b){
 return a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&
  a.size===b.size&&a.nlink===b.nlink&&
  a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
}
export async function assertRegularFixture(file){
 const stat=await lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
    stat.size<=0||stat.size>MAX_FIXTURE_BYTES)
  throw Error("fixture must be a nonempty bounded unique regular non-symlink file");
}
/** Read from a checked descriptor, with a fixed byte cap even if it grows.
 * Snapshot before launching compilers; this is evidence integrity, not a
 * security sandbox for arbitrary untrusted compiler executables.
 */
export async function readRegularFixtureBytes(file){
 const original=await lstat(file);
 await assertRegularFixture(file);
 const flags=constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0);
 const handle=await open(file,flags);
 try{
  const opened=await handle.stat();
  if(!opened.isFile()||!sameFileIdentity(original,opened))
   throw Error("fixture changed before descriptor read");
  const chunks=[];
  let total=0;
  while(total<=MAX_FIXTURE_BYTES){
   const buf=Buffer.allocUnsafe(Math.min(8192,MAX_FIXTURE_BYTES+1-total));
   const {bytesRead}=await handle.read(buf,0,buf.length,total);
   if(bytesRead===0)break;
   chunks.push(buf.subarray(0,bytesRead));
   total+=bytesRead;
  }
  const after=await handle.stat();
  const final=await lstat(file);
  if(total<=0||total>MAX_FIXTURE_BYTES||
     !sameFileIdentity(opened,after)||!sameFileIdentity(after,final))
   throw Error("fixture changed during read or exceeded byte budget");
  return Buffer.concat(chunks,total);
 }finally{await handle.close()}
}
export async function snapshotRegularFixture(file,destination){
 const bytes=await readRegularFixtureBytes(file);
 await writeFile(destination,bytes,{flag:"wx",mode:0o400});
 const expected=createHash("sha256").update(bytes).digest("hex");
 await assertSealedFixture(destination,expected);
 return expected;
}
// This detects accidental or opportunistic same-user fixture rewrites. It is
// not a defense against a malicious compiler that races or restores bytes.
async function assertSealedFixture(file,expected){
 const actual=createHash("sha256").update(await readRegularFixtureBytes(file)).digest("hex");
 if(actual!==expected)throw Error("sealed fixture changed after snapshot");
}
// Never read an entire executable into memory. This hash is a local receipt,
// not an attestation binding the pathname to what spawn later executes.
export async function hashExecutableBounded(file){
 const handle=await open(file,constants.O_RDONLY|(constants.O_NONBLOCK??0));
 try{
  const original=await handle.stat();
  if(!original.isFile()||original.size<=0||original.size>MAX_EXECUTABLE_BYTES)
   throw Error("executable must be a bounded regular file");
  const hash=createHash("sha256");
  const buffer=Buffer.allocUnsafe(65536);
  let total=0;
  while(total<=MAX_EXECUTABLE_BYTES){
   const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,MAX_EXECUTABLE_BYTES+1-total),total);
   if(bytesRead===0)break;
   hash.update(buffer.subarray(0,bytesRead));
   total+=bytesRead;
  }
  const after=await handle.stat();
  if(total!==original.size||!sameFileIdentity(original,after))
   throw Error("executable changed while hashing");
  return hash.digest("hex");
 }finally{await handle.close()}
}
export async function loadManifest(){
 const manifestPath=resolve(root,"fixtures/manifest.json");
 const manifest=validateManifestSchema(JSON.parse((await readRegularFixtureBytes(manifestPath)).toString("utf8")));
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
  const sha256=await hashExecutableBounded(resolvedPath);
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
  return {backend,sourceSha:sourceSha||null,verificationScope:"compiler-source-check-only",runtimeVerified:false,configured:false,verified:0,failed:0,unsupported:0,
   skipped:relevant.length,ok:false,coverage:relevant.length?"UNCONFIGURED":"NO_CASES",results:relevant.map(c=>({id:c.id,status:"UNCONFIGURED"}))};
 }
 validateCommand(argv);
 if(!validSha(sourceSha))throw Error("configured backend requires exact 40-character lowercase source commit SHA");
 if(!relevant.length)return {backend,declaredSourceSha:sourceSha,
  verificationScope:"compiler-source-check-only",runtimeVerified:false,
  configured:true,coverage:"NO_CASES",verified:0,failed:0,unsupported:0,skipped:0,ok:false,results:[]};
 const initialExecutable=await snapshotExecutable(argv[0]);
 const executableSha256=initialExecutable?.sha256||null;
 const results=[];
 // Compile isolated, hashed copies, never the mutable checked-out fixtures.
 const snapshotDir=await mkdtemp(join(tmpdir(),"oreslang-conformance-"));
 try{
  // Seal *all* fixture bytes before the first compiler can run. A compiler
  // cannot rewrite a later checkout fixture to change its test input.
  const sealed=[];
  for(const c of relevant){
   const fixturePath=resolve(root,"fixtures",c.file);
   const snapshotPath=join(snapshotDir,c.file);
   const fixtureSha256=await snapshotRegularFixture(fixturePath,snapshotPath);
   sealed.push({c,snapshotPath,fixtureSha256});
  }
  for(const {c,snapshotPath,fixtureSha256} of sealed){
  await assertSealedFixture(snapshotPath,fixtureSha256);
  if(c.unsupportedBackends?.includes(backend)){
   results.push({
    id:c.id,status:"UNSUPPORTED",fixtureSha256,
    executableSha256Before:null,executableSha256After:null,
    executableResolvedPathBefore:null,executableResolvedPathAfter:null,
    exitCode:null,signal:null,stdout:"",stderr:"",
    capabilityNote:"declared unsupported by merged-backend capability ledger; fixture was not executed"
   });
   continue;
  }
  const cmd=argv.map(x=>x==="{file}"?snapshotPath:x);
  const executableBefore=await snapshotExecutable(argv[0]);
  const output=spawn(cmd[0],cmd.slice(1),{encoding:"utf8",timeout:timeoutMs,cwd:root,maxBuffer:1024*1024,windowsHide:true});
  await assertSealedFixture(snapshotPath,fixtureSha256);
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
   const crashed=/\b(segmentation fault|stack trace|traceback|fatal signal|unhandled exception|process crashed)\b/i.test(combined);
   status=output.status===1 && !crashed && isExpectedCompilerDiagnostic(combined,c.diagnostic)
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
 }finally{await rm(snapshotDir,{recursive:true,force:true})}
 // Evidence for a suite is indivisible: a later executable identity drift
 // invalidates earlier apparent successes. Never publish mixed-identity
 // per-fixture VERIFIED evidence even when the overall suite is already red.
 if(initialExecutable && results.some(x=>x.status==="EXECUTABLE_CHANGED")){
  for(const result of results){
   if(result.status==="VERIFIED"){
    result.status="EXECUTABLE_CHANGED";
    result.priorVerificationRevoked=true;
   }
  }
 }
 const verified=results.filter(x=>x.status==="VERIFIED").length;
 const unsupported=results.filter(x=>x.status==="UNSUPPORTED").length;
 const failed=results.filter(x=>x.status!=="VERIFIED").length;
 return {backend,declaredSourceSha:sourceSha,verificationScope:"compiler-source-check-only",runtimeVerified:false,executableSha256,provenanceNote:"Source revision was supplied by caller; this harness does not attest that it produced the binary.",configured:true,verified,failed,unsupported,skipped:0,coverage:"CASE_RESULTS",ok:failed===0 && verified>0 &&
  relevant.some(x=>x.expect==="accept") && relevant.some(x=>x.expect==="reject"),results};
}

