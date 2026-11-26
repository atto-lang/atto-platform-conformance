// Strict-mode dedicated Chrome Worker, with explicitly pinned external shared corpus.
// No ordinary-compiler fallback; exact static diagnostics or actual emitted guest values.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
import {once} from "node:events";

const [bridgePath,compilerPath,chrome,corpusPath,expectedPin]=process.argv.slice(2);
assert.ok(bridgePath&&compilerPath&&chrome&&corpusPath&&/^[a-f0-9]{64}$/.test(expectedPin??""));

const corpus=resolve(corpusPath);
const manifest=JSON.parse(readFileSync(join(corpus,"fixtures/verified-core-strict-i64-v1/cases.json"),"utf8"));
assert.equal(manifest.schemaVersion,1);assert.equal(manifest.profile,"verified-core-strict-i64-v1");
const {strictLoopCases}=await import(pathToFileURL(join(corpus,"lib/verified-strict-loop-corpus.mjs")).href);
const work=mkdtempSync(join(tmpdir(),"atto-shared-worker-"));
const profile=join(work,"chrome");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const compiler=readFileSync(resolve(compilerPath)),pin=sha(compiler);
const bridge=readFileSync(join(resolve(bridgePath),"src/canonical-browser-compiler.mjs"));
assert.ok(compiler.length>8&&compiler.length<=16*1024*1024);
assert.equal(pin,expectedPin,"compiler digest mismatch");
assert.equal(manifest.cases.length,14);assert.equal(strictLoopCases.length,10);
const cases=[...manifest.cases.map(c=>({source:c.id+".atto",text:c.source,expected:c.expected})),...strictLoopCases];
const seen=new Set();
const inputs=cases.map(({source,text,expected})=>{
 assert.match(source,/^[a-z0-9-]+\.atto$/);assert.ok(!seen.has(source));seen.add(source);
 assert.ok(typeof text==="string"&&text.length>0);
 assert.ok(expected.kind==="value"?/^-?\d+$/.test(expected.decimal):expected.kind==="diagnostic"&&/^E_[A-Z0-9_]+$/.test(expected.category));
 return {source,expected,text,hash:sha(Buffer.from(text))};
});
const worker=`import {createCompiler,verifyCompilerBytes} from '/bridge.mjs';
const check=(v,detail)=>{if(!v)throw Error(detail);};
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
self.onmessage=async({data})=>{
 try{
  check(self instanceof DedicatedWorkerGlobalScope && typeof document==='undefined' && self.isSecureContext,'not a secure dedicated Worker');
  const get=async url=>{const r=await fetch(url,{cache:'no-store'});check(r.ok,url);return r;};
  const bytes=new Uint8Array(await (await get('/compiler.wasm')).arrayBuffer());
  await verifyCompilerBytes(bytes,data.pin,bytes.length);
  const module=new WebAssembly.Module(bytes);check(WebAssembly.Module.imports(module).length===0,'compiler imports');
  check(WebAssembly.Module.exports(module).some(e=>e.name==='compile_strict_i64'&&e.kind==='function'),'strict ABI missing');
  const compiler=await createCompiler(bytes);
  const inputs=await (await get('/cases.json')).json();
  const receipts=[]; const errors={divisionByZero:2,integerOverflow:1,refinementViolation:7,i32Overflow:8};
  for(const {source,expected,text,hash} of inputs){
   check(await sha(new TextEncoder().encode(text))===hash,source+' source hash');
   const r=compiler.compile(text,'wasm','strict');
   if(expected.kind==='diagnostic'){
    check(!r.ok&&!Object.hasOwn(r,'wasm')&&!Object.hasOwn(r,'esm'),source+' artifact on rejection');
    check(r.diagnostics.length===1&&r.diagnostics[0].message.includes(expected.category+':'),source+' '+JSON.stringify(r.diagnostics));
    receipts.push({source,hash,kind:expected.kind});
   }else{
    check(r.ok,source+' '+JSON.stringify(r.diagnostics));
    const guest=new WebAssembly.Module(r.wasm);check(WebAssembly.Module.imports(guest).length===0,source+' guest imports');
    const instance=new WebAssembly.Instance(guest,{});check(instance.exports.panic_code.value===0,source+' initial panic');
    if(expected.kind==='value'){
     check(instance.exports.main()===BigInt(expected.decimal),source+' result');
     check(instance.exports.panic_code.value===0,source+' success panic');
    }else{
     check(['arithmeticFailure','refinementFailure'].includes(expected.kind)&&Object.hasOwn(errors,expected.category),source+' unsupported oracle');
     let trapped=false;try{instance.exports.main();}catch(e){trapped=e instanceof WebAssembly.RuntimeError;}
     check(trapped&&instance.exports.panic_code.value===errors[expected.category],source+' wrong trap');
    }
    receipts.push({source,hash,kind:expected.kind,artifact:await sha(r.wasm)});
   }
  }
  self.postMessage({ok:true,receipts,pin:data.pin,agent:navigator.userAgent});
 }catch(e){self.postMessage({ok:false,error:String(e.stack??e)});}
};`;
const page=`<!doctype html><meta charset="utf-8"><script type="module">
const w=new Worker('/worker.mjs',{type:'module'});let done=false;
async function finish(data){if(done)return;done=true;w.terminate();await fetch('/result',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});}
w.onmessage=({data})=>finish(data);w.onerror=e=>finish({ok:false,error:e.message});
w.postMessage({pin:${JSON.stringify(pin)}});
</script>`;
let accept,reject;const receipt=new Promise((a,b)=>{accept=a;reject=b;});
const resources=new Map([['/',["text/html",page]],['/worker.mjs',["text/javascript",worker]],['/bridge.mjs',["text/javascript",bridge]],['/compiler.wasm',["application/wasm",compiler]],['/cases.json',["application/json",JSON.stringify(inputs)]]]);
const server=createServer(async(req,res)=>{
 try{
  if(req.method==="GET"&&resources.has(req.url)){const [type,body]=resources.get(req.url);res.writeHead(200,{"content-type":type,"cache-control":"no-store"});res.end(body);}
  else if(req.method==="POST"&&req.url==="/result"){
   let data="";for await(const chunk of req){data+=chunk;if(data.length>131072)throw Error("receipt too large");}
   const result=JSON.parse(data);res.writeHead(204);res.end();accept(result);
  }else{res.writeHead(404);res.end();}
 }catch(e){res.destroy();reject(e);}
});
let child,timer;
try{
 server.listen(0,"127.0.0.1");await once(server,"listening");
 child=spawn(chrome,["--headless=new","--disable-dev-shm-usage","--no-first-run","--no-default-browser-check","--user-data-dir="+profile,"http://127.0.0.1:"+server.address().port+"/"],{stdio:["ignore","ignore","pipe"],detached:process.platform!=="win32"});
 let err="";child.stderr.on("data",x=>{err=(err+x).slice(-8000);});
 child.once("error",reject);child.once("exit",(c,s)=>reject(Error("Chrome exited "+c+"/"+s+" "+err)));
 timer=setTimeout(()=>reject(Error("Worker timeout "+err)),120000);
 const result=await receipt;assert.equal(result.ok,true,result.error);assert.match(result.agent,/Chrome\//);
 assert.equal(result.pin,pin);assert.equal(result.receipts.length,inputs.length);
 for(let i=0;i<inputs.length;i++){
  const r=result.receipts[i],v=inputs[i];assert.equal(r.source,v.source);assert.equal(r.hash,v.hash);assert.equal(r.kind,v.expected.kind);
  if(r.kind!=="diagnostic")assert.match(r.artifact,/^[a-f0-9]{64}$/);
  console.log("PASS browser-worker "+r.source+" "+r.kind+" "+r.hash+" "+(r.artifact??""));
 }
 console.log("SHARED_BROWSER_STRICT_VERIFIED "+inputs.length+" "+pin+" "+result.agent);
}finally{
 clearTimeout(timer);
 if(child?.pid&&process.platform!=="win32")try{process.kill(-child.pid,"SIGKILL");}catch(e){if(e.code!=="ESRCH")throw e;}
 if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,"exit").catch(()=>{});child.kill("SIGKILL");await exited;}
 server.closeAllConnections();await new Promise(r=>server.close(r));
 rmSync(work,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
