import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('guest runner refuses unconfigured invocation (cannot claim parity)',()=>{
 const script=fileURLToPath(new URL('../bin/portable-task-v1-run.mjs',import.meta.url));
 const x=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:5000});
 assert.equal(x.status,2);
 assert.match(x.stderr,/TASK_GUEST_RUNNER_DENIED/);
 assert.doesNotMatch(x.stdout,/"passed":16/);
});

test('structural-only matrix CLI fails release gate without actual verified guest evidence',()=>{
 const script=fileURLToPath(new URL('../bin/portable-task-v1.mjs',import.meta.url));
 const out=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:8000});
 assert.equal(out.status,1);
 const report=JSON.parse(out.stdout);
 assert.equal(report.backends.java.not_executed,16);
 assert.equal(report.backends.llvm.not_executed,16);
 assert.equal(report.backends.rs.not_executed,16);
 assert.equal(report.backends.wasm.releaseQualified,false);
 for(const b of ['cranelift','js','atto','hdl','realtime']){
  assert.equal(report.backends[b].not_executed,16);
  assert.equal(report.backends[b].releaseQualified,false);
 }
 assert.equal(Object.keys(report.backends).length,11);
});

test('guest runner rejects an unknown fixture-only execution request',()=>{
 const script=fileURLToPath(new URL('../bin/portable-task-v1-run.mjs',import.meta.url));
 const x=spawnSync(process.execPath,[script,'--config=/definitely/missing-task-config.json'],{encoding:'utf8',timeout:5000});
 assert.equal(x.status,2);
 assert.match(x.stderr,/TASK_GUEST_RUNNER_DENIED/);
});

test('runner rejects preexisting artifact, unbound guest or substituted compiler before execution',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'task-config-negative-'));
 const script=fileURLToPath(new URL('../bin/portable-task-v1-run.mjs',import.meta.url));
 const sha='a'.repeat(40);
 const base={backend:'llvm',compilerRoot:dir,compilerCommit:sha,fixtureCommit:sha,compilerIdentity:process.execPath,artifactPath:'{out}',compileArgv:[process.execPath,'{file}','{out}'],guestArgv:['{out}']};
 try{
  for(const [patch,diagnostic] of [
    [{artifactPath:process.execPath},/fresh per-case/],
    [{guestArgv:[process.execPath]},/guest must consume/],
    [{compileArgv:[process.execPath,'{file}']},/compile must bind/],
    [{compileArgv:['/bin/false','{file}','{out}']},/hashed executable identity/]
  ]){
   const path=join(dir,'config.json');await writeFile(path,JSON.stringify({...base,...patch}));
   const x=spawnSync(process.execPath,[script,'--config='+path],{encoding:'utf8',timeout:5000});
   assert.equal(x.status,2);assert.match(x.stderr,diagnostic);assert.equal(x.stdout,'');
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
