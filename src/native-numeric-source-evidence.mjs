// Real native LLVM-to-Clang guest execution of the shared Oreslang corpus.
// This file does not attest that the declared Git head produced the binary.
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile,writeFile,mkdtemp,rm,lstat,realpath,copyFile,chmod,opendir,open} from "node:fs/promises";
import {constants as fsConstants} from "node:fs";
import {tmpdir} from "node:os";
import {isAbsolute,join} from "node:path";
import {fileURLToPath} from "node:url";
import {hashExecutableBounded} from "./harness.mjs";

const fixture=fileURLToPath(new URL("../fixtures/numeric-separators-source-v1.json",import.meta.url));
const sha256=b=>createHash("sha256").update(b).digest("hex");
const digest64=s=>typeof s==="string"&&/^[a-f0-9]{64}$/.test(s);
const revision40=s=>typeof s==="string"&&/^[a-f0-9]{40}$/.test(s);

export function nativeNumericDiagnostic(category,stderr){
  if(typeof stderr!=="string")return false;
  // Only the first nonempty diagnostic line may establish a compiler
  // rejection. Do not let an unrelated runner/Clang failure followed by
  // a forged Oreslang line masquerade as source admission evidence.
  const primary=stderr.split(/\r?\n/).find(line=>line.trim().length>0);
  if(!primary||!primary.startsWith("oreslang-llvmc: "))return false;
  const diagnostic=primary.slice("oreslang-llvmc: ".length);
  if(category==="separator")return /^malformed integer separator\b/.test(diagnostic);
  if(category==="i64-overflow")return /^integer literal overflows signed 64-bit\b/.test(diagnostic);
  if(category==="type")return /^arithmetic requires (?:i64|int), got (?:bool|String|string)\b/.test(diagnostic);
  if(category==="syntax")return /^(?:expected (?:identifier|expression|integer literal)|unsupported native expression|unexpected token)\b/.test(diagnostic);
  return false;
}
export function renameNumericGuestMain(ir){
  if(typeof ir!=="string"||ir.length<10||ir.length>4*1024*1024)
    throw Error("missing or oversized LLVM IR");
  // Actual oreslang-llvmc host-target IR has TWO entrypoints:
  //   define i64 @__oreslang_guest_main()  ; real guest function
  //   define i32 @main()                   ; OS ABI wrapper with exit clamping
  // Do not attempt to rename a nonexistent i64 @main() or observe the
  // clamped i32 host status as a full-width signed i64 guest result.
  // Match actual LLVM IR function definition headers, not commented-out
  // "define" text, metadata strings, or instructions containing that word.
  // A comment duplicating a real definition must not alter admission; a
  // comment alone must never impersonate either required entrypoint.
  const guestDefs=ir.match(/^[ \t]*define[ \t]+[^\r\n;]{0,300}\bi64[ \t]+@__oreslang_guest_main[ \t]*\([ \t]*\)/gm)||[];
  const hostDefs=ir.match(/^[ \t]*define[ \t]+[^\r\n;]{0,300}\bi32[ \t]+@main[ \t]*\([ \t]*\)/gm)||[];
  if(guestDefs.length!==1||hostDefs.length!==1)
    throw Error("expected one i64 __oreslang_guest_main and one i32 host main wrapper");
  // Keep the actual Oreslang guest callable, retire only the host wrapper
  // before linking an independent reporting shim that calls the guest.
  const renamed=ir.replace(/@main(?=\s*\()/g,"@oreslang_numeric_unused_host_main");
  if(/@main(?=\s*\()/.test(renamed))throw Error("unrenamed native host wrapper");
  return renamed;
}
const shim=[
 "#include <inttypes.h>",
 "#include <stdint.h>",
 "#include <stdio.h>",
 "extern int64_t __oreslang_guest_main(void);",
 "int main(void) {",
 "  if (printf(\"%\" PRId64 \"\\n\", __oreslang_guest_main()) < 0) return 95;",
 "  return 0;",
 "}",
 ""
].join("\n");
// Compiler and Clang binaries are SHA-pinned, but inherited NODE_OPTIONS,
// LD_PRELOAD, DYLD_*, compiler flags or shell hooks could alter the executed
// process without changing either pinned executable. Only permit a minimal
// deterministic execution environment. PATH is for Clang's host linker tools,
// not for resolving the already absolute compiler/Clang executable snapshots.
const nativeNumericToolEnv=Object.freeze({
  PATH:process.platform==="win32"?"C:\\Windows\\System32":"/usr/bin:/bin",
  LC_ALL:"C", LANG:"C", TZ:"UTC",
  ...(process.platform==="win32"?{SystemRoot:process.env.SystemRoot||"C:\\Windows"}:{})
});
export function runNumericCommand(executable,args,timeout=30000){
  // Keep stdout/stderr as bytes until after hashing, so malformed UTF-8
  // cannot silently change the forensic receipt through replacement chars.
  const p=spawnSync(executable,args,{timeout,maxBuffer:4*1024*1024,
    windowsHide:true,shell:false,env:nativeNumericToolEnv});
  const stdout=Buffer.isBuffer(p.stdout)?p.stdout:Buffer.alloc(0);
  const stderr=Buffer.isBuffer(p.stderr)?p.stderr:Buffer.alloc(0);
  return {code:p.status,signal:p.signal||null,error:p.error?.code||null,
    stdout:stdout.toString("utf8"),stderr:stderr.toString("utf8"),
    stdoutBytes:stdout.length,stderrBytes:stderr.length,
    stdoutSha256:sha256(stdout),stderrSha256:sha256(stderr)};
}
function succeeded(p){return p.code===0&&!p.signal&&!p.error;}
async function pinned(file,digest,label){
  if(!isAbsolute(file)||!digest64(digest))throw Error(label+" requires absolute path and SHA-256");
  const st=await lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||await realpath(file)!==file)
    throw Error(label+" must be a regular executable canonical realpath");
  if(await hashExecutableBounded(file)!==digest)throw Error(label+" SHA-256 differs");
}
// Copy the verified bytes into a private per-run directory and execute the
// *copy*, never the mutable caller pathname. The SHA check after copying is
// authoritative: any source-path mutation while copying fails admission.
// This pins executable file bytes, not its dynamic libraries, compiler build
// provenance, the Clang resource directory or the containing host.
export async function stageNumericExecutable({file,digest,label,workspace,filename}){
  if(!["oreslang-llvmc","clang"].includes(filename))
    throw Error("unexpected numeric executable snapshot name");
  if(!isAbsolute(workspace)||await realpath(workspace)!==workspace)
    throw Error("snapshot workspace must be a canonical absolute directory");
  const dirStat=await lstat(workspace);
  if(!dirStat.isDirectory()||(dirStat.mode&0o077)!==0)
    throw Error("snapshot workspace must be private to runner owner");
  await pinned(file,digest,label);
  const dest=join(workspace,filename);
  await copyFile(file,dest,fsConstants.COPYFILE_EXCL);
  await chmod(dest,0o500);
  await pinned(dest,digest,label+" executable snapshot");
  return dest;
}

// A resource-directory mode check alone misses mutable Clang builtin headers.
// Snapshot its *contents*, reject symlinks/nonregular/writable entries, and
// compare before/after execution. This is an observation, NOT a source or
// compiler-build provenance claim. Bound traversal before reading any file.
export async function snapshotNumericClangResources(root){
  if(typeof root!=="string"||!isAbsolute(root)||await realpath(root)!==root)
    throw Error("Clang resource directory must be a canonical absolute directory");
  const pending=[{path:root,rel:""}],entries=[];
  let total=0,files=0;
  while(pending.length){
    const item=pending.pop();
    const st=await lstat(item.path,{bigint:true});
    if(st.isSymbolicLink()||(st.mode&0o022n)!==0n)
      throw Error("Clang resource tree contains a symlink or a group/world-writable entry");
    if(entries.length>=4096)throw Error("Clang resource tree entry limit exceeded");
    entries.push(null);
    if(st.isDirectory()){
      entries[entries.length-1]=[item.rel,"directory",Number(st.mode&0o777n)];
      // Stream entries, not an unbounded readdir() array: otherwise a
      // malicious resource directory can allocate millions of pending
      // objects before the 4096-entry check is reached.
      const dir=await opendir(item.path);
      for await(const child of dir){
        const name=child.name;
        if(name==="."||name===".."||name.includes("\0")||name.includes("/"))
          throw Error("invalid Clang resource tree path");
        if(entries.length+pending.length>=4096)
          throw Error("Clang resource tree entry limit exceeded");
        const rel=item.rel?item.rel+"/"+name:name;
        pending.push({path:join(item.path,name),rel});
      }
    }else if(st.isFile()){
      if(st.size>128n*1024n*1024n)
        throw Error("Clang resource file exceeds size limit");
      total+=Number(st.size);
      if(total>512*1024*1024)throw Error("Clang resource tree exceeds byte budget");
      const handle=await open(item.path,fsConstants.O_RDONLY|(fsConstants.O_NOFOLLOW||0));
      let contents;
      try{
        const before=await handle.stat({bigint:true});
        if(!before.isFile()||before.size!==st.size||before.ino!==st.ino||before.dev!==st.dev)
          throw Error("Clang resource file changed before read");
        contents=await handle.readFile();
        const after=await handle.stat({bigint:true});
        const nameAfter=await lstat(item.path,{bigint:true});
        if(BigInt(contents.length)!==before.size||
           [before.dev,before.ino,before.size,before.mtimeNs,before.ctimeNs].some((v,i)=>
             v!==[after.dev,after.ino,after.size,after.mtimeNs,after.ctimeNs][i])||
           after.ino!==nameAfter.ino||after.dev!==nameAfter.dev||
           await realpath(item.path)!==item.path)
          throw Error("Clang resource file changed during read");
      }finally{await handle.close();}
      files++;
      entries[entries.length-1]=[item.rel,"file",Number(st.mode&0o777n),
        contents.length,sha256(contents)];
    }else throw Error("Clang resource tree contains nonregular entry");
  }
  const manifest=createHash("sha256").update("oreslang-clang-resource-tree-v1\0");
  for(const entry of entries.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0))
    manifest.update(JSON.stringify(entry)+"\n");
  return Object.freeze({sha256:manifest.digest("hex"),files,entries:entries.length,bytes:total});
}

export function validateNumericCorpus(manifest){
  if(manifest?.schemaVersion!==1||manifest.contract!=="oreslang.numeric-separators/source-v1"||
    manifest.status!=="candidate-unattested"||!Array.isArray(manifest.cases)||manifest.cases.length!==26)
    throw Error("invalid numeric source corpus version/count");
  const ids=new Set(),expressions=new Set();let yes=0,no=0;
  for(const c of manifest.cases){
    if(!/^[a-z][a-z0-9-]*$/.test(c.id)||ids.has(c.id)||
      typeof c.expression!=="string"||
      !/^[A-Za-z0-9_+*()" \t-]+$/.test(c.expression)||
      expressions.has(c.expression)||
      c.guestSource!=="pub fnc main():int{return "+c.expression+";}\n")
      throw Error("duplicate/mutated/unsafe guest fixture");
    ids.add(c.id);expressions.add(c.expression);
    if(c.expect==="accept"){
      yes++;
      if(c.category!==undefined)
        throw Error("accepted fixture must not declare a rejection category");
      if(typeof c.expectedI64!=="string"||
        !/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(c.expectedI64)||
        BigInt(c.expectedI64)<-(1n<<63n)||BigInt(c.expectedI64)>(1n<<63n)-1n)
        throw Error("invalid expected signed i64 value");
    }else if(c.expect==="reject"){
      no++;
      if(c.expectedI64!==undefined)
        throw Error("rejected fixture must not declare an accepted value");
      if(!["separator","i64-overflow","type","syntax"].includes(c.category))
        throw Error("invalid rejection category");
    }else throw Error("invalid fixture expectation");
  }
  if(yes!==12||no!==14)throw Error("numeric corpus count drift");
  return manifest;
}
export async function executeNativeNumericCorpus({compiler,compilerSha256,clang,clangSha256,clangResourceDir,sourceCommit,manifestSha256}={}){
  if(!revision40(sourceCommit))throw Error("exact 40-character LLVM source SHA required");
  if(!digest64(manifestSha256))throw Error("exact pinned manifest SHA-256 required");
  const manifestBytes=await readFile(fixture);
  if(manifestBytes.length>1024*1024)throw Error("manifest too large");
  if(sha256(manifestBytes)!==manifestSha256)
    throw Error("numeric source fixture manifest SHA-256 mismatch");
  await pinned(compiler,compilerSha256,"LLVM compiler");
  await pinned(clang,clangSha256,"Clang");
  const cases=validateNumericCorpus(JSON.parse(manifestBytes.toString("utf8"))).cases;
  const root=await mkdtemp(join(tmpdir(),"ores-native-corpus-"));
  const results=[];
  try{
    const stagedCompiler=await stageNumericExecutable({
      file:compiler,digest:compilerSha256,label:"LLVM compiler",
      workspace:root,filename:"oreslang-llvmc"
    });
    const stagedClang=await stageNumericExecutable({
      file:clang,digest:clangSha256,label:"Clang",
      workspace:root,filename:"clang"
    });
    // A staged Clang moves relative to its builtin resource files. Require
    // an independently reviewed canonical install directory instead of
    // executing the mutable original Clang to discover a resource path.
    // These resources and host libraries are external trusted dependencies;
    // they are NOT included in the executable SHA-256 proof.
    const resourceBefore=await snapshotNumericClangResources(clangResourceDir);
    const resourceDir=clangResourceDir;
    const reporter=join(root,"report.c");
    await writeFile(reporter,shim,{mode:0o400,flag:"wx"});
    for(const c of cases){
      const bytes=Buffer.from(c.guestSource);
      const input=join(root,c.id+".ores");
      const ll=join(root,c.id+".ll");
      const exe=join(root,c.id+".native");
      await writeFile(input,bytes,{mode:0o400,flag:"wx"});
      const compiled=runNumericCommand(stagedCompiler,["--target=host",input]);
      const evidence={id:c.id,expect:c.expect,category:c.category||null,
        fixtureSha256:sha256(bytes),compilerExit:compiled.code,
        compilerSignal:compiled.signal,compilerError:compiled.error,
        compilerStdoutSha256:compiled.stdoutSha256,
        compilerStderrSha256:compiled.stderrSha256,
        compilerStdoutBytes:compiled.stdoutBytes,
        compilerStderrBytes:compiled.stderrBytes,
        status:"MISMATCH",observedI64:null};
      if(c.expect==="reject"){
        if(!compiled.signal&&!compiled.error&&Number.isInteger(compiled.code)&&
          compiled.code!==0&&compiled.stdout.length===0&&
          nativeNumericDiagnostic(c.category,compiled.stderr))
          evidence.status="VERIFIED_COMPILER_REJECTION";
      }else if(succeeded(compiled)&&compiled.stderr===""){
        try{
          const rewritten=renameNumericGuestMain(compiled.stdout);
          await writeFile(ll,rewritten,{mode:0o400,flag:"wx"});
          const linked=runNumericCommand(stagedClang,["-resource-dir="+resourceDir,"-x","ir",ll,"-x","c",reporter,"-o",exe]);
          evidence.clangExit=linked.code;
          evidence.clangSignal=linked.signal;
          evidence.clangError=linked.error;
          evidence.clangStdoutSha256=linked.stdoutSha256;
          evidence.clangStderrSha256=linked.stderrSha256;
          evidence.clangStdoutBytes=linked.stdoutBytes;
          evidence.clangStderrBytes=linked.stderrBytes;
          // A successful linker invocation must not claim a clean guest
          // build while silently writing unclassified stdout diagnostics.
          if(succeeded(linked)&&linked.stdout===""){
            const guest=runNumericCommand(exe,[],10000);
            evidence.guestExit=guest.code;
            evidence.guestSignal=guest.signal;
            evidence.guestError=guest.error;
            evidence.guestStderrSha256=guest.stderrSha256;
            evidence.guestStdoutSha256=guest.stdoutSha256;
            evidence.guestStdoutBytes=guest.stdoutBytes;
            evidence.guestStderrBytes=guest.stderrBytes;
            if(succeeded(guest)&&guest.stderr===""&&
              /^-?(0|[1-9][0-9]*)\n$/.test(guest.stdout)){
              evidence.observedI64=guest.stdout.trim();
              if(evidence.observedI64===c.expectedI64)
                evidence.status="VERIFIED_NATIVE_GUEST_I64";
            }
          }
        }catch(e){evidence.failure=String(e.message).slice(0,180);}
      }
      results.push(evidence);
    }
    // The executed copies must retain their hashes through the entire run.
    // A changed original also fails closed despite private-copy immutability.
    // A tool can make its resource tree unscannable during execution (e.g.
    // chmod a header writable, replace it with a symlink, or delete it).
    // Revoke the entire batch with a structured failed receipt instead of
    // throwing away every case's captured diagnostics and byte hashes.
    let resourceUnchanged=false,resourceRecheckFailed=false;
    try{
      const resourceAfter=await snapshotNumericClangResources(clangResourceDir);
      resourceUnchanged=resourceBefore.sha256===resourceAfter.sha256;
    }catch{
      resourceRecheckFailed=true;
    }
    // Deleted, replaced or inaccessible executable snapshots must also
    // revoke all 26 entries with a structured failed receipt. A failed
    // re-hash is not evidence that any executable remained trustworthy.
    let executableHashesUnchanged=false,executableRecheckFailed=false;
    try{
      executableHashesUnchanged=
        await hashExecutableBounded(stagedCompiler)===compilerSha256 &&
        await hashExecutableBounded(stagedClang)===clangSha256 &&
        await hashExecutableBounded(compiler)===compilerSha256 &&
        await hashExecutableBounded(clang)===clangSha256;
    }catch{
      executableRecheckFailed=true;
    }
    const unchanged=resourceUnchanged&&executableHashesUnchanged;
    if(!unchanged)for(const item of results)item.status="TOOLCHAIN_CHANGED";
    const failed=results.filter(x=>!x.status.startsWith("VERIFIED_")).length;
    return {schemaVersion:1,contract:"oreslang.numeric-separators/native-llvm-evidence-v1",
      backend:"llvm",sourceCommitDeclared:sourceCommit,sourceCommitAttested:false,
      compilerSha256,clangSha256,manifestSha256:sha256(manifestBytes),
      clangResourceTreeSha256:resourceBefore.sha256,
      clangResourceEntries:resourceBefore.entries,clangResourceBytes:resourceBefore.bytes,
      clangResourceTreeUnchanged:resourceUnchanged,
      clangResourceTreeRecheckFailed:resourceRecheckFailed,
      executableRecheckFailed,
      executableHashesUnchanged,
      toolBytesExecutedFromPrivateSnapshots:true,
      clangResourceDirIsExternalDependency:true,
      verificationScope:"real native Oreslang compiler + Clang + i64 guest",
      verified:results.length-failed,failed,ok:failed===0&&unchanged,
      parityCertified:false,results};
  }finally{await rm(root,{recursive:true,force:true});}
}
