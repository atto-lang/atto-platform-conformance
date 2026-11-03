import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdtemp,readFile,writeFile,mkdir,rm,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {TOOLCHAINS,PLATFORMS,loadAndCheckCorpus,validateContract,
  pendingMatrix,validateObservation,compareObservations} from "../src/platform-portability-v1.mjs";

const root=fileURLToPath(new URL("../",import.meta.url));
const contract=await loadAndCheckCorpus();
const HEX40="a".repeat(40),HEX64="b".repeat(64);
function receipt(platform="desktop",toolchain="llvm",caseId="scalar-42"){
  const v=contract.cases.find(c=>c.id===caseId);
  const negative=v.expect==="reject";
  return {
    schema:"oreslang.platform-toolchain-observation/1",
    platform,toolchain,caseId,
    sourceCommit:HEX40,
    platformCommit:"c".repeat(40),
    compilerRepo:contract.toolchains[toolchain].compilerRepo,
    compilerCommit:"d".repeat(40),
    compilerBinarySha256:HEX64,
    fixtureSha256:v.sha256,artifactSha256:negative?null:"e".repeat(64),
    run:{
      repository:contract.platforms[platform],
      headSha:"c".repeat(40),runId:123456,attempt:1,jobId:123457,
      runnerId:123458,conclusion:"success",
      steps:negative?["verify-exact-head","compile-ores-source","assert-negative-diagnostic"]:
        ["verify-exact-head","compile-ores-source","run-ores-guest",
          ...(toolchain==="cranelift"?["run-cranelift-native-jit","inspect-cranelift-ir"]:[]),
          ...(toolchain==="wasm"?["compile-wasm-module","execute-wasm-guest"]:[]),
          ...(toolchain==="net"?["publish-native-aot","execute-native-aot-guest"]:[]),
          ...(toolchain==="java"?["execute-graal-guest"]:[])]
    },
    result:negative?{kind:"reject",diagnosticCode:"UNKNOWN_IDENTIFIER",
      diagnostic:(toolchain==="cranelift"?
        "orescranelift: unbound or unsupported identifier: ":
        "error: unresolved identifier ")+(caseId==="unknown-name"?
        "missing_platform_binding":"absent_platform_function")}:
      {kind:"pass",value:v.expectedValue},
    engine:toolchain==="cranelift"?
      {name:"native-cranelift-jit",compilerCommit:"d".repeat(40),
        compilerBinarySha256:HEX64,clifSha256:negative?null:"e".repeat(64)}:
      toolchain==="wasm"?
      {name:"llvm-to-wasm",upstreamCompilerRepo:"ores-truffle-oreslang/oreslang-source.llvm",
        upstreamCompilerCommit:"f".repeat(40),
        upstreamCompilerBinarySha256:"1".repeat(64),
        wasmModuleSha256:negative?null:"e".repeat(64),
        wasmHostBinarySha256:"2".repeat(64),
        zeroImports:negative?null:true}:
      toolchain==="net"?
      {name:"dotnet-nativeaot",nativeAotHostSha256:"e".repeat(64),
        compilerBinarySha256:HEX64,managedJitFallback:false}:
      toolchain==="java"?
      {name:"graal-truffle",guestEngineSha256:"3".repeat(64),runtimeVersion:"24.2.0"}:
      null
  };
}
const fails=(r,rx)=>assert.throws(()=>validateObservation(r,contract),rx);
const full=()=>PLATFORMS.flatMap(p=>contract.cases.flatMap(c=>
  TOOLCHAINS.map(b=>receipt(p,b,c.id))));
test("ten pinned native .ores fixtures are regular non-symlink files with matching SHA256",async()=>{
  assert.equal((await loadAndCheckCorpus()).cases.length,10);
  for(const c of contract.cases){
    const bytes=await readFile(join(root,"fixtures/platform-portability-v1",c.file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"),c.sha256,c.id);
  }
});
test("five toolchain lanes cover Java LLVM Wasm Cranelift and .NET",()=>{
  assert.deepEqual(TOOLCHAINS,["java","llvm","wasm","cranelift","net"]);
  assert.deepEqual(PLATFORMS,["mobile","desktop","embedded","iot","fpga","asic"]);
  assert.notEqual(contract.toolchains.cranelift.route,contract.toolchains.wasm.route);
  assert.equal(contract.toolchains.cranelift.compilerRepo,
    "ores-truffle-oreslang/oreslang-source.cranelift");
});
test("no backend or physical platform is certified from a checked-in manifest",()=>{
  const r=pendingMatrix(contract);
  assert.equal(r.status,"UNEXECUTED");
  assert.equal(r.requiredLanes,30);
  assert.equal(r.requiredCaseRuns,300);
  assert.equal(r.lanes.length,30);
  assert.ok(r.lanes.every(x=>x.status==="NOT_EXECUTED"));
  assert.equal(r.certifiedParity,false);
});
test("CLI keeps source-only checks separate from the required real guest gate",()=>{
  const cli=join(root,"bin/platform-portability-v1.mjs");
  const local=spawnSync(process.execPath,[cli],{encoding:"utf8"});
  assert.equal(local.status,0,local.stderr);
  const pending=JSON.parse(local.stdout);
  assert.equal(pending.status,"UNEXECUTED");
  assert.equal(pending.requiredCaseRuns,300);
  assert.equal(pending.certifiedParity,false);
  const required=spawnSync(process.execPath,[cli,"--require-executed"],{encoding:"utf8"});
  assert.equal(required.status,3);
  assert.match(required.stderr,/NOT_EXECUTED/);
  assert.equal(JSON.parse(required.stdout).certifiedParity,false);
  const invalid=spawnSync(process.execPath,[cli,"--claim-parity"],{encoding:"utf8"});
  assert.equal(invalid.status,2);
  assert.match(invalid.stderr,/ADMISSION_REJECTED/);
});
test("all six platform repositories have 30 unique pending lanes",()=>{
  const lanes=pendingMatrix(contract).lanes;
  assert.equal(new Set(lanes.map(l=>l.platform+":"+l.toolchain)).size,30);
  for(const p of PLATFORMS)assert.equal(lanes.filter(l=>l.platform===p).length,5);
});
test("required source coverage includes eight positive guest programs and two rejects",()=>{
  assert.equal(contract.cases.filter(x=>x.expect==="execute").length,8);
  assert.equal(contract.cases.filter(x=>x.expect==="reject").length,2);
});
test("all five toolchain observations remain structural, never authenticated",()=>{
  for(const b of TOOLCHAINS){
    const result=validateObservation(receipt("desktop",b),contract);
    assert.deepEqual(result,{status:"STRUCTURAL_OBSERVATION_ONLY",
      independentlyAuthenticated:false,certifiedParity:false});
  }
});
test("negative source checks require explicit primary identifier diagnostics",()=>{
  for(const b of TOOLCHAINS)for(const c of ["unknown-name","unknown-name-two"]){
    const x=receipt("iot",b,c);
    assert.equal(validateObservation(x,contract).certifiedParity,false);
    delete x.result.diagnostic;
    fails(x,/plain exact fields required/);
  }
});
test("negative diagnostics reject unrelated or echo-only error lines",()=>{
  for(const c of ["unknown-name","unknown-name-two"]){
    const x=receipt("iot","llvm",c);
    x.result.diagnostic="error: unrelated compiler failure";
    fails(x,/rejected identifier/);
    x.result.diagnostic="note: unknown identifier "+
      (c==="unknown-name"?"missing_platform_binding":"absent_platform_function");
    fails(x,/primary semantic diagnostic/);
  }
});

test("corpus mutations reject a substituted .ores payload",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"platform-ores-tamper-"));
  try{
    await mkdir(join(dir,"contracts"),{recursive:true});
    await mkdir(join(dir,"fixtures/platform-portability-v1"),{recursive:true});
    await writeFile(join(dir,"contracts/platform-portability-v1.json"),
      JSON.stringify(contract));
    for(const c of contract.cases)await writeFile(
      join(dir,"fixtures/platform-portability-v1",c.file),
      await readFile(join(root,"fixtures/platform-portability-v1",c.file)));
    await writeFile(join(dir,"fixtures/platform-portability-v1","scalar-42.ores"),
      "pub fnc main(): int { return 41 + 2; }\n");
    await assert.rejects(loadAndCheckCorpus(dir),/fixture SHA-256 mismatch/);
  }finally{await rm(dir,{recursive:true,force:true})}
});
test("corpus rejects extra or nonregular entries even when ten hashes match",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"platform-ores-inventory-"));
  const corpus=join(dir,"fixtures/platform-portability-v1");
  try{
    await mkdir(join(dir,"contracts"),{recursive:true});
    await mkdir(corpus,{recursive:true});
    await writeFile(join(dir,"contracts/platform-portability-v1.json"),JSON.stringify(contract));
    for(const v of contract.cases)
      await writeFile(join(corpus,v.file),
        await readFile(join(root,"fixtures/platform-portability-v1",v.file)));
    const foreign=join(corpus,"unexpected.ores");
    await writeFile(foreign,"pub fnc main(): int { return 0; }\\n");
    await assert.rejects(loadAndCheckCorpus(dir),/unexpected, missing or nonregular source fixture entry/);
    await rm(foreign);
    await mkdir(foreign);
    await assert.rejects(loadAndCheckCorpus(dir),/unexpected, missing or nonregular source fixture entry/);
    await rm(foreign,{recursive:true});
    const replaced=join(corpus,"scalar-42.ores");
    await rm(replaced);
    await mkdir(replaced);
    await assert.rejects(loadAndCheckCorpus(dir),/unexpected, missing or nonregular source fixture entry/);
  }finally{await rm(dir,{recursive:true,force:true})}
});
test("corpus rejects symbolic source substitution",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"platform-ores-symlink-"));
  try{
    await mkdir(join(dir,"contracts"),{recursive:true});
    await mkdir(join(dir,"fixtures/platform-portability-v1"),{recursive:true});
    await writeFile(join(dir,"contracts/platform-portability-v1.json"),JSON.stringify(contract));
    for(const c of contract.cases)await writeFile(
      join(dir,"fixtures/platform-portability-v1",c.file),
      await readFile(join(root,"fixtures/platform-portability-v1",c.file)));
    await rm(join(dir,"fixtures/platform-portability-v1","scalar-42.ores"));
    await symlink(join(root,"fixtures/platform-portability-v1","scalar-42.ores"),
      join(dir,"fixtures/platform-portability-v1","scalar-42.ores"));
    await assert.rejects(loadAndCheckCorpus(dir),/symlinked fixture/);
  }finally{await rm(dir,{recursive:true,force:true})}
});
test("missing toolchain and changed source hashes are not silently accepted",()=>{
  const a=structuredClone(contract);
  delete a.toolchains.net;assert.throws(()=>validateContract(a),/plain exact fields/);
  const b=structuredClone(contract);
  b.cases[0].sha256=HEX64;assert.throws(()=>validateContract(b),/identity drift/);
});
test("native Cranelift JIT is not interchangeable with the separate Wasm backend",()=>{
  const r=receipt("mobile","cranelift");r.engine=null;fails(r,/object required/);
  const n=receipt("mobile","cranelift");
  n.run.steps=n.run.steps.filter(x=>x!=="run-cranelift-native-jit");
  fails(n,/missing native Cranelift JIT and IR execution/);
});
test("all backends accept artifact-free negative diagnostics only as structural claims",()=>{
  for(const toolchain of TOOLCHAINS)for(const id of ["unknown-name","unknown-name-two"]){
    const r=receipt("desktop",toolchain,id);
    assert.equal(r.artifactSha256,null);
    const observation=validateObservation(r,contract);
    assert.equal(observation.status,"STRUCTURAL_OBSERVATION_ONLY");
    assert.equal(observation.certifiedParity,false);
    r.artifactSha256="e".repeat(64);
    fails(r,/unbound compiler\/source identity/);
  }
});
test("negative Cranelift and Wasm evidence cannot invent generated code artifacts",()=>{
  const cranelift=receipt("desktop","cranelift","unknown-name");
  cranelift.engine.clifSha256="e".repeat(64);
  fails(cranelift,/no fabricated CLIF for rejection/);
  const wasm=receipt("desktop","wasm","unknown-name");
  wasm.engine.wasmModuleSha256="e".repeat(64);
  fails(wasm,/no fabricated reject module/);
  const bogusImports=receipt("desktop","wasm","unknown-name");
  bogusImports.engine.zeroImports=true;
  fails(bogusImports,/no fabricated reject module/);
});
test("positive guest results still require real artifact-shaped digests",()=>{
  for(const toolchain of TOOLCHAINS){
    const x=receipt("desktop",toolchain,"scalar-42");
    x.artifactSha256=null;
    fails(x,/unbound compiler\/source identity/);
  }
});
test("Cranelift negative diagnostics require its actual compiler prefix",()=>{
  const x=receipt("iot","cranelift","unknown-name");
  assert.equal(validateObservation(x,contract).certifiedParity,false);
  x.result.diagnostic="error: unexpected identifier missing_platform_binding";
  fails(x,/primary semantic diagnostic/);
});
test("Cranelift native JIT CLIF identity binds the reported artifact",()=>{
  const r=receipt("desktop","cranelift");
  r.engine.clifSha256=HEX64;
  fails(r,/generated CLIF identity/);
});
test("Java LLVM Wasm and NativeAOT lanes cannot borrow Cranelift evidence",()=>{
  for(const backend of ["java","llvm","wasm","net"]){
    const r=receipt("desktop",backend);
    r.engine={name:"native-cranelift-jit",compilerCommit:HEX40,
      compilerBinarySha256:HEX64,clifSha256:HEX64};
    fails(r,backend==="llvm"?/unexpected engine evidence/:/plain exact fields/);
  }
});
test("Wasm guest cannot claim LLVM lowering without authenticated upstream compiler",()=>{
  const x=receipt("embedded","wasm");
  assert.equal(validateObservation(x,contract).certifiedParity,false);
  x.engine.upstreamCompilerRepo="ores-truffle-oreslang/oreslang-source.wasm";
  fails(x,/pinned LLVM frontend/);
  x.engine.upstreamCompilerRepo="ores-truffle-oreslang/oreslang-source.llvm";
  x.engine.zeroImports=false;
  fails(x,/zero-import module/);
});
test(".NET guest cannot use managed JIT as NativeAOT evidence",()=>{
  const x=receipt("mobile","net");
  x.engine.managedJitFallback=true;
  fails(x,/no managed JIT fallback/);
});
test("Graal guest requires real runtime digest and guest execution step",()=>{
  const x=receipt("desktop","java");
  x.engine.guestEngineSha256="missing";
  fails(x,/Truffle engine/);
  x.engine.guestEngineSha256="3".repeat(64);
  x.run.steps=x.run.steps.filter(s=>s!=="execute-graal-guest");
  fails(x,/missing Graal guest execution/);
});
test("Wasm and NativeAOT guest steps cannot be replaced by generic run markers",()=>{
  for(const [backend,removed,pattern] of [
    ["wasm","execute-wasm-guest",/compiled Wasm module execution/],
    ["net","execute-native-aot-guest",/NativeAOT build and guest execution/]
  ]){
    const x=receipt("iot",backend);
    x.run.steps=x.run.steps.filter(s=>s!==removed);
    fails(x,pattern);
  }
});
test("every target denies source-free canary and zero-step job impersonation",()=>{
  for(const toolchain of TOOLCHAINS){
    const sourceFree=receipt("desktop",toolchain);
    sourceFree.run.steps=["verify-exact-head","compile-ores-source","source-free-canary"];
    fails(sourceFree,/positive case requires guest execution step/);
    const zeroSteps=receipt("desktop",toolchain);
    zeroSteps.run.steps=[];
    fails(zeroSteps,/missing bounded executed compiler steps/);
    const zeroRunner=receipt("desktop",toolchain);
    zeroRunner.run.runnerId=0;
    fails(zeroRunner,/missing executed runner evidence/);
  }
});
test("all five target receipts reject wrong exact platform head or foreign repository",()=>{
  for(const toolchain of TOOLCHAINS){
    const wrongHead=receipt("embedded",toolchain);
    wrongHead.run.headSha="f".repeat(40);
    fails(wrongHead,/run repository\/head does not bind/);
    const crossOrg=receipt("embedded",toolchain);
    crossOrg.run.repository="external-ci/unapproved-carrier";
    fails(crossOrg,/run repository\/head does not bind/);
  }
});
test("native and AOT-looking observations remain claims, never authenticated receipts",()=>{
  for(const platform of PLATFORMS)for(const toolchain of TOOLCHAINS){
    const result=validateObservation(receipt(platform,toolchain),contract);
    assert.equal(result.independentlyAuthenticated,false);
    assert.equal(result.certifiedParity,false);
    assert.equal(result.status,"STRUCTURAL_OBSERVATION_ONLY");
  }
});

test("an unconfigured compiler cannot pass simply because the same host fixture exists",()=>{
  assert.deepEqual(compareObservations([],contract),{status:"INCOMPLETE",
    observed:0,missing:300,divergent:0,independentlyAuthenticated:false,certifiedParity:false});
});
test("299 structural receipts are incomplete even when all their results match",()=>{
  const all=full();all.pop();
  const result=compareObservations(all,contract);
  assert.equal(result.status,"INCOMPLETE");
  assert.equal(result.missing,1);
  assert.equal(result.certifiedParity,false);
});
test("an observed wrong guest result is divergent even with 299 missing receipts",()=>{
  const r=receipt("desktop","llvm","scalar-42");
  r.result.value=43;
  const comparison=compareObservations([r],contract);
  assert.equal(comparison.status,"DIVERGENT");
  assert.equal(comparison.observed,1);
  assert.equal(comparison.missing,299);
  assert.equal(comparison.divergent,1);
  assert.equal(comparison.independentlyAuthenticated,false);
  assert.equal(comparison.certifiedParity,false);
});
test("partial observations with mismatched source revisions are not merely incomplete",()=>{
  const java=receipt("iot","java","scalar-42");
  const llvm=receipt("iot","llvm","scalar-42");
  llvm.sourceCommit="9".repeat(40);
  const comparison=compareObservations([java,llvm],contract);
  assert.equal(comparison.status,"DIVERGENT");
  assert.equal(comparison.observed,2);
  assert.equal(comparison.missing,298);
  assert.equal(comparison.divergent,1);
  assert.equal(comparison.certifiedParity,false);
});
test("snapshot source commit drift across different platforms is divergent",()=>{
  const java=receipt("desktop","java","scalar-42");
  const llvm=receipt("iot","llvm","precedence-40");
  llvm.sourceCommit="9".repeat(40);
  const r=compareObservations([java,llvm],contract);
  assert.equal(r.status,"DIVERGENT");
  assert.equal(r.divergent,1);
  assert.equal(r.missing,298);
  assert.equal(r.certifiedParity,false);
});
test("mixed target heads within a platform are divergent even across case IDs",()=>{
  const java=receipt("desktop","java","scalar-42");
  const llvm=receipt("desktop","llvm","precedence-40");
  llvm.platformCommit="8".repeat(40);
  llvm.run.headSha=llvm.platformCommit;
  const r=compareObservations([java,llvm],contract);
  assert.equal(r.status,"DIVERGENT");
  assert.equal(r.divergent,1);
  assert.equal(r.certifiedParity,false);
});
test("compiler source commit drift across platforms is divergent within a backend",()=>{
  const first=receipt("desktop","llvm","scalar-42");
  const second=receipt("iot","llvm","precedence-40");
  second.compilerCommit="e".repeat(40);
  const r=compareObservations([first,second],contract);
  assert.equal(r.status,"DIVERGENT");
  assert.equal(r.divergent,1);
});
test("compiler binary drift across cases within one platform lane is divergent",()=>{
  const first=receipt("desktop","llvm","scalar-42");
  const second=receipt("desktop","llvm","precedence-40");
  second.compilerBinarySha256="9".repeat(64);
  const r=compareObservations([first,second],contract);
  assert.equal(r.status,"DIVERGENT");
  assert.equal(r.divergent,1);
});
test("per-target compiler binary builds can differ without being misclassified",()=>{
  const first=receipt("desktop","llvm","scalar-42");
  const second=receipt("iot","llvm","precedence-40");
  second.compilerBinarySha256="9".repeat(64);
  const r=compareObservations([first,second],contract);
  assert.equal(r.status,"INCOMPLETE");
  assert.equal(r.divergent,0);
  assert.equal(r.missing,298);
  assert.equal(r.certifiedParity,false);
});
test("partial matching observations still report incomplete, never certified",()=>{
  const comparison=compareObservations([receipt("iot","llvm","scalar-42")],contract);
  assert.equal(comparison.status,"INCOMPLETE");
  assert.equal(comparison.missing,299);
  assert.equal(comparison.divergent,0);
  assert.equal(comparison.certifiedParity,false);
});
test("300 caller-created matching observations cannot independently certify parity",()=>{
  const result=compareObservations(full(),contract);
  assert.equal(result.status,"OBSERVED_MATCH_NOT_CERTIFIED");
  assert.equal(result.observed,300);
  assert.equal(result.independentlyAuthenticated,false);
  assert.equal(result.certifiedParity,false);
});
test("one compiler result divergence is reported, not certified",()=>{
  const all=full();all.find(x=>x.platform==="iot"&&x.toolchain==="llvm"&&
    x.caseId==="scalar-42").result.value=43;
  const result=compareObservations(all,contract);
  assert.equal(result.status,"DIVERGENT");
  assert.equal(result.divergent,1);
});
test("unanimous wrong results are not valid parity",()=>{
  const all=full();for(const x of all)if(x.caseId==="scalar-42")x.result.value=43;
  const result=compareObservations(all,contract);
  assert.equal(result.status,"DIVERGENT");
  assert.equal(result.divergent,6);
});
test("duplicate backend/platform/case observations fail before comparison",()=>{
  const list=[receipt(),receipt()];
  assert.throws(()=>compareObservations(list,contract),/duplicate platform/);
});
test("cross-backend fixture source commits must match",()=>{
  const all=full();all.find(x=>x.platform==="desktop"&&x.toolchain==="net"&&
    x.caseId==="scalar-42").sourceCommit="b".repeat(40);
  assert.equal(compareObservations(all,contract).status,"DIVERGENT");
});
for(const [name,change,pattern] of [
  ["zero steps",x=>x.run.steps=[],/executed compiler steps/],
  ["no runner",x=>x.run.runnerId=0,/executed runner evidence/],
  ["noninteger run",x=>x.run.runId="123456",/executed runner evidence/],
  ["negative job ID",x=>x.run.jobId=-1,/executed runner evidence/],
  ["failed workflow",x=>x.run.conclusion="failure",/executed runner evidence/],
  ["queued workflow",x=>x.run.conclusion="queued",/executed runner evidence/],
  ["wrong platform SHA",x=>x.run.headSha="f".repeat(40),/run repository\/head/],
  ["wrong platform repo",x=>x.run.repository=contract.platforms.mobile,/run repository\/head/],
  ["source hash replaced",x=>x.fixtureSha256=HEX64,/unbound source fixture/],
  ["compiler repo swapped",x=>x.compilerRepo=contract.toolchains.java.compilerRepo,/unbound compiler/],
  ["compiler binary missing",x=>x.compilerBinarySha256="",/unbound compiler/],
  ["artifact digest missing",x=>x.artifactSha256="",/unbound compiler/],
  ["unknown backend",x=>x.toolchain="not-a-toolchain",/unknown platform or toolchain/],
  ["unknown platform",x=>x.platform="foreign",/unknown platform or toolchain/],
  ["unknown case",x=>x.caseId="synthetic",/unbound source fixture/],
  ["missing guest execution",x=>{x.run.steps=x.run.steps.filter(s=>s!=="run-ores-guest");x.run.steps.push("host-only-step");},/guest execution step/],
  ["fake guest result",x=>x.result={kind:"reject",diagnosticCode:"UNKNOWN_IDENTIFIER",diagnostic:"error: dummy"},/plain exact fields/],
  ["duplicate step",x=>x.run.steps.push("compile-ores-source"),/executed compiler steps/],
  ["getter field",x=>Object.defineProperty(x,"platform",{enumerable:true,get(){throw Error("GETTER EXECUTED")}}),/plain exact fields/],
  ["invented verified flag",x=>x.certifiedParity=true,/plain exact fields/],
]){
  test("negative receipt gate: "+name,()=>{
    const x=receipt();change(x);fails(x,pattern);
  });
}
for(const [name,change,pattern] of [
  ["fake certifiedParity",x=>x.certifiedParity=true,/cannot assert verification/],
  ["platform registry substituted",x=>x.platforms.iot="attacker/new-repo",/registry drift/],
  ["Cranelift route changed",x=>x.toolchains.cranelift.route="native-compiler",/backend route drift/],
  ["Cranelift compiler repo changed",x=>x.toolchains.cranelift.compilerRepo=
    "ores-truffle-oreslang/oreslang-source.llvm",/backend route drift/],
  ["missing positive case",x=>x.cases.pop(),/case count drift/],
  ["changed expected value",x=>x.cases[0].expectedValue=43,/positive oracle drift/],
  ["changed reject category",x=>x.cases[9].diagnostic="SYNTAX",/negative contract drift/],
  ["disabled independent review",x=>x.requirements.independentReviewRequired=false,/release gate weakened/],
  ["disabled transfer hold",x=>x.requirements.privateSourceExportHold=false,/release gate weakened/],
]){
  test("contract mutation gate: "+name,()=>{
    const x=structuredClone(contract);change(x);
    assert.throws(()=>validateContract(x),pattern);
  });
}
