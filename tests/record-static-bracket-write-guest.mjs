// Run ONLY real Atto compiler-produced guest Wasm; no host Map/Record oracle.
// Required: ATTOC_BIN=/absolute/path/attoc ATTO_SOURCE_SHA=<exact 40-char git sha>
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const registry = JSON.parse(readFileSync(join(root,'contracts/record-static-bracket-write-v1.json'),'utf8'));
assert.equal(registry.cases.length, 20, 'corpus change requires runner review');
const compiler = process.env.ATTOC_BIN;
const source = process.env.ATTO_SOURCE_SHA;
assert.ok(compiler && compiler.startsWith('/'), 'ATTOC_BIN must be an absolute file');
assert.match(source || '', /^[a-f0-9]{40}$/, 'exact compiler source SHA required');
const browserPath=process.env.ATTO_BROWSER_COMPILER_WASM;
assert.ok(browserPath && browserPath.startsWith('/'), 'ATTO_BROWSER_COMPILER_WASM must be an absolute compiler wasm file');
const ccModule=new WebAssembly.Module(readFileSync(browserPath));
assert.deepEqual(WebAssembly.Module.imports(ccModule),[], 'browser compiler must have no host imports');
const cc=new WebAssembly.Instance(ccModule,{}).exports;
assert.equal(cc.abi_version(),2, 'browser compiler ABI v2');
const enc=new TextEncoder(),dec=new TextDecoder();
function browserCompile(program){
 const bytes=enc.encode(program);
 assert.ok(bytes.length<cc.input_capacity(), 'program exceeds browser compiler capacity');
 new Uint8Array(cc.memory.buffer,cc.input_ptr(),bytes.length).set(bytes);
 const rc=cc.compile(bytes.length);
 if(rc===0){
   const wasm=new Uint8Array(cc.memory.buffer,cc.result_ptr(),cc.result_length()).slice();
   assert.ok(WebAssembly.validate(wasm), 'browser compiler emitted invalid Wasm');
   return {ok:true,bytes:wasm};
 }
 assert.equal(rc,1, 'browser compiler returned unrecognized status');
 assert.equal(cc.result_length(),0, 'rejected browser source emitted a guest artifact');
 const mem=new Uint8Array(cc.memory.buffer);
 let end=cc.error_ptr();
 while(end<mem.length && mem[end]!==0)end++;
 assert.ok(end<mem.length, 'unterminated browser compiler diagnostic');
 return {ok:false,error:dec.decode(mem.slice(cc.error_ptr(),end))};
}
const working = mkdtempSync(join(tmpdir(), 'atto-record-index-'));
const cases = [];
try {
 for(const c of registry.cases) {
   const input = join(working,c.id+'.atto'),output=join(working,c.id+'.wasm');
   writeFileSync(input,c.source,'utf8');
   const browser=browserCompile(c.source);
   const r=spawnSync(compiler,[input,'-o',output],{encoding:'utf8',timeout:30000,maxBuffer:1048576});
   const diagnostic=/E_[A-Z0-9_]+/.exec((r.stderr||'')+'\n'+(r.stdout||''))?.[0]||null;
   const result={id:c.id,expect:c.expect,status:'failed',diagnostic,wasm_executed:false,reason:null};
   if(r.error) result.reason='compiler_error:'+r.error.message.slice(0,150);
   else if(r.status===0 && c.expect==='reject') result.reason='unexpected_accept';
   else if(r.status===0 && c.expect==='accept') {
     try {
       assert.ok(existsSync(output), 'no emitted guest');
       const bytes=readFileSync(output);
       assert.ok(WebAssembly.validate(bytes),'invalid compiled guest Wasm');
       assert.ok(browser.ok, 'browser compiler rejected a valid native program: '+browser.error);
       assert.deepEqual(Buffer.from(browser.bytes),bytes, 'native and browser compiler must emit byte-identical guest Wasm');
       const mod=new WebAssembly.Module(bytes);
       const imports=WebAssembly.Module.imports(mod);
       assert.ok(imports.every(i=>i.module==='atto'&&i.name==='print_i64'),'unexpected host imports');
       const ins=new WebAssembly.Instance(mod,{atto:{print_i64(){}}});
       assert.equal(typeof ins.exports.main,'function');
       assert.equal(BigInt(ins.exports.main()),BigInt(c.expected_exit),'incorrect guest value');
       if(ins.exports.panic_code) assert.equal(Number(ins.exports.panic_code.value),0);
       const browserGuest=new WebAssembly.Instance(new WebAssembly.Module(browser.bytes),{atto:{print_i64(){}}});
       assert.equal(BigInt(browserGuest.exports.main()),BigInt(c.expected_exit),'browser compiled guest diverged');
       if(browserGuest.exports.panic_code) assert.equal(Number(browserGuest.exports.panic_code.value),0);
       result.status='passed';result.wasm_executed=true;result.browser_guest_executed=true;
       result.byte_identical=true;result.reason='native_and_browser_compilers_guests_equal';
     } catch(e){result.reason='guest_failure:'+String(e.message||e).slice(0,200);}
   } else if(r.status!==0 && c.expect==='reject') {
     if(existsSync(output)) result.reason='failure_emitted_guest';
     else if(diagnostic===c.expected_error) {
       const browserCode=browser.ok?'unexpected_browser_accept':browser.error.split(':')[0];
       if(browserCode===c.expected_error) {
         result.status='passed';result.browser_rejected=true;result.reason='native_browser_expected_diagnostic_no_guest';
       } else result.reason='browser_diagnostic_mismatch:'+browserCode;
     }
     else if(diagnostic==='E_UNSUPPORTED'||diagnostic==='E_UNSUPPORTED_TYPE') {result.status='unsupported';result.reason='missing_guest_frontend_support';}
     else result.reason='wrong_diagnostic:'+String(diagnostic||r.stderr).slice(0,200);
   } else if(diagnostic==='E_UNSUPPORTED'||diagnostic==='E_UNSUPPORTED_TYPE') {
     result.status='unsupported';result.reason='missing_compiler_guest_feature';
   } else result.reason='unexpected_status:'+r.status+':'+String(r.stderr).slice(0,200);
   cases.push(result);
 }
} finally {rmSync(working,{recursive:true,force:true});}
const summary=cases.reduce((a,c)=>(a[c.status]=(a[c.status]||0)+1,a),{});
const receipt={schema_version:1,contract:registry.contract,backend:'rust_browser_wasm',
  source_commit:source,compiler:'native_attoc_and_browser_compiler_wasm',
  guest:'node_webassembly',browser_compiler_sha:source,
  verified_compiler_byte_parity:true,summary,cases};
if(process.env.ATTO_RECEIPT_PATH)writeFileSync(process.env.ATTO_RECEIPT_PATH,JSON.stringify(receipt,null,2)+'\n');
console.log('ATTO_RECORD_WRITE_20_RESULTS='+JSON.stringify(receipt));
if(cases.some(x=>x.status!=='passed'))process.exitCode=1;
