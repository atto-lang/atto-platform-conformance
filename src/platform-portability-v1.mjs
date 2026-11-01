/** Platform guest portability v1.
 * Source integrity and receipt-shape checking are NOT compiler/device attestation.
 * Cranelift is a separate native Oreslang Rust/Cranelift scalar JIT backend,
 * not the Wasmtime execution route for the independent Wasm source backend.
 */
import {createHash} from "node:crypto";
import {constants} from "node:fs";
import {lstat,open,realpath} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const SHA40=/^[0-9a-f]{40}$/;
const SHA64=/^[0-9a-f]{64}$/;
export const TOOLCHAINS=Object.freeze(["java","llvm","wasm","cranelift","net"]);
export const PLATFORMS=Object.freeze(["mobile","desktop","embedded","iot","fpga","asic"]);
const REPOS=Object.freeze({
  java:"ores-truffle-oreslang/oreslang-source.java",
  llvm:"ores-truffle-oreslang/oreslang-source.llvm",
  wasm:"ores-truffle-oreslang/oreslang-source.wasm",
  cranelift:"ores-truffle-oreslang/oreslang-source.cranelift",
  net:"ores-truffle-oreslang/oreslang-source.net"
});
const SOURCES=Object.freeze({
  "scalar-42":"08a415734e9992f47702dc9b1ccf2c5dceb74df05245eaa5fbb00512d18afc8a",
  "precedence-40":"f21f0aadfd6cd2866168b4d0a81c434b7b49ec0464ce767f8a3e10b38be710ab",
  "negative-42":"6c2c6d3a5140fec0f39e3c72b591d69951a89b9d161a7a07ec8741fd7c98d8ae",
  "left-associative-10":"0053fc118ee400570f21d2edb76f22da923c185808a4df284de49ab7b1cc48b5",
  "nested-42":"5279b8da34d8a3628f59ffe886fd88dd115d1472dbc43e5c129ded24c2c1f822",
  "scalar-zero":"c26a72daa25e2d8da6ce0f5b8e1373c444db82537b74da9f687f43307277d6cf",
  "add-42":"e6f0b11d253a3d44957113f908a6e8f9a1bfdae37aabd651bb5a8d74d5a61eaa",
  "multiply-42":"7220a49e0b8f5d4457974f2d688a5c302633591148dd75805c0a41a33efc0eb8",
  "unknown-name":"2dbc644007943f3406b8b806ba048d9778ba2fd5afd705e750ce8aeae590501e",
  "unknown-name-two":"649b00018ddba0fa207036d7ebadc0645904609c91394f5e50b5181fb7d3a343"
});
const EXPECTED_VALUES=Object.freeze([42,40,-42,10,42,0,42,42,null,null]);
const NEGATIVE_SYMBOLS=Object.freeze({
  "unknown-name":"missing_platform_binding",
  "unknown-name-two":"absent_platform_function"
});
const good=(ok,message)=>{if(!ok)throw Error("platform parity: "+message)};
const sha40=x=>typeof x==="string"&&SHA40.test(x);
const sha64=x=>typeof x==="string"&&SHA64.test(x);
function exactKeys(o,keys){
  good(o!==null&&typeof o==="object"&&!Array.isArray(o),"object required");
  const proto=Object.getPrototypeOf(o),d=Object.getOwnPropertyDescriptors(o),k=Reflect.ownKeys(o);
  good((proto===Object.prototype||proto===null)&&k.length===keys.length&&
       k.every(x=>typeof x==="string"&&keys.includes(x)&&d[x].enumerable&&
         Object.hasOwn(d[x],"value")),"plain exact fields required");
}
export function validateContract(c){
  exactKeys(c,["schema","version","certifiedParity","status","toolchains","platforms","caseOrder","cases","requirements"]);
  good(c.schema==="oreslang.platform-toolchain-parity/1"&&c.version===1&&
    c.certifiedParity===false&&c.status==="UNEXECUTED","contract cannot assert verification");
  exactKeys(c.toolchains,TOOLCHAINS);
  exactKeys(c.platforms,PLATFORMS);
  for(const p of PLATFORMS)
    good(c.platforms[p]==="ores-truffle-oreslang/oreslang-platform."+p,"platform registry drift");
  const expectedRoutes={java:"native-compiler",llvm:"native-compiler",
    wasm:"wasm-compiler",cranelift:"native-cranelift-jit",net:"nativeaot-compiler"};
  for(const b of TOOLCHAINS){
    const t=c.toolchains[b];
    exactKeys(t,["compilerRepo","route","engine"]);
    good(t.compilerRepo===REPOS[b]&&t.route===expectedRoutes[b]&&
      t.engine===(b==="cranelift"?"cranelift-jit":null),"backend route drift");
  }
  good(Array.isArray(c.caseOrder)&&c.caseOrder.length===10&&
    c.caseOrder.every((id,i)=>id===Object.keys(SOURCES)[i]),"case inventory drift");
  good(Array.isArray(c.cases)&&c.cases.length===10,"case count drift");
  for(let i=0;i<10;i++){
    const v=c.cases[i],id=c.caseOrder[i];
    exactKeys(v,EXPECTED_VALUES[i]===null?
      ["id","file","sha256","expect","diagnostic"]:
      ["id","file","sha256","expect","expectedValue"]);
    good(v.id===id&&v.file===id+".ores"&&v.sha256===SOURCES[id],
      "fixture identity drift: "+id);
    if(EXPECTED_VALUES[i]===null)
      good(v.expect==="reject"&&v.diagnostic==="UNKNOWN_IDENTIFIER","negative contract drift");
    else
      good(v.expect==="execute"&&v.expectedValue===EXPECTED_VALUES[i],"positive oracle drift");
  }
  const req=Object.keys(c.requirements);
  const needed=["compileSource","runPositiveGuest","negativePrimaryDiagnostic","exactPlatformHead",
    "exactCompilerCommit","compilerBinarySha256","artifactSha256","executedJobSteps",
    "craneliftNativeJitExecuted","craneliftCompilerRepoBound",
    "independentReviewRequired","privateSourceExportHold"];
  exactKeys(c.requirements,needed);
  good(req.every(x=>c.requirements[x]===true),"release gate weakened");
  return c;
}
export async function loadAndCheckCorpus(root=ROOT){
  const contractPath=join(root,"contracts/platform-portability-v1.json");
  const c=validateContract(JSON.parse((await readStable(contractPath,16384)).toString("utf8")));
  for(const v of c.cases){
    const source=await readStable(join(root,"fixtures/platform-portability-v1",v.file),4096);
    good(createHash("sha256").update(source).digest("hex")===v.sha256,
      "fixture SHA-256 mismatch: "+v.id);
  }
  return c;
}
async function readStable(file,bound){
  // Refuse links and nonregular files, read bounded descriptor bytes, then
  // verify metadata did not change. This is NOT an adversarial OS sandbox.
  const path=resolve(file),real=await realpath(path);
  good(real===path,"symlinked fixture or contract");
  const before=await lstat(path);
  good(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&
    before.size>0&&before.size<=bound,"unsafe fixture type or size");
  const h=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const opened=await h.stat();
    good(opened.dev===before.dev&&opened.ino===before.ino&&opened.size===before.size,
      "fixture replaced before read");
    const bytes=Buffer.alloc(before.size);
    let count=0;
    while(count<bytes.length){
      const {bytesRead}=await h.read(bytes,count,bytes.length-count,count);
      good(bytesRead>0,"short fixture read");
      count+=bytesRead;
    }
    const after=await h.stat();
    good(after.dev===opened.dev&&after.ino===opened.ino&&after.size===opened.size&&
      after.mtimeMs===opened.mtimeMs&&after.ctimeMs===opened.ctimeMs,"fixture changed during read");
    return bytes;
  }finally{await h.close()}
}
export function pendingMatrix(c){
  validateContract(c);
  return {status:"UNEXECUTED",certifiedParity:false,
    requiredLanes:PLATFORMS.length*TOOLCHAINS.length,
    requiredCaseRuns:PLATFORMS.length*TOOLCHAINS.length*c.cases.length,
    lanes:PLATFORMS.flatMap(platform=>TOOLCHAINS.map(toolchain=>({
      platform,toolchain,status:"NOT_EXECUTED"
    })))};
}
export function validateObservation(o,c){
  validateContract(c);
  exactKeys(o,["schema","platform","toolchain","caseId","sourceCommit",
    "platformCommit","compilerRepo","compilerCommit","compilerBinarySha256",
    "fixtureSha256","artifactSha256","run","result","engine"]);
  good(o.schema==="oreslang.platform-toolchain-observation/1","observation schema");
  good(PLATFORMS.includes(o.platform)&&TOOLCHAINS.includes(o.toolchain),"unknown platform or toolchain");
  const v=c.cases.find(x=>x.id===o.caseId);
  good(!!v&&o.fixtureSha256===v.sha256,"unbound source fixture");
  good(o.compilerRepo===REPOS[o.toolchain]&&
    [o.sourceCommit,o.platformCommit,o.compilerCommit].every(sha40)&&
    sha64(o.compilerBinarySha256)&&sha64(o.artifactSha256),"unbound compiler/source identity");
  exactKeys(o.run,["repository","headSha","runId","attempt","jobId","runnerId","conclusion","steps"]);
  good(o.run.repository===c.platforms[o.platform]&&o.run.headSha===o.platformCommit,
    "run repository/head does not bind platform source");
  good([o.run.runId,o.run.jobId,o.run.runnerId,o.run.attempt].every(x=>
    Number.isSafeInteger(x)&&x>0)&&o.run.conclusion==="success","missing executed runner evidence");
  good(Array.isArray(o.run.steps)&&o.run.steps.length>=3&&o.run.steps.length<=32&&
    new Set(o.run.steps).size===o.run.steps.length&&o.run.steps.every(x=>
    typeof x==="string"&&/^[a-z-]{3,64}$/.test(x))&&
    o.run.steps.includes("compile-ores-source")&&
    o.run.steps.includes("verify-exact-head"),
    "missing bounded executed compiler steps");
  if(v.expect==="execute")
    good(o.run.steps.includes("run-ores-guest"),"positive case requires guest execution step");
  else
    good(o.run.steps.includes("assert-negative-diagnostic"),"negative case requires primary compiler diagnostic step");
  exactKeys(o.result,v.expect==="execute"?["kind","value"]:["kind","diagnosticCode","diagnostic"]);
  if(v.expect==="execute")
    good(o.result.kind==="pass"&&Number.isSafeInteger(o.result.value),
      "positive guest value missing");
  else
    good(o.result.kind==="reject"&&o.result.diagnosticCode==="UNKNOWN_IDENTIFIER"&&
      typeof o.result.diagnostic==="string"&&
      o.result.diagnostic.length<=2048&&
      (o.toolchain==="cranelift"?
        /^orescranelift: unbound or unsupported identifier:/i.test(o.result.diagnostic):
        /^error:/i.test(o.result.diagnostic))&&
      new RegExp("(?:^|[^A-Za-z0-9_])"+NEGATIVE_SYMBOLS[o.caseId]+"(?:$|[^A-Za-z0-9_])").test(
        o.result.diagnostic),
      "negative source must have primary semantic diagnostic and the rejected identifier");
  if(o.toolchain==="cranelift"){
    exactKeys(o.engine,["name","compilerCommit","compilerBinarySha256","clifSha256"]);
    good(o.engine.name==="native-cranelift-jit"&&
      o.engine.compilerCommit===o.compilerCommit&&
      o.engine.compilerBinarySha256===o.compilerBinarySha256&&
      sha64(o.engine.clifSha256)&&o.engine.clifSha256===o.artifactSha256,
      "Cranelift requires pinned native JIT compiler and generated CLIF identity");
    if(v.expect==="execute")
      good(o.run.steps.includes("run-cranelift-native-jit")&&
        o.run.steps.includes("inspect-cranelift-ir"),
        "missing native Cranelift JIT and IR execution steps");
  }else if(o.toolchain==="wasm"){
    // This backend is a bridge, not an independent guest parser: real Oreslang
    // source lowering currently comes from LLVM before Clang/LLD emits Wasm.
    exactKeys(o.engine,["name","upstreamCompilerRepo","upstreamCompilerCommit",
      "upstreamCompilerBinarySha256","wasmModuleSha256","wasmHostBinarySha256","zeroImports"]);
    good(o.engine.name==="llvm-to-wasm"&&
      o.engine.upstreamCompilerRepo==="ores-truffle-oreslang/oreslang-source.llvm"&&
      sha40(o.engine.upstreamCompilerCommit)&&sha64(o.engine.upstreamCompilerBinarySha256)&&
      o.engine.wasmModuleSha256===o.artifactSha256&&
      sha64(o.engine.wasmHostBinarySha256)&&o.engine.zeroImports===true,
      "Wasm bridge requires pinned LLVM frontend, zero-import module and guest host");
    if(v.expect==="execute")
      good(o.run.steps.includes("compile-wasm-module")&&
        o.run.steps.includes("execute-wasm-guest"),"missing compiled Wasm module execution");
  }else if(o.toolchain==="net"){
    exactKeys(o.engine,["name","nativeAotHostSha256","compilerBinarySha256",
      "managedJitFallback"]);
    good(o.engine.name==="dotnet-nativeaot"&&
      o.engine.nativeAotHostSha256===o.artifactSha256&&
      o.engine.compilerBinarySha256===o.compilerBinarySha256&&
      o.engine.managedJitFallback===false,
      ".NET needs NativeAOT host artifact and no managed JIT fallback");
    if(v.expect==="execute")
      good(o.run.steps.includes("publish-native-aot")&&
        o.run.steps.includes("execute-native-aot-guest"),
        "missing NativeAOT build and guest execution");
  }else if(o.toolchain==="java"){
    exactKeys(o.engine,["name","guestEngineSha256","runtimeVersion"]);
    good(o.engine.name==="graal-truffle"&&sha64(o.engine.guestEngineSha256)&&
      typeof o.engine.runtimeVersion==="string"&&
      /^[0-9a-zA-Z_.-]{1,40}$/.test(o.engine.runtimeVersion),
      "Java/Graal requires pinned Truffle engine and runtime version");
    if(v.expect==="execute")
      good(o.run.steps.includes("execute-graal-guest"),"missing Graal guest execution");
  }else good(o.engine===null,"unexpected engine evidence on LLVM native lane");
  return {status:"STRUCTURAL_OBSERVATION_ONLY",independentlyAuthenticated:false,certifiedParity:false};
}
export function compareObservations(records,c){
  validateContract(c);
  good(Array.isArray(records)&&records.length<=PLATFORMS.length*TOOLCHAINS.length*c.cases.length,
    "unbounded observation batch");
  const seen=new Map();
  for(const record of records){
    validateObservation(record,c);
    const key=[record.platform,record.caseId,record.toolchain].join(":");
    good(!seen.has(key),"duplicate platform/toolchain/case receipt");
    seen.set(key,record);
  }
  let missing=0,divergent=0;
  for(const platform of PLATFORMS)for(const v of c.cases){
    const group=TOOLCHAINS.map(b=>seen.get([platform,v.id,b].join(":")));
    missing+=group.filter(x=>!x).length;
    if(group.some(x=>!x))continue;
    const projection=group.map(x=>v.expect==="execute"?
      "pass:"+x.result.value:"reject:"+x.result.diagnosticCode);
    if(new Set(projection).size!==1||projection[0]!==(
      v.expect==="execute"?"pass:"+v.expectedValue:"reject:"+v.diagnostic))
      divergent++;
    if(new Set(group.map(x=>x.sourceCommit)).size!==1)divergent++;
  }
  return {status:missing?"INCOMPLETE":divergent?"DIVERGENT":"OBSERVED_MATCH_NOT_CERTIFIED",
    observed:seen.size,missing,divergent,independentlyAuthenticated:false,certifiedParity:false};
}
