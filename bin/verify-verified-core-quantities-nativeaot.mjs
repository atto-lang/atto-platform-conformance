// Actual NativeAOT compiler and separately published native guest per case.
// Shards select the same deterministic expanded corpus, not rewritten fixtures.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync,mkdirSync,existsSync,rmSync,statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {expandQuantityCases} from "../lib/verified-core-quantity-expansion.mjs";
const [checkout,shardText,countText]=process.argv.slice(2);
const shard=Number(shardText),count=Number(countText);
assert.ok(checkout && Number.isInteger(shard) && Number.isInteger(count) && count>0 && count<=16 && shard>=0 && shard<count);
const bindings=process.env.ATTO_VERIFIED_TYPED_BINDINGS==="1";
if(!bindings)assert.equal(process.env.ATTO_VERIFIED_CAST_ASCRIPTION,"1");
const root=resolve(checkout),work=mkdtempSync(join(tmpdir(),"atto-nativeaot-quantity-"));
const profile="verified-core-quantities-v1";
const original=fileURLToPath(new URL("../fixtures/"+profile+"/",import.meta.url));
const manifest=JSON.parse(readFileSync(join(original,"cases.json"),"utf8"));
assert.equal(manifest.profile,profile);assert.equal(manifest.schemaVersion,1);
const sha=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
const run=(command,args,timeout=300000)=>{
 const r=spawnSync(command,args,{cwd:root,encoding:"utf8",timeout,maxBuffer:16*1024*1024});
 if(r.error)throw r.error;assert.equal(r.signal,null,command);return r;
};
const ok=(r,id)=>assert.equal(r.status,0,id+": "+r.stdout+r.stderr);
const rid="linux-x64",base=["-c","Release","-r",rid,"-p:PublishAot=true","-warnaserror"];
const compilerDir=join(work,"compiler"),compiler=join(compilerDir,"oresnet");
const host=join(root,"host/Ores.Net.NativeHost/Ores.Net.NativeHost.csproj");
const verify=exe=>ok(run("bash",["verification/assert-linux-native-release.sh",exe]),exe);
const errors={divisionByZero:"Oreslang division by zero",integerOverflow:"Oreslang arithmetic overflow",refinementViolation:"Oreslang refinement check failed"};
try{
 const {fixtures,cases}=expandQuantityCases(original,work,manifest);
 assert.equal(cases.length,bindings?36:151);
 const selected=cases.filter((_,i)=>i%count===shard);
 assert.ok(selected.length>0);
 ok(run("dotnet",["publish","compiler/Ores.Net.Compiler/Ores.Net.Compiler.csproj",...base,"-o",compilerDir]),"NativeAOT compiler");
 verify(compiler);
 console.log("NATIVE_COMPILER_SHA256 "+sha(compiler));
 for(const {source,expected} of selected){
  assert.match(source,/^[a-z0-9-]+\.atto$/);
  const caseDir=join(work,source);mkdirSync(caseDir);
  const input=join(fixtures,source),assembly=join(caseDir,"OresGenerated.dll");
  const compiled=run(compiler,["compile",input,"--out",assembly],30000);
  if(expected.kind==="diagnostic"){
   assert.equal(compiled.status,1,source+": "+compiled.stderr);
   assert.equal(compiled.stdout,"",source);
   const category=compiled.stderr.match(/\b([A-Z][A-Z0-9_]+):/)?.[1];
   assert.ok(category&&(expected.category===null||category===expected.category),source+": "+compiled.stderr);
   assert.equal(existsSync(assembly),false,source);
   console.log("NATIVE_AOT_REJECT "+source+" "+category+" "+sha(input));
  }else{
   ok(compiled,source);assert.ok(statSync(assembly).size>0);
   const output=join(caseDir,"native"),property="-p:GeneratedAssembly="+assembly;
   ok(run("dotnet",["clean",host,"-c","Release","-r",rid,property]),source+" clean");
   ok(run("dotnet",["publish",host,...base,property,"-o",output]),source+" publish");
   const executable=join(output,"oreslang-app");verify(executable);
   const guest=run(executable,[],10000);
   if(expected.kind==="value"){
    ok(guest,source);assert.equal(guest.stdout,expected.decimal+"\n",source);assert.equal(guest.stderr,"",source);
   }else{
    assert.ok(["arithmeticFailure","refinementFailure"].includes(expected.kind));assert.ok(Object.hasOwn(errors,expected.category));
    assert.equal(guest.status,70,source);assert.equal(guest.stdout,"",source);
    assert.equal(guest.stderr,errors[expected.category]+"\n",source);
   }
   console.log("NATIVE_AOT_PASS "+source+" "+expected.kind+" "+sha(input)+" "+sha(assembly)+" "+sha(executable));
  }
  rmSync(caseDir,{recursive:true,force:true});
 }
 ok(run("git",["diff","--quiet","--","."]),"tracked source");
 ok(run("git",["diff","--cached","--quiet","--","."]),"index");
 console.log("NATIVE_AOT_SHARD_VERIFIED "+shard+"/"+count+" "+selected.length+"/"+cases.length);
}finally{rmSync(work,{recursive:true,force:true});}
