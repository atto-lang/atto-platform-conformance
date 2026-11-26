// Exact #581 ordinary-profile fixture execution; no strict-profile substitution.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {join,resolve,delimiter} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const [target,location,extra,pin]=process.argv.slice(2);
assert.ok(['rs','wasm','js','java','llvm','net','net-structured','forge','cranelift'].includes(target));
const isNet=target==='net'||target==='net-structured';
const compiler=resolve(location),root=new URL('../',import.meta.url);
const suite=process.env.ATTO_INIT_SUITE??'original';
assert.ok(['original','string-view-candidate'].includes(suite),'unknown initialization suite');
const candidate=suite==='string-view-candidate';
const contract=JSON.parse(fs.readFileSync(new URL(candidate?'contracts/ordinary-string-view-candidate-v1.json':'contracts/explicit-local-initialization-v1.json',root)));
assert.equal(contract.cases.length,candidate?8:5);
const label=candidate?'STRING_VIEW_CANDIDATE':'ORDINARY_INIT';
const hash=(bytes,kind='sha256')=>createHash(kind).update(bytes).digest('hex');
const run=(cmd,args,opts={})=>{
 const r=spawnSync(cmd,args,{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:8*1024*1024,...opts});
 if(r.error)throw r.error;assert.equal(r.signal,null);return r;
};
const guestDriver=`import fs from 'node:fs';import assert from 'node:assert/strict';
const [kind,p,want]=process.argv.slice(1);let v;
if(kind==='wasm'){const m=new WebAssembly.Module(fs.readFileSync(p));assert.deepEqual(WebAssembly.Module.imports(m),[]);const g=new WebAssembly.Instance(m,{}).exports;v=g.main();assert.equal(g.panic_code.value,0);}
else{const g=await import('data:text/javascript;base64,'+fs.readFileSync(p).toString('base64'));v=g.main();}
assert.equal(v,BigInt(want));process.stdout.write('GUEST_OK '+v+'\\n');`;
const checkResult=(r,stdout,status=0)=>{assert.equal(r.status,status,r.stderr);assert.equal(r.stderr,'');assert.equal(r.stdout,stdout);};
// Reject generic syntax errors; confirm the code-only path independently.
const diagnosticPattern=/\b(?:E_UNINITIALIZED|E_MISSING_INITIALIZER)\b|(?:requires?|needs?) (?:an? )?(?:explicit )?initializer/i;
assert.match('error: E_MISSING_INITIALIZER: explicit initializer required',diagnosticPattern);
assert.match('binding needs an initializer',diagnosticPattern);
assert.doesNotMatch('E_SYNTAX: expected semicolon',diagnosticPattern);
const temp=fs.mkdtempSync(join(os.tmpdir(),'atto-ordinary-init-'));
let passed=0,failed=0;
try{
 let javaArgs,compile,browser;
 if(target==='java'){
  const dep=join(temp,'classpath');
  const b=run('mvn',['-q','-DskipTests','compile','dependency:build-classpath','-Dmdep.outputFile='+dep],{cwd:compiler,timeout:240000});assert.equal(b.status,0,b.stderr+b.stdout);
  javaArgs=['--enable-native-access=ALL-UNNAMED','-Dpolyglot.engine.WarnInterpreterOnly=false','-cp',join(compiler,'target/classes')+delimiter+fs.readFileSync(dep,'utf8').trim(),'dev.oreslang.launcher.OresMain'];
 }
 if(target==='js')compile=(await import(pathToFileURL(join(compiler,'src/program-v2.mjs')).href)).compileProgramV2;
 if(target==='wasm'){
  const bytes=fs.readFileSync(compiler);assert.match(pin,/^[a-f0-9]{64}$/);assert.equal(hash(bytes),pin);
  browser=await (await import(pathToFileURL(join(resolve(extra),'src/canonical-browser-compiler.mjs')).href)).createCompiler(bytes);
 }
 for(const c of contract.cases){
  const id=c.id;try{
   assert.match(id,/^[a-z0-9-]+$/);assert.match(c.path,candidate?/^fixtures\/ordinary-string-view-candidate-v1\/(pass|fail)\/[a-z0-9-]+\.atto$/:/^fixtures\/explicit-initialization-v1\/(pass|fail)\/[a-z0-9-]+\.atto$/);
   const bytes=fs.readFileSync(new URL(c.path,root));
   assert.equal(hash(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes]),'sha1'),c.source_blob_sha);
   const dir=join(temp,id);fs.mkdirSync(dir);
   const input=join(dir,'guest.atto'),artifact=join(dir,isNet?'OresGenerated.dll':'guest'+({rs:'.wasm',wasm:'.wasm',js:'.mjs',llvm:'.ll',net:'.dll',forge:'.cpp',cranelift:'.o'}[target]??'.none'));
   fs.writeFileSync(input,bytes,{flag:'wx'});
   let diagnostic=null,compileStatus=0;
   if(target==='java'){
    const check=run('java',[...javaArgs,'--check',input],{cwd:dir});
    const guest=run('java',[...javaArgs,input],{cwd:dir});
    if(c.expect==='accept'){assert.equal(check.status,0,check.stderr);checkResult(guest,'',c.expected_exit);}
    else{assert.equal(check.status,1);assert.equal(guest.status,1);assert.equal(check.stdout,'');assert.equal(guest.stdout,'');diagnostic=check.stderr;assert.match(guest.stderr,/\b(?:E_UNINITIALIZED|E_MISSING_INITIALIZER)\b|(?:requires?|needs?) (?:an? )?(?:explicit )?initializer/i);}
   }else if(target==='js'){
    let output;try{output=compile(bytes.toString('utf8'));}catch(e){diagnostic=String(e.message);compileStatus=1;}
    if(compileStatus===0)fs.writeFileSync(artifact,output,{flag:'wx'});
   }else if(target==='wasm'){
    const out=browser.compile(bytes.toString('utf8'),'wasm','ordinary');
    if(out.ok)fs.writeFileSync(artifact,out.wasm,{flag:'wx'});
    else{compileStatus=1;assert.equal(Object.hasOwn(out,'wasm'),false);assert.equal(Object.hasOwn(out,'esm'),false);diagnostic=out.diagnostics.map(d=>d.message).join('\n');}
   }else{
    const cmd=isNet?'dotnet':compiler;
    const args=target==='rs'?[input,'-o',artifact]:target==='llvm'?[input]:target==='forge'?[input,'-o',artifact]:target==='cranelift'?['emit-object',input]:[compiler,target==='net-structured'?'compile-structured':'compile',input,'--out',artifact];
    const r=run(cmd,args,{cwd:dir,...(target==='cranelift'?{encoding:null}:{})});
    compileStatus=r.status;
    if(compileStatus===0&&(target==='llvm'||target==='cranelift'))fs.writeFileSync(artifact,r.stdout,{flag:'wx'});
    if(compileStatus!==0){diagnostic=String(r.stderr);assert.equal(r.stdout.length,0,'rejected source emitted stdout');}
   }
   if(c.expect==='reject'){
    assert.ok(target==='java'||compileStatus===1||compileStatus===2,'unexpected rejection status '+compileStatus);
    assert.deepEqual(fs.readdirSync(dir),['guest.atto'],'rejected source left files');
    assert.match(diagnostic??'',/\b(?:E_UNINITIALIZED|E_MISSING_INITIALIZER)\b|(?:requires?|needs?) (?:an? )?(?:explicit )?initializer/i,'missing targeted initializer diagnostic: '+(diagnostic??'<none>'));
   }else if(target!=='java'){
    assert.equal(compileStatus,0,diagnostic??'compile failed');assert.ok(fs.statSync(artifact).size>0);
    if(['js','rs','wasm'].includes(target))checkResult(run(process.execPath,['--input-type=module','-e',guestDriver,target==='js'?'js':'wasm',artifact,String(c.expected_exit)],{timeout:10000}),'GUEST_OK '+c.expected_exit+'\n');
    else if(isNet){
     const host=join(resolve(extra),'host/Ores.Net.NativeHost/Ores.Net.NativeHost.csproj'),native=join(dir,'native');
     const p=run('dotnet',['publish',host,'-c','Release','-r','linux-x64','-p:GeneratedAssembly='+artifact,'-o',native],{timeout:240000});
     assert.equal(p.status,0,p.stdout+p.stderr);assert.ok(fs.readFileSync(join(native,'oreslang-app')).subarray(0,4).equals(Buffer.from([127,69,76,70])));
     assert.ok(!fs.readdirSync(native).some(f=>f.endsWith('.dll')));
     checkResult(run(join(native,'oreslang-app'),[],{timeout:10000}),String(c.expected_exit)+'\n');
    }else{
     const native=join(dir,'guest.native');let args,cmd;
     if(target==='llvm'){cmd=extra||'clang';assert.ok(pin,'LLVM requires authenticated production string runtime path');const runtime=resolve(pin);args=[artifact,runtime,'-I'+resolve(runtime,'../../..'),'-pthread','-o',native];}
     else if(target==='forge'){cmd='c++';args=['-std=c++20','-I'+resolve(extra),artifact,'-o',native];}
     else{cmd='cc';const h=join(dir,'harness.c');fs.writeFileSync(h,'#include <stdint.h>\n#include <stdio.h>\nextern int32_t oreslang_scalar_entry(int64_t,int64_t,int64_t,int64_t,int64_t*);\nint main(void){int64_t out=0;int rc=oreslang_scalar_entry(0,0,0,0,&out);if(rc)return 1;printf("%lld\\n",(long long)out);return 0;}\n');args=[h,artifact,'-o',native];}
     const l=run(cmd,args,{timeout:60000});assert.equal(l.status,0,l.stderr);
     checkResult(run(native,[],{timeout:10000}),target==='llvm'?'':String(c.expected_exit)+'\n',target==='llvm'?c.expected_exit:0);
    }
   }
   console.log(label+'_PASS',target,id,c.source_blob_sha,c.expect);passed++;
  }catch(e){failed++;console.error(label+'_FAIL',target,id,String(e.stack??e));}
 }
 console.log(label+'_CENSUS',target,'total',contract.cases.length,'passed',passed,'failed',failed);
 assert.equal(passed+failed,contract.cases.length);if(failed)process.exitCode=1;
}finally{fs.rmSync(temp,{recursive:true,force:true});}
