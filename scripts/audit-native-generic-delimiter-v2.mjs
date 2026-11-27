// Exact-byte audit, not a semantic diagnostic certification.
// LLVM: emitted IR -> clang executable; Forge: emitted assembly -> cc executable.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [backend,compiler,registry]=process.argv.slice(2);
assert.ok(['llvm','forge'].includes(backend));
const bytes=readFileSync(registry);
const data=JSON.parse(bytes);
assert.equal(data.cases.length,27);
assert.equal(new Set(data.cases.map(c=>c.id)).size,27);
console.log('REGISTRY_SHA256='+createHash('sha256').update(bytes).digest('hex'));
const dir=mkdtempSync(join(tmpdir(),'atto-native-corpus-'));
const invoke=(exe,args)=>spawnSync(exe,args,{encoding:'utf8',timeout:30000,maxBuffer:2097152});
const good=r=>!r.error&&!r.signal&&r.status===0;
const results=[];
try {
  const driver=join(dir,'driver.c');
  writeFileSync(driver,'#include <stdint.h>\nextern int64_t oresforge_entry(void);\nint main(void){return oresforge_entry()==42?42:1;}\n');
  for(const c of data.cases){
    assert.match(c.id,/^[a-z0-9_]+$/);
    const source=join(dir,c.id+'.atto'),artifact=join(dir,c.id+(backend==='llvm'?'.ll':'.s')),exe=join(dir,c.id);
    writeFileSync(source,c.source,'utf8');
    const r=invoke(resolve(compiler),backend==='llvm'?[source]:['emit-asm','x86_64',source]);
    let observed='ERROR',detail='';
    if(!r.error&&!r.signal&&r.status!==null&&r.status!==0&&!r.stdout.trim()&&r.stderr.trim())observed='DIAGNOSTIC_NO_ARTIFACT';
    if(good(r)&&r.stdout.trim()){
      observed='COMPILER_ACCEPT';
      if(c.proof==='compiled_guest'){
        writeFileSync(artifact,r.stdout);
        const link=backend==='llvm'?invoke('clang-18',['-Wno-override-module','-O2','-x','ir',artifact,'-o',exe]):invoke('cc',['-std=c11',driver,artifact,'-o',exe]);
        if(good(link)){
          const guest=invoke(exe,[]);
          observed=!guest.error&&!guest.signal&&guest.status===42&&!guest.stdout.trim()&&!guest.stderr.trim()?'GUEST_42':'ERROR';
          detail='guest_status='+guest.status+' '+(guest.stderr||'').slice(-400);
        }else{observed='ERROR';detail='link: '+(link.stderr||'').slice(-600)}
      }
    }
    const expected=c.expectation==='reject'?observed==='DIAGNOSTIC_NO_ARTIFACT':c.proof==='compiled_guest'?observed==='GUEST_42':observed==='COMPILER_ACCEPT';
    const outcome=c.expectation==='gate'?'CAPABILITY_PROBE':expected?'EXPECTED':'UNEXPECTED';
    const row={id:c.id,proof:c.proof,expectation:c.expectation,observed,outcome,status:r.status,diagnostic:r.stderr?.slice(-1200),detail};
    results.push(row);console.log(JSON.stringify(row));
  }
  console.log('CORPUS_SUMMARY '+JSON.stringify({backend,cases:results.length,expected:results.filter(x=>x.outcome==='EXPECTED').length,unexpected:results.filter(x=>x.outcome==='UNEXPECTED').length,gates:results.filter(x=>x.outcome==='CAPABILITY_PROBE').length}));
  if(results.some(x=>x.outcome==='UNEXPECTED'||x.observed==='ERROR'))process.exitCode=1;
}finally{rmSync(dir,{recursive:true,force:true})}
