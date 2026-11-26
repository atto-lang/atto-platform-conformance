// Hardware-specific negative admission; not software compiler parity.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
import {typedBindingCases} from "../lib/verified-typed-helper-corpus.mjs";
const [checkout]=process.argv.slice(2);
assert.ok(checkout&&process.argv.length===3);
const root=resolve(checkout),cli=join(root,"bin/oreslang-hdl.mjs"),work=mkdtempSync(join(tmpdir(),"atto-hdl-helper-denial-"));
const run=(source,output)=>{
 const result=spawnSync(process.execPath,[cli,source,output],{cwd:work,encoding:"utf8",timeout:10000,maxBuffer:1024*1024});
 if(result.error)throw result.error;
 assert.equal(result.signal,null);
 return result;
};
try{
 const positive=join(work,"control.sv");
 const control=run(join(root,"tests/fixtures/add8.atto"),positive);
 assert.equal(control.status,0,control.stderr);
 assert.ok(readFileSync(positive,"utf8").includes("module"));
 assert.equal(typedBindingCases.length,24);
 for(const {source,text} of typedBindingCases){
  assert.match(source,/^generated-binding-helper-[a-z-]+\.atto$/);
  const path=join(work,source),out=join(work,source+".sv");
  writeFileSync(path,text,{flag:"wx"});
  const result=run(path,out);
  assert.equal(result.status,1,source+": "+result.stderr);
  assert.ok(result.stderr.trim().length>0,source);
  assert.equal(result.stdout,"",source);
  assert.equal(existsSync(out),false,source+" published unsupported RTL");
  console.log("HDL_UNSUPPORTED_REJECT "+source+" "+createHash("sha256").update(text).digest("hex"));
 }
 console.log("HDL_UNSUPPORTED_VERIFIED 24/24; positive fixed-width RTL emission control passed; no signed-i64 helper support claim");
}finally{rmSync(work,{recursive:true,force:true});}
