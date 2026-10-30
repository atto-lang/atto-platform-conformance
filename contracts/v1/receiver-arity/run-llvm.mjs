#!/usr/bin/env node
// Native class conformance gate. NOT an actor-method parity gate.
import {createHash} from "node:crypto";
import * as fs from "node:fs";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {dirname,isAbsolute,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const sha256=b=>createHash("sha256").update(b).digest("hex");
const maxCompiler=256*1024*1024, maxFixture=1024*1024;
const environment=()=>({PATH:process.env.PATH||"/usr/bin:/bin",
  LANG:"C.UTF-8",LC_ALL:"C.UTF-8"});

function boundedFile(path,limit) {
  const fd=fs.openSync(path,fs.constants.O_RDONLY|
    (fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));
  try {
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.size<1||before.size>limit)
      throw Error("nonregular, empty or oversized file");
    const data=Buffer.allocUnsafe(before.size);
    let offset=0;
    while(offset<data.length) {
      const size=fs.readSync(fd,data,offset,data.length-offset,null);
      if(size===0)throw Error("input changed/truncated during snapshot");
      offset+=size;
    }
    const after=fs.fstatSync(fd);
    if(after.dev!==before.dev||after.ino!==before.ino||
       after.size!==before.size||after.mtimeMs!==before.mtimeMs)
      throw Error("input changed during snapshot");
    return data;
  }finally {fs.closeSync(fd)}
}
export function gitBlobSha(bytes) {
  const header=Buffer.concat([Buffer.from("blob "+bytes.length),Buffer.from([0])]);
  return createHash("sha1").update(header).update(bytes).digest("hex");
}
export function classFixtures() {
  const data=boundedFile(join(root,"manifest.json"),maxFixture);
  const manifest=JSON.parse(data.toString("utf8"));
  if(manifest.schema!=="oreslang-receiver-arity-v1"||
     manifest.status!=="normative-target-not-execution-evidence"||
     !Array.isArray(manifest.cases)||manifest.cases.length!==12)
    throw Error("receiver corpus version/inventory changed");
  const seen=new Set(),selected=[];
  let actors=0;
  for(const item of manifest.cases) {
    if(!/^[a-z][a-z0-9-]{0,90}$/.test(item.id)||
       !/^fixtures\/[a-z0-9-]+\.ores$/.test(item.path)||seen.has(item.id))
      throw Error("invalid or duplicate fixture path/identity");
    seen.add(item.id);
    const bytes=boundedFile(join(root,item.path),maxFixture);
    if(!/^[a-f0-9]{40}$/.test(item.gitBlobSha)||
       gitBlobSha(bytes)!==item.gitBlobSha)throw Error("Git blob hash mismatch");
    if(!["class","actor"].includes(item.scope)||
       !bytes.toString("utf8").startsWith("define "+item.scope+" "))
      throw Error("fixture owner mismatch");
    if(item.scope==="actor") {actors++;continue} // NOT executable in LLVM class gate
    if(item.expect==="accept"&&item.expectedInt!==42)
      throw Error("unsupported positive expected value");
    if(item.expect==="reject"&&
       (item.diagnosticClass!=="duplicate-method-slot"||
        !/^x\/[01]$/.test(item.slot)))
      throw Error("unsupported rejection class");
    if(!["accept","reject"].includes(item.expect))
      throw Error("unknown fixture expectation");
    selected.push({item,bytes});
  }
  if(selected.length!==8||actors!==4||
     selected.filter(x=>x.item.expect==="accept").length!==4||
     selected.filter(x=>x.item.expect==="reject").length!==4)
    throw Error("class/actor expected inventory drift");
  return {cases:selected,manifestSha256:sha256(data),actorsPending:actors};
}
export function assertDuplicateRejection(result,slot) {
  if(!/^x\/[01]$/.test(slot)||result.error||result.signal||
     result.status!==1||result.stdout!==""||
     !String(result.stderr||"").startsWith("oreslang-llvmc: ")||
     !String(result.stderr).includes(
       "duplicate native method name/arity '"+slot+"'"))
    throw Error("not a compiler-owned duplicate method slot error: "+slot);
  return true;
}
function execute(command,args,options={}) {
  const r=spawnSync(command,args,{encoding:"utf8",timeout:30000,
    maxBuffer:4*1024*1024,env:environment(),...options});
  if(r.error||r.signal||r.status===null)throw Error("tool did not finish");
  return r;
}
export function runClassGate({compiler,compilerSha256,compilerSourceSha,clang="clang"}={}) {
  if(!compiler||!isAbsolute(compiler)||!/^[a-f0-9]{64}$/.test(compilerSha256||""))
    throw Error("absolute compiler path and pinned SHA-256 required");
  if(!/^[a-f0-9]{40}$/.test(compilerSourceSha||""))
    throw Error("compiler source commit claim (40 hex) required");
  const binary=boundedFile(compiler,maxCompiler);
  if(sha256(binary)!==compilerSha256)throw Error("compiler SHA-256 mismatch");
  const selected=classFixtures();
  const dir=fs.mkdtempSync(join(tmpdir(),"ores-receiver-llvm-"));
  const results=[];
  try {
    const pinned=join(dir,"llvm-compiler");
    fs.writeFileSync(pinned,binary,{flag:"wx",mode:0o500});
    for(const {item,bytes} of selected.cases) {
      const file=join(dir,item.id+".ores");
      fs.writeFileSync(file,bytes,{flag:"wx",mode:0o400});
      const compiled=execute(pinned,[file],{cwd:dir});
      if(item.expect==="reject") {
        assertDuplicateRejection(compiled,item.slot);
        results.push({id:item.id,outcome:"compiler-owned-rejection",slot:item.slot});
      }else{
        if(compiled.status!==0||!compiled.stdout.includes("; ModuleID"))
          throw Error("compiler did not emit LLVM IR for "+item.id+
            ": "+String(compiled.stderr||"").slice(0,250));
        const exe=join(dir,item.id+".bin");
        const linked=execute(clang,["-x","ir","-O1","-","-o",exe],
          {cwd:dir,input:compiled.stdout});
        if(linked.status!==0)
          throw Error("clang native guest link failed: "+item.id+
            " "+String(linked.stderr||"").slice(0,250));
        const ran=execute(exe,[],{cwd:dir});
        if(ran.status!==42)throw Error("native guest result mismatch: "+item.id);
        results.push({id:item.id,outcome:"guest-exit-42",
          irSha256:sha256(Buffer.from(compiled.stdout))});
      }
      if(sha256(boundedFile(pinned,maxCompiler))!==compilerSha256)
        throw Error("pinned compiler mutated");
    }
    // The source SHA is an assertion supplied by caller, not a verified
    // reproducible-build attestation. That external authority is required.
    return {schema:"receiver-arity-llvm-class-execution-v1",
      compilerSha256,compilerSourceShaClaim:compilerSourceSha,
      manifestSha256:selected.manifestSha256,
      class:{guestPassed:4,duplicateRejected:4},
      actor:{pending:selected.actorsPending,executed:0},
      results};
  }finally {fs.rmSync(dir,{recursive:true,force:true})}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const options={};
    for(const argument of process.argv.slice(2)) {
      const m=/^--(compiler|compiler-sha256|compiler-source-sha|clang)=(.+)$/.exec(argument);
      if(!m||Object.hasOwn(options,m[1]))throw Error("unknown/duplicate option");
      options[m[1]]=m[2];
    }
    console.log(JSON.stringify(runClassGate({
      compiler:options.compiler,compilerSha256:options["compiler-sha256"],
      compilerSourceSha:options["compiler-source-sha"],clang:options.clang||"clang"
    }),null,2));
  }catch(error){
    console.error("receiver-arity class gate: "+error.message);
    process.exitCode=1;
  }
}
