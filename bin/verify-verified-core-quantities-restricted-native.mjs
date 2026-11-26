// Execute the identical eight generated multi-dimensional source fixtures
// with restricted native compilers. This is deliberately NOT the full corpus.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {expandQuantityCases} from "../lib/verified-core-quantity-expansion.mjs";
const [backend,compilerPath,includePath]=process.argv.slice(2);
assert.ok(["forge","cranelift"].includes(backend));
assert.ok(compilerPath);
assert.ok(backend!=="forge"||includePath);
const bindings=process.env.ATTO_VERIFIED_TYPED_BINDINGS==="1";
if(!bindings)assert.equal(process.env.ATTO_VERIFIED_CAST_ASCRIPTION,"1");
const compiler=resolve(compilerPath);
const include=includePath?resolve(includePath):"";
const original=fileURLToPath(new URL("../fixtures/verified-core-quantities-v1/",import.meta.url));
const manifest=JSON.parse(readFileSync(join(original,"cases.json"),"utf8"));
const work=mkdtempSync(join(tmpdir(),"atto-restricted-quantity-"));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const run=(cmd,args)=> {
  const r=spawnSync(cmd,args,{cwd:work,encoding:null,timeout:30000,maxBuffer:8*1024*1024});
  if(r.error)throw r.error;
  assert.equal(r.signal,null,cmd);
  return r;
};
const success=(r,id)=>assert.equal(r.status,0,id+": "+r.stderr.toString());
const expectedNames=["unit-add","unit-sub","unit-product-order","unit-velocity","unit-area","unit-mixed-add","unit-residual-dimension","unit-residual-area"].map(n=>"generated-boundary-"+n+".atto");
try{
 const {fixtures,cases}=expandQuantityCases(original,work,manifest);
 const selected=bindings?cases:cases.filter(c=>expectedNames.includes(c.source));
 const count=bindings?24:expectedNames.length;
 assert.equal(selected.length,count);
 const harness=join(work,"host.c");
 writeFileSync(harness,`#include <stdint.h>
#include <inttypes.h>
#include <stdio.h>
extern int32_t oreslang_scalar_entry(int64_t,int64_t,int64_t,int64_t,int64_t*);
int main(void){int64_t out=0;int32_t rc=oreslang_scalar_entry(0,0,0,0,&out);
if(rc){if(out!=0)return 99;return rc;}
printf("%" PRId64 "\\n",out);return 0;}`);
 for(const {source,expected} of selected){
   const input=join(fixtures,source);
   const output=join(work,source+(backend==="forge"?".cpp":".o"));
   const binary=join(work,source+".guest");
   const compiled=backend==="forge"?run(compiler,[input,"-o",output]):run(compiler,["emit-object",input]);
   if(expected.kind==="diagnostic"){
     assert.equal(compiled.status,backend==="forge"?2:1,source);
     assert.equal(compiled.stdout.length,0,source);
     assert.equal(existsSync(output),false,source);
     if(!bindings&&backend==="cranelift")assert.ok(compiled.stderr.toString().includes(expected.category+":"),source);
     if(bindings)assert.ok(compiled.stderr.length>0,source);
     // Forge currently has generic parser diagnostics. Rejection is proven,
     // but diagnostic-category parity must remain explicitly unverified.
   }else{
     assert.ok(["value","arithmeticFailure","refinementFailure"].includes(expected.kind));
     success(compiled,source);
     if(backend==="cranelift"){
       assert.ok(compiled.stdout.length>0,source);
       writeFileSync(output,compiled.stdout,{flag:"wx"});
       success(run("cc",["-std=c11","-Wall","-Werror",harness,output,"-o",binary]),source+" link");
     }else{
       assert.ok(existsSync(output),source);
       success(run(process.env.CXX||"c++",["-std=c++20","-Wall","-Wextra","-Werror","-fsanitize=undefined","-fno-sanitize-recover=all","-I"+include,output,"-o",binary]),source+" link");
     }
     const guest=run(binary,[]);
     if(expected.kind==="value"){
       success(guest,source+" guest");
       assert.equal(guest.stdout.toString().trim(),expected.decimal,source);
       assert.equal(guest.stderr.length,0,source);
     }else{
       const codes=backend==="forge"?{integerOverflow:70,divisionByZero:71,refinementViolation:73}:{integerOverflow:1,divisionByZero:2,refinementViolation:7};
       assert.equal(guest.status,codes[expected.category],source);
       assert.equal(guest.stdout.length,0,source);
       if(backend==="forge")assert.equal(guest.stderr.toString().trim(),{integerOverflow:"E_OVERFLOW",divisionByZero:"E_DIVZERO",refinementViolation:"E_REFINEMENT_VIOLATION"}[expected.category],source);
     }
   }
   console.log("PASS "+backend+" "+source+" "+expected.kind+" "+sha(readFileSync(input)));
 }
 console.log("VERIFIED_RESTRICTED_SUBSET "+backend+" "+selected.length+"/"+count+" diagnostic_categories="+(bindings||backend==="forge"?"partial":"verified"));
}finally{rmSync(work,{recursive:true,force:true});}
