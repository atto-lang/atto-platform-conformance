// Real native LLVM-to-Clang guest execution of the shared Oreslang corpus.
// This file does not attest that the declared Git head produced the binary.
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile,writeFile,mkdtemp,rm,lstat,realpath,copyFile,chmod} from "node:fs/promises";
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
  const primary=stderr.split(/\r?\n/).find(line=>line.startsWith("oreslang-llvmc: "));
  if(!primary)return false;
  const diagnostic=primary.slice("oreslang-llvmc: ".length);
  if(category==="separator")return /\bmalformed integer separator\b/.test(diagnostic);
  if(category==="i64-overflow")return /\binteger literal overflows signed 64-bit\b/.test(diagnostic);
  if(category==="type")return /\barithmetic requires (?:i64|int), got (?:bool|String|string)\b/.test(diagnostic);
  if(category==="syntax")return /\b(?:expected (?:identifier|expression|integer literal)|unsupported native expression|unexpected token)\b/.test(diagnostic);
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
  const guestDefs=ir.match(/\bdefine\b[^\r\n]{0,300}\bi64\s+@__oreslang_guest_main\s*\(\s*\)/g)||[];
  const hostDefs=ir.match(/\bdefine\b[^\r\n]{0,300}\bi32\s+@main\s*\(\s*\)/g)||[];
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
function command(executable,args,timeout=30000){
  const p=spawnSync(executable,args,{encoding:"utf8",timeout,maxBuffer:4*1024*1024,
    windowsHide:true,shell:false});
  return {code:p.status,signal:p.signal||null,error:p.error?.code||null,
    stdout:p.stdout||"",stderr:p.stderr||""};
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

export function validateNumericCorpus(manifest){
  if(manifest?.schemaVersion!==1||manifest.contract!=="oreslang.numeric-separators/source-v1"||
    manifest.status!=="candidate-unattested"||!Array.isArray(manifest.cases)||manifest.cases.length!==26)
    throw Error("invalid numeric source corpus version/count");
  const ids=new Set(),expressions=new Set();let yes=0,no=0;
  for(const c of manifest.cases){
    if(!/^[a-z][a-z0-9-]*$/.test(c.id)||ids.has(c.id)||
      typeof c.expression!=="string"||expressions.has(c.expression)||
      c.guestSource!=="pub fnc main():int{return "+c.expression+";}\n")
      throw Error("duplicate/mutated guest fixture");
    ids.add(c.id);expressions.add(c.expression);
    if(c.expect==="accept"){
      yes++;
      if(!/^-?(0|[1-9][0-9]*)$/.test(c.expectedI64)||
        BigInt(c.expectedI64)<-(1n<<63n)||BigInt(c.expectedI64)>(1n<<63n)-1n)
        throw Error("invalid expected signed i64 value");
    }else if(c.expect==="reject"){
      no++;
      if(!["separator","i64-overflow","type","syntax"].includes(c.category))
        throw Error("invalid rejection category");
    }else throw Error("invalid fixture expectation");
  }
  if(yes!==12||no!==14)throw Error("numeric corpus count drift");
  return manifest;
}
export async function executeNativeNumericCorpus({compiler,compilerSha256,clang,clangSha256,sourceCommit,manifestSha256}={}){
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
    // A copied Clang binary moves relative to its builtin resource files.
    // Query the original pinned installation for its canonical resource path;
    // the copied Clang's relative resource lookup would point at the new
    // private workspace instead. The resource dir is a trusted
    // host/toolchain dependency, not part of the two executable SHA pins.
    const resourceQuery=command(clang,["-print-resource-dir"]);
    if(!succeeded(resourceQuery)||!/^[^\r\n]+\n?$/.test(resourceQuery.stdout))
      throw Error("pinned Clang resource directory unavailable");
    const resourceDir=await realpath(resourceQuery.stdout.trim());
    if(!isAbsolute(resourceDir)||!(await lstat(resourceDir)).isDirectory())
      throw Error("Clang resource directory invalid");
    const reporter=join(root,"report.c");
    await writeFile(reporter,shim,{mode:0o400,flag:"wx"});
    for(const c of cases){
      const bytes=Buffer.from(c.guestSource);
      const input=join(root,c.id+".ores");
      const ll=join(root,c.id+".ll");
      const exe=join(root,c.id+".native");
      await writeFile(input,bytes,{mode:0o400,flag:"wx"});
      const compiled=command(stagedCompiler,["--target=host",input]);
      const evidence={id:c.id,expect:c.expect,category:c.category||null,
        fixtureSha256:sha256(bytes),compilerExit:compiled.code,
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
          const linked=command(stagedClang,["-resource-dir="+resourceDir,"-x","ir",ll,"-x","c",reporter,"-o",exe]);
          evidence.clangExit=linked.code;
          if(succeeded(linked)){
            const guest=command(exe,[],10000);
            evidence.guestExit=guest.code;
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
    const unchanged=await hashExecutableBounded(stagedCompiler)===compilerSha256 &&
      await hashExecutableBounded(stagedClang)===clangSha256 &&
      await hashExecutableBounded(compiler)===compilerSha256 &&
      await hashExecutableBounded(clang)===clangSha256;
    if(!unchanged)for(const item of results)item.status="TOOLCHAIN_CHANGED";
    const failed=results.filter(x=>!x.status.startsWith("VERIFIED_")).length;
    return {schemaVersion:1,contract:"oreslang.numeric-separators/native-llvm-evidence-v1",
      backend:"llvm",sourceCommitDeclared:sourceCommit,sourceCommitAttested:false,
      compilerSha256,clangSha256,manifestSha256:sha256(manifestBytes),
      toolBytesExecutedFromPrivateSnapshots:true,
      clangResourceDirIsExternalDependency:true,
      verificationScope:"real native Oreslang compiler + Clang + i64 guest",
      verified:results.length-failed,failed,ok:failed===0&&unchanged,results};
  }finally{await rm(root,{recursive:true,force:true});}
}
