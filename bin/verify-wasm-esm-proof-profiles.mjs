// Audit unchanged shared refinement cases through actual emitted Wasm or ESM.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {typedBindingCases} from "../lib/verified-typed-helper-corpus.mjs";
const [backend,path]=process.argv.slice(2);
assert.ok(["rust","js"].includes(backend)&&path);
const compiler=resolve(path);
const js=backend==="js"?await import(pathToFileURL(join(compiler,"src/program-v2.mjs"))):null;
const dir=fileURLToPath(new URL("../fixtures/verified-core-refinements-v1/",import.meta.url));
const cases=JSON.parse(readFileSync(join(dir,"cases.json"),"utf8")).cases.map(c=>({...c,text:readFileSync(join(dir,c.source),"utf8")}));
assert.equal(cases.length,49);
const work=mkdtempSync(join(tmpdir(),"atto-proof-wasm-esm-"));
const sha=x=>createHash("sha256").update(x).digest("hex");
// Match existing compiler ABI, never treat an arbitrary trap as a pass.
// Narrow overflow may be a separate ABI; absent support remains a failure.
const codes={integerOverflow:1,divisionByZero:2,refinementViolation:7,i32Overflow:8};
const jsCodes={integerOverflow:"integer_overflow",divisionByZero:"division_by_zero",refinementViolation:"refinement_violation",i32Overflow:"i32_overflow"};
let totalFailures=0;
try{
 for(const [profile,list] of [["refinements",cases],["helpers",typedBindingCases]]){
  let passed=0;const failures=[];
  for(const {source,text,expected} of list){
   try{
    assert.match(source,/^[a-z0-9-]+\.atto$/);
    if(js){
     if(expected.kind==="diagnostic"){
      assert.throws(()=>js.compileProgramV2(text),e=>expected.category===null?String(e.message).length>0:String(e.message).includes(expected.category+":"),source);
     }else{
      const emitted=js.compileProgramV2(text);
      const m=await import("data:text/javascript;base64,"+Buffer.from(emitted).toString("base64"));
      assert.deepEqual(Object.keys(m),["main"]);
      if(expected.kind==="value")assert.equal(m.main(),BigInt(expected.decimal));
      else{assert.ok(Object.hasOwn(jsCodes,expected.category));assert.throws(()=>m.main(),e=>e.code===jsCodes[expected.category]);}
     }
    }else{
     const input=join(work,profile+"-"+source),output=input+".wasm";
     writeFileSync(input,text,{flag:"wx"});
     const c=spawnSync(compiler,[input,"-o",output],{cwd:work,encoding:"utf8",timeout:30000,maxBuffer:1024*1024});
     if(c.error)throw c.error;assert.equal(c.signal,null);
     if(expected.kind==="diagnostic"){
      assert.equal(c.status,1,c.stderr);assert.ok(!existsSync(output));assert.equal(c.stdout,"");
      const prefix=input+": ";const lines=c.stderr.trim().split(/\r?\n/);assert.equal(lines.length,1);assert.ok(lines[0].startsWith(prefix));
      const category=lines[0].slice(prefix.length).match(/^\d+:\d+: ([A-Z0-9_]+): /)?.[1];
      if(expected.category===null)assert.ok(category);else assert.equal(category,expected.category);
     }else{
      assert.equal(c.status,0,c.stderr);const mod=new WebAssembly.Module(readFileSync(output));
      assert.deepEqual(WebAssembly.Module.imports(mod),[]);
      const g=new WebAssembly.Instance(mod,{}).exports;assert.equal(g.panic_code.value,0);
      if(expected.kind==="value"){assert.equal(g.main(),BigInt(expected.decimal));assert.equal(g.panic_code.value,0);}
      else{assert.ok(Object.hasOwn(codes,expected.category));assert.throws(()=>g.main(),WebAssembly.RuntimeError);assert.equal(g.panic_code.value,codes[expected.category]);}
     }
    }
    passed++;console.log("PROOF_PASS "+backend+" "+profile+" "+source+" "+expected.kind+" "+sha(text));
   }catch(e){failures.push(source);console.error("PROOF_FAIL "+backend+" "+profile+" "+source+" "+String(e.message));}
  }
  totalFailures+=failures.length;
  console.log("PROOF_RESULT "+JSON.stringify({backend,profile,passed,total:list.length,failures}));
 }
 assert.equal(totalFailures,0,"shared proof profiles incomplete");
}finally{rmSync(work,{recursive:true,force:true});}
