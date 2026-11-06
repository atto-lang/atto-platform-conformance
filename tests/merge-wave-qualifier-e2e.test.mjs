import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const cli=fileURLToPath(new URL('../bin/merge-wave-qualifier.mjs',import.meta.url));
const SHA='a'.repeat(40), TREE='b'.repeat(40),BASE='c'.repeat(40);
function valid(n,backend) {
  return {repo:'ores-truffle-oreslang/oreslang-source.'+backend,number:n,head_sha:SHA,head_tree_sha:TREE,
    base_sha:BASE,base_ref:'main',draft:false,mergeable:true,state:'open',author:'the1mills',
    protection:{protected:true,require_pull_request:true,require_codeowners:true,dismiss_stale_reviews:true,strict_checks:true,enforce_admins:true,bypass_count:0},
    reviews:[{login:'independent-reviewer',state:'APPROVED',commit_sha:SHA}],
    required_checks:[{context:'ci',app_id:15368}],
    checks:[{context:'ci',app_id:15368,head_sha:SHA,tree_sha:TREE,conclusion:'success',run_id:123,run_attempt:1,
      jobs:[{id:456,run_id:123,run_attempt:1,head_sha:SHA,runner_id:8,conclusion:'success',steps:[{name:'actual negative test',conclusion:'success'}]}]}],
    scope:'source_free',test_receipts:[
      {kind:'source_free',head_sha:SHA,tree_sha:TREE,conclusion:'success',assertions:10,run_id:123,run_attempt:1,job_id:456},
      {kind:'negative',head_sha:SHA,tree_sha:TREE,conclusion:'success',assertions:3,run_id:123,run_attempt:1,job_id:456}],lease:null};
}
function snapshot() {return {schema_version:1,as_of:'2026-11-06T18:00:00Z',candidates:['java','llvm','wasm','forge','net'].map((b,i)=>valid(i+1,b))};}
function run(data) {
  const dir=mkdtempSync(join(tmpdir(),'atto-wave-e2e-'));
  try {
    const path=join(dir,'input.json');writeFileSync(path,typeof data==='string'?data:JSON.stringify(data));
    return spawnSync(process.execPath,[cli,path],{encoding:'utf8',timeout:5000,maxBuffer:256*1024});
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test('synthetic green five-repo wave cannot produce process exit 0',()=>{
  const result=run(snapshot());
  assert.equal(result.status,3,result.stderr);
  const out=JSON.parse(result.stdout);
  assert.equal(out.status,'SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
  assert.equal(out.selected.length,5);
  assert.match(out.note,/never auto-merge/i);
});
test('zero-step CI cannot pass end-to-end CLI',()=>{
  const s=snapshot();s.candidates[0].checks[0].jobs[0].steps=[];
  const result=run(s);
  assert.equal(result.status,1,result.stderr);
  assert.equal(JSON.parse(result.stdout).status,'BLOCKED');
});
test('active agent lease cannot pass CLI',()=>{
  const s=snapshot();s.candidates[1].lease={expires_at:'2026-11-06T20:00:00Z'};
  const result=run(s);
  assert.equal(result.status,1,result.stderr);
  assert(JSON.parse(result.stdout).blockers.some(b=>b.blockers.some(x=>x.kind==='lease')));
});
test('duplicate root JSON authority is rejected (including unicode aliases)',()=>{
  for (const raw of [
    '{"schema_version":1,"schema_version":1,"as_of":"2026-11-06T18:00:00Z","candidates":[]}',
    '{"schema_version":1,"\u0073chema_version":1,"as_of":"2026-11-06T18:00:00Z","candidates":[]}'
  ]) {
    const r=run(raw); assert.equal(r.status,2,r.stderr);assert.match(r.stderr,/duplicate JSON authority/);
  }
});
test('nested duplicate JSON authority is rejected',()=>{
  const raw=JSON.stringify(snapshot()).replace('"state":"open"','"state":"closed","state":"open"');
  const r=run(raw); assert.equal(r.status,2,r.stderr);assert.match(r.stderr,/duplicate JSON authority/);
});
test('unknown backend identity blocks qualification',()=>{
  const s=snapshot();s.candidates[2].repo='ores-truffle-oreslang/oreslang-source.spoof';
  const r=run(s);assert.equal(r.status,1,r.stderr);
  assert(JSON.parse(r.stdout).blockers.some(x=>x.blockers.some(y=>y.kind==='metadata')));
});
