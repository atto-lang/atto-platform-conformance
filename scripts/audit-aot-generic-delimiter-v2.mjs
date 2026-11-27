// Exact registered source bytes -> actual .NET NativeAOT / Cranelift object guest.
// Invocation: node scripts/audit-aot-generic-delimiter-v2.mjs <net|cranelift> <compiler> <registry> <source-root>
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,existsSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [backend,compilerPath,registry,sourceRoot]=process.argv.slice(2);
assert.ok(['net','cranelift'].includes(backend));
const compiler=resolve(compilerPath),root=resolve(sourceRoot);
const bytes=readFileSync(registry),data=JSON.parse(bytes);
assert.equal(data.cases.length,27);
assert.equal(new Set(data.cases.map(c=>c.id)).size,27);
console.log('REGISTRY_SHA256='+createHash('sha256').update(bytes).digest('hex'));
const work=mkdtempSync(join(tmpdir(),'atto-aot-corpus-'));
const invoke=(exe,args,timeout=30000)=>spawnSync(exe,args,{cwd:root,timeout,maxBuffer:8388608});
const ok=r=>!r.error&&!r.signal&&r.status===0;
const str=b=>b?.toString('utf8')??'';
const driver=join(work,'driver.c');
writeFileSync(driver,'#include <stdint.h>\nextern int32_t oreslang_scalar_entry(int64_t,int64_t,int64_t,int64_t,int64_t*);\nint main(void){int64_t x=-1;return oreslang_scalar_entry(0,0,0,0,&x)==0&&x==42?42:1;}\n');
const host=join(root,'host/Ores.Net.NativeHost/Ores.Net.NativeHost.csproj');
const rows=[];
try{
  for(const c of data.cases){
    assert.match(c.id,/^[a-z0-9_]+$/);
    const dir=join(work,c.id);mkdirSync(dir);
    const source=join(dir,c.id+'.atto');
    const artifact=join(dir,backend==='net'?'OresGenerated.dll':'guest.o');
    writeFileSync(source,c.source,'utf8');
    const r=backend==='net'?invoke(compiler,['compile',source,'--out',artifact]):invoke(compiler,['emit-object',source]);
    let observed='ERROR',detail='';
    if(!r.error&&!r.signal&&r.status===1&&(!r.stdout||r.stdout.length===0)&&!existsSync(artifact)&&str(r.stderr).trim())observed='DIAGNOSTIC_NO_ARTIFACT';
    if(ok(r)&&backend==='cranelift'&&r.stdout?.length){
      writeFileSync(artifact,r.stdout);
    }
    if(ok(r)&&existsSync(artifact)&&statSync(artifact).size>0){
      observed='COMPILER_ACCEPT';
      if(c.proof==='compiled_guest'){
        let exe=join(dir,'guest'),link;
        if(backend==='cranelift'){
          link=invoke('cc',['-std=c11','-Wall','-Wextra','-Werror',driver,artifact,'-o',exe]);
        }else{
          const props=['-c','Release','-r','linux-x64','-p:GeneratedAssembly='+artifact];
          const clean=invoke('dotnet',['clean',host,...props],180000);
          if(ok(clean))link=invoke('dotnet',['publish',host,...props,'-o',join(dir,'native'),'-warnaserror'],300000);
          else link=clean;
          exe=join(dir,'native','oreslang-app');
          if(ok(link))link=invoke('bash',[join(root,'verification/assert-linux-native-release.sh'),exe]);
        }
        if(ok(link)){
          const g=invoke(exe,[],10000);
          const success=backend==='net'?ok(g)&&str(g.stdout)==='42\n':!g.error&&!g.signal&&g.status===42&&!str(g.stdout);
          observed=success&&!str(g.stderr)?'GUEST_42':'ERROR';
          detail='guest_status='+g.status+' '+str(g.stderr).slice(-400);
        }else{observed='ERROR';detail='link/publish: '+(str(link.stderr)+str(link.stdout)).slice(-1000)}
      }
    }
    const expected=c.expectation==='reject'?observed==='DIAGNOSTIC_NO_ARTIFACT':c.proof==='compiled_guest'?observed==='GUEST_42':observed==='COMPILER_ACCEPT';
    const outcome=c.expectation==='gate'?'CAPABILITY_PROBE':expected?'EXPECTED':'UNEXPECTED';
    const row={id:c.id,proof:c.proof,expectation:c.expectation,observed,outcome,status:r.status,diagnostic:str(r.stderr).slice(-1200),detail};
    rows.push(row);console.log(JSON.stringify(row));
  }
  console.log('CORPUS_SUMMARY '+JSON.stringify({backend,cases:rows.length,expected:rows.filter(x=>x.outcome==='EXPECTED').length,unexpected:rows.filter(x=>x.outcome==='UNEXPECTED').length,gates:rows.filter(x=>x.outcome==='CAPABILITY_PROBE').length}));
  if(rows.some(x=>x.outcome==='UNEXPECTED'||x.observed==='ERROR'))process.exitCode=1;
}finally{rmSync(work,{recursive:true,force:true})}
