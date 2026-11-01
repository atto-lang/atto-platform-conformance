#!/usr/bin/env node
// Execute the portable .ores cases with a REAL Cranelift native JIT compiler.
// This local runner is not an independent GitHub runner/target attestation.
// It deliberately cannot certify cross-backend parity or any platform ABI.
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {open,realpath,lstat} from "node:fs/promises";
import {resolve,dirname,join,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {loadAndCheckCorpus} from "../src/platform-portability-v1.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const sha64=/^[0-9a-f]{64}$/;
const sha40=/^[0-9a-f]{40}$/;
function requireCase(ok,message){if(!ok)throw Error(message)}
async function executableEvidence(path,digest){
  requireCase(isAbsolute(path),"compiler path must be absolute");
  const physical=await realpath(path);
  requireCase(physical===path,"compiler symlink is forbidden");
  const before=await lstat(path);
  requireCase(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&
    before.size>0&&before.size<=256*1024*1024&&
    (before.mode&0o111)!==0,"compiler must be bounded executable regular file");
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const opened=await handle.stat();
    requireCase(opened.dev===before.dev&&opened.ino===before.ino&&
      opened.size===before.size&&opened.mtimeMs===before.mtimeMs,
      "compiler executable replaced before hash");
    const h=createHash("sha256"), buf=Buffer.alloc(65536);
    for(let pos=0;pos<before.size;){
      const {bytesRead}=await handle.read(buf,0,Math.min(buf.length,before.size-pos),pos);
      requireCase(bytesRead>0,"short compiler executable read");
      h.update(buf.subarray(0,bytesRead));pos+=bytesRead;
    }
    const after=await handle.stat(),final=await lstat(path);
    for(const st of [after,final])
      requireCase(st.dev===before.dev&&st.ino===before.ino&&
        st.size===before.size&&st.mtimeMs===before.mtimeMs&&
        st.ctimeMs===before.ctimeMs,"compiler binary changed during evidence capture");
    requireCase(h.digest("hex")===digest,"native compiler digest mismatch");
    return {dev:before.dev,ino:before.ino,size:before.size,mtimeMs:before.mtimeMs,ctimeMs:before.ctimeMs};
  }finally{await handle.close()}
}
async function runNativeCranelift({compiler,compilerSha256,compilerCommit,timeoutMs=5000,
  spawn=spawnSync}={}){
  requireCase(typeof compiler==="string"&&isAbsolute(compiler),"unconfigured compiler");
  requireCase(sha64.test(compilerSha256||""),"missing SHA-256 of real native compiler");
  requireCase(sha40.test(compilerCommit||""),"missing full pinned compiler source commit");
  requireCase(Number.isSafeInteger(timeoutMs)&&timeoutMs>=100&&timeoutMs<=30000,
    "unsafe compiler timeout");
  const contract=await loadAndCheckCorpus();
  requireCase(contract.toolchains.cranelift.compilerRepo===
    "ores-truffle-oreslang/oreslang-source.cranelift","wrong Cranelift compiler repository");
  const evidence=await executableEvidence(compiler,compilerSha256);
  const records=[];
  for(const test of contract.cases){
    const file=join(ROOT,"fixtures/platform-portability-v1",test.file);
    const expected=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
    try{
      const stat=await expected.stat();
      requireCase(stat.isFile()&&stat.size>0&&stat.size<4096,"unsafe guest source fixture");
      const actual=await expected.readFile();
      requireCase(createHash("sha256").update(actual).digest("hex")===test.sha256,
        "source drift before guest execution");
    }finally{await expected.close()}
    // IR mode independently proves this binary is asked to lower the exact
    // source, rather than relying on a stdout-only wrapper. The IR digest
    // is necessary but not independently authenticated JIT provenance.
    const ir=spawn(compiler,["ir",file],{
      shell:false,encoding:"utf8",timeout:timeoutMs,maxBuffer:65536,
      env:{PATH:"/usr/bin:/bin",LANG:"C",LC_ALL:"C",RUST_BACKTRACE:"0"}
    });
    requireCase(!ir.error&&!ir.signal&&
      typeof ir.stdout==="string"&&typeof ir.stderr==="string",
      "native Cranelift IR invocation crashed or timed out");
    if(test.expect==="reject")
      requireCase(ir.status===1&&ir.stdout===""&&
        ir.stderr.trim()==="orescranelift: unbound or unsupported identifier: "+
        (test.id==="unknown-name"?"missing_platform_binding":"absent_platform_function"),
        "native Cranelift IR must reject unsupported identifier before codegen");
    else
      requireCase(ir.status===0&&ir.stderr===""&&
        /\bfunction\b/.test(ir.stdout)&&ir.stdout.length<65536,
        "native Cranelift did not produce bounded CLIF IR");
    const command=spawn(compiler,["run",file],{
      shell:false,encoding:"utf8",timeout:timeoutMs,maxBuffer:8192,
      env:{PATH:"/usr/bin:/bin",LANG:"C",LC_ALL:"C",RUST_BACKTRACE:"0"}
    });
    requireCase(!command.error&&!command.signal,"native compiler launcher crashed or timed out");
    requireCase(typeof command.stdout==="string"&&typeof command.stderr==="string",
      "missing bounded native output");
    const negative=test.expect==="reject";
    if(negative){
      const symbol=test.id==="unknown-name"?"missing_platform_binding":"absent_platform_function";
      requireCase(command.status===1&&command.stdout===""&&
        command.stderr.trim()==="orescranelift: unbound or unsupported identifier: "+symbol,
        "native compiler did not reject exact unresolved identifier: "+test.id);
    }else{
      requireCase(command.status===0&&command.stderr===""&&
        command.stdout===String(test.expectedValue)+"\n",
        "native JIT guest mismatch: "+test.id);
    }
    await executableEvidence(compiler,compilerSha256);
    records.push({id:test.id,kind:negative?"COMPILER_REJECT":"NATIVE_JIT_EXECUTED",
      fixtureSha256:test.sha256,clifSha256:negative?null:
        createHash("sha256").update(ir.stdout).digest("hex"),
      observedValue:negative?null:test.expectedValue});
  }
  return {
    schema:"oreslang.cranelift-local-guest-evidence/1",
    toolchain:"cranelift",compilerRepo:contract.toolchains.cranelift.compilerRepo,
    declaredCompilerCommit:compilerCommit,compilerBinarySha256:compilerSha256,
    compilerFileIdentity:evidence,sourceCases:records.length,records,
    status:"LOCAL_NATIVE_OBSERVATION_NOT_INDEPENDENTLY_ATTESTED",
    platformCompatible:false,independentlyAuthenticated:false,certifiedParity:false
  };
}
export {runNativeCranelift};
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const opts=Object.create(null);
  try{
    for(const arg of process.argv.slice(2)){
      const m=/^--(compiler|compiler-sha256|compiler-commit|timeout-ms)=(.+)$/.exec(arg);
      requireCase(m&&!Object.hasOwn(opts,m[1]),"unknown/duplicate compiler argument");
      opts[m[1]]=m[2];
    }
    const result=await runNativeCranelift({
      compiler:opts.compiler,compilerSha256:opts["compiler-sha256"],
      compilerCommit:opts["compiler-commit"],
      timeoutMs:opts["timeout-ms"]===undefined?5000:Number(opts["timeout-ms"])
    });
    console.log(JSON.stringify(result,null,2));
  }catch(e){
    console.error("NATIVE_CRANELIFT_GUEST_NOT_VERIFIED: "+(e?.message||String(e)));
    process.exitCode=3;
  }
}
