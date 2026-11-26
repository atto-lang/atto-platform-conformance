// Explicit target adapters only; a missing adapter or unsupported source is
// not a passed test. Run from a trusted checkout, not a privileged workflow.
import assert from "node:assert/strict";
import {validateStrictManifest} from "./verified-strict-manifest.mjs";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {delimiter,join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
const [target,path,tier="all",bridgePath,pin]=process.argv.slice(2);
if(!["rs","js","wasm","forge","cranelift","java","llvm"].includes(target)||!path||!["arithmetic","control-flow","loops","boundaries","guards","lazy-helpers","full-width","mutable-rebinding","all"].includes(tier))throw Error("usage: node bin/verify-verified-core-strict-i64.mjs rs|js|wasm|forge|cranelift|java|llvm <compiler binary or checkout> [arithmetic|control-flow|loops|boundaries|guards|lazy-helpers|full-width|mutable-rebinding|all] [Wasm bridge checkout or Forge include path] [compiler sha256]");
if(target==="wasm"&&(!bridgePath||!/^[a-f0-9]{64}$/.test(pin??"")))throw Error("Wasm requires exact compiler digest and bridge checkout");
const manifest=JSON.parse(readFileSync(new URL("../fixtures/verified-core-strict-i64-v1/cases.json",import.meta.url),"utf8"));
validateStrictManifest(manifest);
const cases=manifest.cases.filter(c=>tier==="all"||c.tier===tier);
assert.ok(cases.length);
// Java/LLVM currently expose guest values as OS exit status, not a full-width scalar result.
// Full-width tier opts into the explicit guest result transport; legacy tiers retain the checked process-status contract.
const hash=x=>createHash("sha256").update(x).digest("hex");
const dir=mkdtempSync(join(tmpdir(),"atto-strict-parity-"));
try {
 const compile=target==="js"?(await import(pathToFileURL(join(resolve(path),"src/program-v2.mjs")).href)).compileVerifiedStrict:null;
 if(target==="js")assert.equal(typeof compile,"function","strict API missing");
 let javaArgs=null;
 if(target==="java"){
  const checkout=resolve(path),dep=join(dir,"classpath");
  const build=spawnSync("mvn",["-q","-DskipTests","compile","dependency:build-classpath","-Dmdep.outputFile="+dep],{cwd:checkout,encoding:"utf8",timeout:240000,maxBuffer:8*1024*1024});
  if(build.error)throw build.error;
  assert.equal(build.status,0,build.stdout+build.stderr);
  javaArgs=["--enable-native-access=ALL-UNNAMED","-Dpolyglot.engine.WarnInterpreterOnly=false","-cp",join(checkout,"target/classes")+delimiter+readFileSync(dep,"utf8").trim(),"dev.oreslang.launcher.OresMain","--verify=strict"];
 }
 let browser=null;
 if(target==="wasm"){
  const bytes=readFileSync(resolve(path));
  assert.ok(bytes.length>8&&bytes.length<=16*1024*1024);
  assert.equal(hash(bytes),pin,"compiler digest mismatch");
  const module=new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module),[]);
  assert.ok(WebAssembly.Module.exports(module).some(e=>e.name==="compile_strict_i64"&&e.kind==="function"),"strict ABI missing");
  const {createCompiler}=await import(pathToFileURL(join(resolve(bridgePath),"src/canonical-browser-compiler.mjs")).href);
  browser=await createCompiler(bytes);
 }
 for(const {id,source,expected,tier:caseTier} of cases){
  assert.match(id,/^[a-z0-9-]+$/);
  let diagnostic=null,artifact=null;
  if(target==="java"){
   const input=join(dir,id+".atto");writeFileSync(input,source,{flag:"wx"});
   const run=args=>{const v=spawnSync("java",[...javaArgs,...args],{cwd:resolve(path),encoding:"utf8",timeout:30000,maxBuffer:8*1024*1024});if(v.error)throw v.error;assert.equal(v.signal,null,id);return v;};
   const check=run(["--check",input]);
   const fullWidth=caseTier==="full-width";
   const guest=run(fullWidth?["--print-i64",input]:[input]);
   if(expected.kind==="diagnostic"){
    assert.equal(check.status,1,id);assert.equal(guest.status,1,id);
    for(const v of [check,guest]){assert.ok(v.stderr.includes(expected.category+":"),id+": "+v.stderr);assert.equal(v.stdout,"",id);}
   }else{
    assert.equal(check.status,0,id+": "+check.stderr);
    assert.equal(guest.status,fullWidth?0:Number(expected.decimal),id+": "+guest.stderr);
    assert.equal(guest.stdout,fullWidth?expected.decimal+"\n":"",id);
    assert.equal(guest.stderr,"",id);
   }
   console.log("PASS",target,id,"source",hash(source),"Truffle checked-guest",expected.kind);
   continue;
  }else if(target==="llvm"){
   const input=join(dir,id+".atto"),output=join(dir,id+".ll");
   writeFileSync(input,source,{flag:"wx"});
   const r=spawnSync(resolve(path),(caseTier==="full-width"?["--verify=strict","--print-i64",input]:["--verify=strict",input]),{cwd:dir,encoding:"utf8",timeout:30000,maxBuffer:8*1024*1024});
   if(r.error)throw r.error;
   assert.equal(r.signal,null,id);
   if(r.status===0){assert.match(r.stdout,/define .*@main\(/,id);artifact=Buffer.from(r.stdout);writeFileSync(output,artifact,{flag:"wx"});}
   else {assert.equal(r.status,1,id);assert.equal(r.stdout,"",id);diagnostic=r.stderr;}
  }else if(target==="forge"||target==="cranelift"){
   const input=join(dir,id+".atto"),output=join(dir,id+(target==="forge"?".cpp":".o"));
   writeFileSync(input,source,{flag:"wx"});
   const forge=target==="forge";
   const r=spawnSync(resolve(path),forge?["--verify=strict",input,"-o",output]:["emit-object-strict",input],{cwd:dir,encoding:forge?"utf8":null,timeout:30000,maxBuffer:8*1024*1024});
   if(r.error)throw r.error;
   assert.equal(r.signal,null,id);
   if(r.status===0){
    if(forge)assert.ok(existsSync(output),id);
    else {assert.ok(r.stdout.length>0,id);writeFileSync(output,r.stdout,{flag:"wx"});}
    artifact=readFileSync(output);
   }else{
    assert.equal(r.status,forge?2:1,id);
    assert.equal(existsSync(output),false,id);
    assert.equal(r.stdout.length,0,id+" rejected source emitted bytes");
    assert.equal(existsSync(output+".part"),false,id);
    diagnostic=String(r.stderr);
   }
  }else if(target==="rs"){
   const input=join(dir,id+".atto"),output=join(dir,id+".wasm");
   writeFileSync(input,source,{flag:"wx"});
   const r=spawnSync(resolve(path),["--verify=strict",input,"-o",output],{cwd:dir,encoding:"utf8",timeout:30000});
   if(r.error)throw r.error;
   assert.equal(r.signal,null,id);
   if(r.status===0){assert.ok(existsSync(output),id);artifact=readFileSync(output);}
   else {assert.equal(r.status,1,id);assert.equal(existsSync(output),false,id);diagnostic=r.stderr;}
  }else if(target==="wasm"){
   const result=browser.compile(source,"wasm","strict");
   if(result.ok){assert.ok(result.wasm instanceof Uint8Array);artifact=result.wasm;}
   else{
    assert.equal(Object.hasOwn(result,"wasm"),false,id);
    assert.equal(Object.hasOwn(result,"esm"),false,id);
    assert.equal(result.diagnostics.length,1,id);
    diagnostic=result.diagnostics[0].message;
   }
  }else{
   try{artifact=compile(source);}catch(e){diagnostic=String(e.message);}
  }
  if(expected.kind==="diagnostic"){
   assert.equal(artifact,null,id);
   assert.ok(diagnostic?.includes(expected.category+":")||(target==="forge"&&diagnostic?.includes(expected.category+" byte=")),id+": "+diagnostic);
  }else{
   assert.equal(diagnostic,null,id+": "+diagnostic);
   assert.equal(expected.kind,"value");
   if(target==="llvm"){
    const guest=join(dir,id+".native");
    const link=spawnSync(bridgePath||"clang",[join(dir,id+".ll"),"-o",guest],{cwd:dir,encoding:"utf8",timeout:60000});
    if(link.error)throw link.error;assert.equal(link.status,0,id+": "+link.stderr);
    const g=spawnSync(guest,[],{cwd:dir,encoding:"utf8",timeout:10000});
    if(g.error)throw g.error;assert.equal(g.signal,null,id);assert.equal(g.status,caseTier==="full-width"?0:Number(expected.decimal),id+": "+g.stderr);
    if(caseTier==="full-width"){assert.equal(g.stdout,expected.decimal+"\n",id);assert.equal(g.stderr,"",id);}
   }else if(target==="forge"||target==="cranelift"){
    const forge=target==="forge",output=join(dir,id+(forge?".cpp":".o")),guest=join(dir,id+".native");
    let args;
    if(forge){
     assert.ok(bridgePath,"Forge include path required");
     args=["-std=c++20","-Wall","-Wextra","-Werror","-I"+resolve(bridgePath),output,"-o",guest];
    }else{
     const harness=join(dir,id+".c");
     writeFileSync(harness,"#include <stdint.h>\n#include <stdio.h>\nextern int32_t oreslang_scalar_entry(int64_t,int64_t,int64_t,int64_t,int64_t*);\nint main(void){int64_t out=123;int rc=oreslang_scalar_entry(0,0,0,0,&out);if(rc!=0)return 1;printf(\"%lld\\n\",(long long)out);return 0;}\n");
     args=["-std=c11","-Wall","-Werror",harness,output,"-o",guest];
    }
    const link=spawnSync(forge?(process.env.CXX||"c++"):"cc",args,{cwd:dir,encoding:"utf8",timeout:60000});
    if(link.error)throw link.error;
    assert.equal(link.status,0,id+": "+link.stderr);
    const g=spawnSync(guest,[],{cwd:dir,encoding:"utf8",timeout:10000});
    if(g.error)throw g.error;
    assert.equal(g.signal,null,id);
    assert.equal(g.status,0,id+": "+g.stderr);
    assert.equal(g.stderr,"",id);
    assert.equal(g.stdout,expected.decimal+"\n",id);
   }else if(target==="rs"||target==="wasm"){
    const m=new WebAssembly.Module(artifact);
    assert.deepEqual(WebAssembly.Module.imports(m),[],id);
    const g=new WebAssembly.Instance(m,{});
    assert.equal(g.exports.main(),BigInt(expected.decimal),id);
    assert.equal(g.exports.panic_code.value,0,id);
   }else{
    const g=await import("data:text/javascript;base64,"+Buffer.from(artifact).toString("base64"));
    assert.equal(g.main(),BigInt(expected.decimal),id);
   }
  }
  console.log("PASS",target,id,"source",hash(source),"artifact",artifact===null?"none":hash(artifact));
 }
 console.log("VERIFIED_STRICT_I64",target,tier,cases.length);
}finally{rmSync(dir,{recursive:true,force:true});}
