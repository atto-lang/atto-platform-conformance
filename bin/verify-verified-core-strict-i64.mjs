// Explicit target adapters only; a missing adapter or unsupported source is
// not a passed test. Run from a trusted checkout, not a privileged workflow.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
const [target,path,tier="all",bridgePath,pin]=process.argv.slice(2);
if(!["rs","js","wasm"].includes(target)||!path||!["arithmetic","control-flow","loops","all"].includes(tier))throw Error("usage: node bin/verify-verified-core-strict-i64.mjs rs|js|wasm <attoc binary|JS checkout|compiler.wasm> [arithmetic|control-flow|loops|all] [Wasm bridge checkout] [compiler sha256]");
if(target==="wasm"&&(!bridgePath||!/^[a-f0-9]{64}$/.test(pin??"")))throw Error("Wasm requires exact compiler digest and bridge checkout");
const manifest=JSON.parse(readFileSync(new URL("../fixtures/verified-core-strict-i64-v1/cases.json",import.meta.url),"utf8"));
assert.equal(manifest.schemaVersion,1);assert.equal(manifest.profile,"verified-core-strict-i64-v1");
const cases=manifest.cases.filter(c=>tier==="all"||c.tier===tier);
assert.ok(cases.length);
const hash=x=>createHash("sha256").update(x).digest("hex");
const dir=mkdtempSync(join(tmpdir(),"atto-strict-parity-"));
try {
 const compile=target==="js"?(await import(pathToFileURL(join(resolve(path),"src/program-v2.mjs")).href)).compileVerifiedStrict:null;
 if(target==="js")assert.equal(typeof compile,"function","strict API missing");
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
 for(const {id,source,expected} of cases){
  assert.match(id,/^[a-z0-9-]+$/);
  let diagnostic=null,artifact=null;
  if(target==="rs"){
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
   assert.ok(diagnostic?.includes(expected.category+":"),id+": "+diagnostic);
  }else{
   assert.equal(diagnostic,null,id+": "+diagnostic);
   assert.equal(expected.kind,"value");
   if(target==="rs"||target==="wasm"){
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
