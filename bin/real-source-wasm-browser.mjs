#!/usr/bin/env node
/**
 * Mandatory-executable-source scalar Oreslang -> LLVM IR -> Wasm -> browser gate.
 * Native compiled llvmc only; never substitute LLVM-IR stand-ins or JS wrappers.
 * This is NOT proof of GraalVM source parity or actor behavior.
 */
import {spawnSync} from "node:child_process";
import {open} from "node:fs/promises";
import {constants as fsConstants} from "node:fs";
import {createHash} from "node:crypto";
import {isAbsolute,resolve} from "node:path";
const fields=["compiler","compiler-sha256","bridge","bridge-sha256",
 "source","source-sha256","output","browser-module","browser-module-sha256","expected-i64"];
const opts=Object.create(null);
for(const x of process.argv.slice(2)){
 const m=/^--([a-z0-9-]+)=(.+)$/.exec(x);
 if(!m||!fields.includes(m[1])||Object.hasOwn(opts,m[1]))
  throw Error("unexpected or duplicate source-to-browser option: "+x);
 opts[m[1]]=m[2];
}
for(const name of ["compiler","bridge","source","output","browser-module"]){
 if(!isAbsolute(opts[name]||""))throw Error(name+" must be an absolute path");
}
for(const name of ["compiler-sha256","source-sha256","bridge-sha256","browser-module-sha256"]){
 if(!/^[0-9a-f]{64}$/.test(opts[name]||""))throw Error(name+" must be a pinned SHA-256");
}
const value=opts["expected-i64"]||"";
if(!/^(?:0|-?[1-9][0-9]*)$/.test(value)||value.length>20||
  BigInt(value)<-(1n<<63n)||BigInt(value)>(1n<<63n)-1n)
 throw Error("expected-i64 must be canonical signed 64-bit decimal");
if([opts.compiler,opts.bridge,opts.source,opts["browser-module"]].some(p=>resolve(p)===resolve(opts.output)))
 throw Error("output cannot overlap a pinned compiler or input");
const digest=b=>createHash("sha256").update(b).digest("hex");
const inputNames=["compiler","bridge","source","browser-module"];
const maxInputBytes={compiler:64*1024*1024,bridge:2*1024*1024,source:1024*1024,"browser-module":2*1024*1024};
// Open each pinned path exactly once and validate the opened descriptor.
// Nonblocking, no-follow opens prevent a substituted FIFO or symlink from
// blocking admission or changing the physical input after stat().
async function readBounded(path,maxBytes,name){
 const flags=fsConstants.O_RDONLY|(fsConstants.O_NONBLOCK||0)|(fsConstants.O_NOFOLLOW||0);
 const fd=await open(path,flags);
 try{
  const meta=await fd.stat();
  if(!meta.isFile()||meta.size<1||meta.size>maxBytes)
   throw Error(name+" exceeds native conformance input budget");
  const bytes=Buffer.alloc(meta.size);
  let offset=0;
  while(offset<bytes.length){
   const {bytesRead}=await fd.read(bytes,offset,bytes.length-offset,offset);
   if(bytesRead===0)throw Error(name+" changed or truncated during pinned read");
   offset+=bytesRead;
  }
  // Reject a file that grew between fstat() and the last read.
  const extra=Buffer.alloc(1);
  if((await fd.read(extra,0,1,offset)).bytesRead!==0)
   throw Error(name+" exceeds native conformance input budget");
  return bytes;
 }finally{await fd.close()}
}
const bytes=await Promise.all(inputNames.map(x=>readBounded(opts[x],maxInputBytes[x],x)));
for(const [i,name] of ["compiler","bridge","source","browser-module"].entries()){
 if(digest(bytes[i])!==opts[name+"-sha256"])throw Error(name+" SHA-256 does not match pin");
}
const magic=bytes[0].subarray(0,4);
const elf=magic.equals(Buffer.from([0x7f,0x45,0x4c,0x46]));
const pe=magic[0]===0x4d&&magic[1]===0x5a;
const macho=["feedface","feedfacf","cefaedfe","cffaedfe"].includes(magic.toString("hex"));
if(!elf&&!pe&&!macho)throw Error("native compiler executable required: scripts/stand-ins forbidden");
const run=(args,why)=>{
 const proc=spawnSync(process.execPath,args,{encoding:"utf8",timeout:120000,maxBuffer:1024*1024,windowsHide:true});
 if(proc.error||proc.signal||proc.status!==0)throw Error(why+" failed: "+
  (proc.error?.message||proc.stderr||"exit "+proc.status).slice(0,3000));
 return proc.stdout;
};
const buildOutput=run([opts.bridge,
 "--compiler="+opts.compiler,"--compiler-sha256="+opts["compiler-sha256"],
 "--source="+opts.source,"--output="+opts.output,"--environment=browser"],"native source-to-Wasm compilation");
const artifact=JSON.parse(buildOutput);
if(artifact.compilerSha256!==opts["compiler-sha256"]||artifact.sourceSha256!==opts["source-sha256"])
 throw Error("build provenance disagrees with pinned inputs");
const gateOutput=run([new URL("./wasm-core-conformance.mjs",import.meta.url).pathname,
 "--wasm="+opts.output,"--manifest="+opts.output+".artifact.json",
 "--browser-module="+opts["browser-module"],
 "--browser-module-sha256="+opts["browser-module-sha256"],
 "--expected-i64="+value],"verified browser guest");
const report=JSON.parse(gateOutput);
if(report.ok!==true||report.kind!=="core-wasm-i64-guest-only"||
 report.expectedI64!==value||report.observedI64!==value||
 report.artifactSha256!==artifact.wasmSha256)throw Error("real-source guest report mismatch");
// Close the entire compiler -> guest -> browser evidence interval: neither
// the pinned inputs nor the published output/metadata may change between
// admission and final report. The browser loader alone checks only guest bytes.
const [wasm,manifestText,provenanceText,...after]=await Promise.all([
 readBounded(opts.output,16*1024*1024,"published Wasm"),
 readBounded(opts.output+".artifact.json",1024*1024,"artifact manifest").then(b=>b.toString("utf8")),
 readBounded(opts.output+".provenance.json",1024*1024,"provenance").then(b=>b.toString("utf8")),
 ...["compiler","bridge","source","browser-module"].map(k=>readBounded(opts[k],maxInputBytes[k],k))
]);
for(const [i,name] of ["compiler","bridge","source","browser-module"].entries()){
 if(digest(after[i])!==opts[name+"-sha256"])
  throw Error(name+" changed during executable conformance gate");
}
const manifest=JSON.parse(manifestText),provenance=JSON.parse(provenanceText);
if(!/^[a-f0-9]{64}$/.test(artifact.wasmSha256||"")||
 digest(wasm)!==artifact.wasmSha256||
 manifest.wasmSha256!==artifact.wasmSha256||
 provenance.wasmSha256!==artifact.wasmSha256||
 manifest.producer?.compilerSha256!==opts["compiler-sha256"]||
 manifest.producer?.sourceSha256!==opts["source-sha256"]||
 provenance.compilerSha256!==opts["compiler-sha256"]||
 provenance.sourceSha256!==opts["source-sha256"])
 throw Error("published artifact/manifest/provenance digest inconsistency");
console.log(JSON.stringify({ok:true,kind:"native-oreslang-llvm-source-to-browser-i64-only",
 compilerSha256:artifact.compilerSha256,sourceSha256:artifact.sourceSha256,
 browserModuleSha256:opts["browser-module-sha256"],artifactSha256:artifact.wasmSha256,
 observedI64:report.observedI64},null,2));
