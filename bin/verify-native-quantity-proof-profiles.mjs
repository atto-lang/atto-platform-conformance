// Run identical shared helper, refinement and strict proof cases via emitted native artifacts.
// No unsupported rejection is counted as proof unless the exact manifest asks for a generic denial.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {typedBindingCases} from "../lib/verified-typed-helper-corpus.mjs";
const [backend,compilerPath,includePath]=process.argv.slice(2);
assert.ok(["forge","cranelift"].includes(backend));assert.ok(compilerPath);
assert.ok(backend!=="forge"||includePath);
const compiler=resolve(compilerPath),include=includePath?resolve(includePath):"";
const root=fileURLToPath(new URL("../fixtures/",import.meta.url));
const refinementRoot=join(root,"verified-core-refinements-v1");
const refinement=JSON.parse(readFileSync(join(refinementRoot,"cases.json"),"utf8")).cases.map(c=>({...c,text:readFileSync(join(refinementRoot,c.source),"utf8")}));
const strict=JSON.parse(readFileSync(join(root,"verified-core-strict-i64-v1/cases.json"),"utf8")).cases.map(c=>({source:c.id+".atto",text:c.source,expected:c.expected}));
const work=mkdtempSync(join(tmpdir(),"atto-native-proof-"));
const sha=b=>createHash("sha256").update(b).digest("hex");
const run=(cmd,args)=>{
 const r=spawnSync(cmd,args,{cwd:work,encoding:null,timeout:30000,maxBuffer:8*1024*1024});
 if(r.error)throw r.error;assert.equal(r.signal,null,cmd);return r;
};
const ok=(r,id)=>assert.equal(r.status,0,id+": "+r.stderr.toString());
const harness=join(work,"host.c");
writeFileSync(harness,`#include <stdint.h>
#include <inttypes.h>
#include <stdio.h>
extern int32_t oreslang_scalar_entry(int64_t,int64_t,int64_t,int64_t,int64_t*);
int main(void){int64_t out=1234567;int32_t rc=oreslang_scalar_entry(0,0,0,0,&out);
if(rc){if(out!=1234567)return 99;return rc;}
printf("%" PRId64 "\\n",out);return 0;}`);
const statuses=backend==="forge"?{divisionByZero:71,integerOverflow:70,refinementViolation:73,i32Overflow:74}:{divisionByZero:2,integerOverflow:1,refinementViolation:7,i32Overflow:8};
const errors={divisionByZero:"E_DIVZERO\n",integerOverflow:"E_OVERFLOW\n",refinementViolation:"E_REFINEMENT_VIOLATION\n",i32Overflow:"E_I32_OVERFLOW\n"};
const results=[];
try{
 for(const [profile,cases,isStrict] of [["helpers",typedBindingCases,false],["refinements",refinement,false],["strict",strict,true]]){
  const failures=[];let passed=0,genericDenials=0;
  for(const {source,text,expected} of cases){
   try{
    assert.match(source,/^[a-z0-9-]+\.atto$/);
    const input=join(work,profile+"-"+source);
    const output=input+(backend==="forge"?".cpp":".o");
    const binary=input+".guest";
    writeFileSync(input,text,{flag:"wx"});
    const c=backend==="forge"?run(compiler,[...(isStrict?["--verify=strict"]:[]),input,"-o",output]):run(compiler,[isStrict?"emit-object-strict":"emit-object",input]);
    if(expected.kind==="diagnostic"){
     assert.equal(c.status,backend==="forge"?2:1,source+": "+c.stderr.toString());
     assert.equal(c.stdout.length,0);assert.ok(!existsSync(output));assert.ok(c.stderr.length>0);
     if(expected.category!==null)assert.match(c.stderr.toString(),new RegExp("(?:^|\\s)"+expected.category+"(?:[:\\s]|$)"));
     else genericDenials++;
    }else{
     ok(c,source);
     if(backend==="cranelift"){assert.ok(c.stdout.length);writeFileSync(output,c.stdout,{flag:"wx"});ok(run("cc",["-std=c11","-Wall","-Werror",harness,output,"-o",binary]),source+" link");}
     else{assert.ok(existsSync(output));ok(run(process.env.CXX||"c++",["-std=c++20","-Wall","-Wextra","-Werror","-fsanitize=undefined","-fno-sanitize-recover=all","-I"+include,output,"-o",binary]),source+" link");}
     const g=run(binary,[]);
     if(expected.kind==="value"){ok(g,source);assert.equal(g.stdout.toString(),expected.decimal+"\n");assert.equal(g.stderr.length,0);}
     else{assert.ok(Object.hasOwn(statuses,expected.category),"unimplemented trap oracle: "+expected.category);assert.equal(g.status,statuses[expected.category]);assert.equal(g.stdout.length,0);assert.equal(g.stderr.toString(),backend==="forge"?errors[expected.category]:"");}
    }
    passed++;console.log("PROOF_PASS "+backend+" "+profile+" "+source+" "+expected.kind+" "+sha(text));
   }catch(e){failures.push(source);console.error("PROOF_FAIL "+backend+" "+profile+" "+source+" "+String(e.message));}
  }
  const result={backend,profile,passed,total:cases.length,genericDenials,failures};results.push(result);console.log("PROOF_RESULT "+JSON.stringify(result));
 }
 assert.ok(results.every(r=>r.failures.length===0),"shared proof profiles incomplete");
}finally{rmSync(work,{recursive:true,force:true});}
