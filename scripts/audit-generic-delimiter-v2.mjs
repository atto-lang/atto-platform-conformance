// Audit the identical registry bytes using real backend compiler entrypoints.
// Usage: node scripts/audit-generic-delimiter-v2.mjs <js|rs> <compiler entry> <registry>
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const [backend,compiler,registry]=process.argv.slice(2);
assert.ok(['js','rs'].includes(backend));
const bytes=readFileSync(registry);
const data=JSON.parse(bytes);
assert.equal(data.cases.length,27);
console.log('REGISTRY_SHA256='+createHash('sha256').update(bytes).digest('hex'));
const work=mkdtempSync(join(tmpdir(),'atto-shared-generics-'));
const child=join(work,'probe.mjs');
writeFileSync(child,`
import {readFileSync,writeFileSync} from 'node:fs';
const [compiler,source,out]=process.argv.slice(2);
const {compileProgramV2}=await import(compiler);
try {
  const esm=compileProgramV2(readFileSync(source,'utf8'));
  if(typeof esm!=='string'||!esm.length)throw Error('unexpected compiler output');
  writeFileSync(out,esm,{flag:'wx'});
}catch(e){
  console.error(String(e));
  process.exitCode=1;
}
`);
const guest=join(work,'guest.mjs');
writeFileSync(guest,`
import {readFileSync} from 'node:fs';
const [backend,artifact]=process.argv.slice(2);
let result;
if(backend==='js'){
  const mod=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(readFileSync(artifact,'utf8')));
  result=mod.main();
}else{
  const bytes=readFileSync(artifact);
  if(!WebAssembly.validate(bytes))throw Error('invalid generated Wasm');
  const mod=new WebAssembly.Module(bytes);
  if(WebAssembly.Module.imports(mod).length)throw Error('unadmitted guest imports');
  const exp=new WebAssembly.Instance(mod,{}).exports;
  if(exp.panic_code.value!==0)throw Error('guest panic');
  result=exp.main();
}
if(result!==42n&&result!==42)throw Error('wrong guest return '+String(result));
console.log('GUEST_42');
`);
let results=[];
try {
  for(const c of data.cases){
    assert.match(c.id,/^[a-z0-9_]+$/);
    const file=join(work,c.id+'.atto'),out=join(work,c.id+(backend==='js'?'.mjs':'.wasm'));
    writeFileSync(file,c.source,'utf8');
    const r=backend==='js'
      ?spawnSync(process.execPath,[child,pathToFileURL(resolve(compiler)).href,file,out],{encoding:'utf8',timeout:30000,maxBuffer:1048576})
      :spawnSync(resolve(compiler),[file,'-o',out],{encoding:'utf8',timeout:30000,maxBuffer:1048576});
    let observed='ERROR';
    if(!r.error&&!r.signal&&r.status===1&&!existsSync(out)&&
        (backend==='js'?/error: program/.test(r.stderr):/E_[A-Z_]+/.test(r.stderr)))observed='DIAGNOSTIC_NO_ARTIFACT';
    if(!r.error&&!r.signal&&r.status===0&&existsSync(out)){
      observed='COMPILER_ACCEPT';
      if(c.proof==='compiled_guest'){
        const g=spawnSync(process.execPath,[guest,backend,out],{encoding:'utf8',timeout:10000,maxBuffer:1048576});
        observed=!g.error&&!g.signal&&g.status===0&&g.stdout.trim()==='GUEST_42'?'GUEST_42':'ERROR';
      }
    }
    const expected=c.expectation==='reject'?observed==='DIAGNOSTIC_NO_ARTIFACT':
      c.proof==='compiled_guest'?observed==='GUEST_42':observed==='COMPILER_ACCEPT';
    const outcome=c.expectation==='gate'?'CAPABILITY_PROBE':expected?'EXPECTED':'UNEXPECTED';
    const row={id:c.id,expectation:c.expectation,proof:c.proof,observed,outcome,diagnostic:r.stderr?.slice(-1200),status:r.status};
    results.push(row);console.log(JSON.stringify(row));
  }
  console.log('CORPUS_SUMMARY '+JSON.stringify({backend,cases:results.length,expected:results.filter(x=>x.outcome==='EXPECTED').length,unexpected:results.filter(x=>x.outcome==='UNEXPECTED').length,gates:results.filter(x=>x.outcome==='CAPABILITY_PROBE').length}));
  if(results.some(x=>x.outcome==='UNEXPECTED'||x.observed==='ERROR'))process.exitCode=1;
}finally{rmSync(work,{recursive:true,force:true})}
