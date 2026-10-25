import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BACKENDS,CANONICAL_SOURCE,SOURCE_SHA256,SOURCE_GIT_BLOB} from '../src/five-backend-runtime-evidence.mjs';
const cli=new URL('../bin/check-five-backend-runtime-evidence.mjs',import.meta.url).pathname;
function report() {
 const profiles={java:'jvm',llvm:'native',wasm:'core-wasm',net:'windows-native-aot',forge:'interpreter'};
 return {schema_version:1,feature:'scalar-add-i64-v1',fixture:{source:CANONICAL_SOURCE,sha256:SOURCE_SHA256,git_blob:SOURCE_GIT_BLOB},backends:BACKENDS.map((backend,i)=>({
  backend,repository:'ores-truffle-oreslang/oreslang-source.'+backend,profile:profiles[backend],source_commit:'a'.repeat(40),source_tree:'b'.repeat(40),fixture_git_blob:SOURCE_GIT_BLOB,compiler_sha256:'c'.repeat(64),guest_artifact_sha256:'d'.repeat(64),
  compile:{argv:['/tmp/compiler','add.ores'],exit_code:0,signal:null,timed_out:false,truncated:false},
  guest:{argv:['/tmp/guest'],exit_code:0,signal:null,timed_out:false,truncated:false},
  observation:{type:'int',value:'42',source_sha256:SOURCE_SHA256,guest_executed:true},
  ci:{workflow_run_id:100+i,job_id:200+i,runner_id:300+i,steps_executed:5,head_sha:'a'.repeat(40)},
 }))};
}
test('CLI refuses to greenlight unverified parity, structural-only remains explicit',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ores-parity-cli-'));
 try {
  const valid=join(dir,'valid.json'); writeFileSync(valid,JSON.stringify(report()));
  const run=(path,extra=[])=>spawnSync(process.execPath,[cli,path,...extra],{encoding:'utf8',timeout:3000});
  const defaultRun=run(valid);
  assert.equal(defaultRun.status,3,defaultRun.stderr);
  assert.equal(JSON.parse(defaultRun.stdout).five_backend_parity_certified,false);
  const structural=run(valid,['--structural-only']);
  assert.equal(structural.status,0,structural.stderr);
  const extra=run(valid,['--bogus']); assert.equal(extra.status,2);
  const oversized=join(dir,'large.json');writeFileSync(oversized,' '.repeat(128*1024+1));
  assert.equal(run(oversized).status,1);
  if(process.platform!=='win32') {
   const symlink=join(dir,'symlink.json');symlinkSync(valid,symlink);
   assert.equal(run(symlink).status,1);
  }
 } finally {rmSync(dir,{recursive:true,force:true});}
});
