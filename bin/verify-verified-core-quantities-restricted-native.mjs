// Execute identical shared quantity fixtures through native Forge and Cranelift.
// Full mode reports every mismatch and fails if any case is not exact.
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
const full=process.env.ATTO_FULL_NATIVE_QUANTITIES==="1";
assert.ok(!(bindings&&full),"select exactly one corpus mode");
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
 const selected=(full||bindings)?cases:cases.filter(c=>expectedNames.includes(c.source));
 assert.equal(selected.length,bindings?36:full?151:expectedNames.length);
 let passed=0;const failures=[];
 const harness=join(work,"host.c");
 writeFileSync(harness,`#include <stdint.h>
#include <inttypes.h>
#include <stdio.h>
extern int32_t oreslang_scalar_entry(int64_t,int64_t,int64_t,int64_t,int64_t*);
int main(void){int64_t out=0;int32_t rc=oreslang_scalar_entry(0,0,0,0,&out);
if(rc){if(out!=0)return 99;return rc;}
printf("%" PRId64 "\\n",out);return 0;}`);
 for(const {source,expected} of selected){
   try {
   const input=join(fixtures,source);
   const output=join(work,source+(backend==="forge"?".cpp":".o"));
   const binary=join(work,source+".guest");
   const compiled=backend==="forge"?run(compiler,[input,"-o",output]):run(compiler,["emit-object",input]);
   if(expected.kind==="diagnostic"){
     assert.equal(compiled.status,backend==="forge"?2:1,source);
     assert.equal(compiled.stdout.length,0,source);
     assert.equal(existsSync(output),false,source);
     if(bindings){assert.ok(compiled.stderr.length>0,source);}
     else if(full||backend==="cranelift")assert.match(compiled.stderr.toString(),new RegExp('(?:^|\\s)'+expected.category+'(?:[:\\s]|$)'),source);
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
       assert.equal(guest.stdout.toString(),expected.decimal+"\n",source);
       assert.equal(guest.stderr.length,0,source);
     }else{
       const statuses=backend==="forge"?{divisionByZero:71,integerOverflow:70,refinementViolation:73}:{divisionByZero:2,integerOverflow:1,refinementViolation:7};
       assert.ok(Object.hasOwn(statuses,expected.category));
       assert.equal(guest.status,statuses[expected.category],source);
       assert.equal(guest.stdout.length,0,source);
       assert.equal(guest.stderr.toString(),backend==="forge"?{divisionByZero:"E_DIVZERO\n",integerOverflow:"E_OVERFLOW\n",refinementViolation:"E_REFINEMENT_VIOLATION\n"}[expected.category]:"",source);
     }
   }
   console.log("PASS "+backend+" "+source+" "+expected.kind+" "+sha(readFileSync(input)));passed++;
   }catch(e){failures.push(source);console.error("FAIL "+backend+" "+source+" "+String(e.message));}
 }
 console.log("NATIVE_QUANTITY_RESULT "+backend+" "+passed+"/"+selected.length+" diagnostic_categories="+(bindings||(!full&&backend==="forge")?"partial":"verified")+" failures="+JSON.stringify(failures));
 assert.equal(failures.length,0,"shared native corpus failed");
}finally{rmSync(work,{recursive:true,force:true});}
