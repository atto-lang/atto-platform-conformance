import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {auditLedger} from '../tools/landed-main-evidence.mjs';

const evidencePath=fileURLToPath(new URL('../evidence/landed-main-20261106-platform-wave.json',import.meta.url));
const load=()=>JSON.parse(readFileSync(evidencePath,'utf8'));
const expected=new Map([
 ['oreslang-platform.asic#14',['04eac14cf4c456d0b23a903a208febb8f13c4648','6fe30448423ab3b8c13590f3643669ad4bd60a67']],
 ['oreslang-platform.mobile#20',['81ee60ab4aba9dc6b58c5b46709340848ca1a226','66c645b19201b4fc4a6d3aee52c23ebc1ec9a200']],
 ['oreslang-platform.desktop#32',['cc12e421166700d65d4e3162fc1ea6095a7fa597','a310bdfed894bcc46f49d8287d70e52ca41708e9']],
 ['oreslang-platform-conformance#468',['bb62cdc864463446925202afa9ea9b40b74d16b7','1e8e424fe305c8893dd19d69d3477284fa263422']],
 ['oreslang-platform-conformance#482',['1235a720f63cce20038727880052fdf83139eb3f','229d1b7a0805c6d4d1332bbe0cbc92db4e172ca7']]
]);
test('exactly five landed PRs across four source-organization repositories',()=>{
 const l=load();
 assert.equal(l.scope,'snapshot_only');assert.equal(l.entries.length,5);
 assert.equal(new Set(l.entries.map(x=>x.repo)).size,4);
 assert.equal(new Set(l.entries.map(x=>x.repo+'#'+x.pr)).size,5);
 assert.deepEqual(new Set(l.entries.map(x=>x.repo.split('/')[0])),new Set(['ores-truffle-oreslang']));
});
test('pinned landed Git commits and trees match independent GitHub observations',()=>{
 for(const e of load().entries){
   const key=e.repo.split('/')[1]+'#'+e.pr;
   assert.deepEqual([e.merge_sha,e.landed_tree_sha],expected.get(key),key);
   assert.equal(e.merged,true);assert.equal(e.base_ref,'main');
   assert.match(e.pr_head_sha,/^[a-f0-9]{40}$/);assert.notEqual(e.pr_head_sha,e.merge_sha);
 }
});
test('ancestry distinguishes first conformance merge from final main',()=>{
 for(const e of load().entries){
   const o=e.main_observation;
   assert.equal(o.merge_base_sha,e.merge_sha);assert.equal(o.behind_by,0);
   if(e.pr===468) {
     assert.equal(o.compare_status,'ahead');assert.equal(o.ahead_by,1);
     assert.equal(o.head_sha,'1235a720f63cce20038727880052fdf83139eb3f');
   } else {
     assert.equal(o.compare_status,'identical');assert.equal(o.ahead_by,0);
     assert.equal(o.head_sha,e.merge_sha);
   }
 }
});
test('all five remain blocked without protections, independent reviews and landed CI',()=>{
 const l=load(),r=auditLedger(l);
 assert.equal(r.status,'BLOCKED');assert.equal(r.blocked,5);
 for(const e of r.entries){
   assert.equal(e.status,'BLOCKED');
   for(const kind of ['protection','review','test','ci'])
     assert(e.blockers.some(b=>b.kind===kind),e.repo+' '+kind);
 }
});
test('historical PR-head zero-runner records never enter landed CI evidence',()=>{
 for(const e of load().entries){
   assert.deepEqual(e.source_owned_runs,[]);
   assert.equal(e.pr_head_ci_observation.scope,'historical_pr_head_only_not_landed');
   assert.equal(e.pr_head_ci_observation.result,'RUNNER_NOT_ALLOCATED');
   assert.equal(e.pr_head_ci_observation.runner_id,null);
   assert.equal(e.pr_head_ci_observation.executed_steps,0);
   assert.equal(e.pr_head_ci_observation.conclusion,'failure');
   assert(e.pr_head_ci_observation.run_id>0);assert(e.pr_head_ci_observation.job_id>0);
 }
});
test('no fabricated guest compilation, fixture results or independent approval',()=>{
 for(const e of load().entries){
   assert.match(e.repo,/\/oreslang-platform[.-]/);
   assert.equal(e.requires_guest,false);
   assert.deepEqual(e.required_tests,[]);assert.deepEqual(e.required_checks,[]);
   assert.deepEqual(e.approvals,[]);assert.equal(e.protection.protected,false);
 }
});
test('even fabricated protected main cannot substitute for review or runner evidence',()=>{
 const l=load();
 for(const e of l.entries)e.protection={protected:true,required_approvals:1,codeowners:true,
   dismiss_stale:true,strict_checks:true,enforce_admins:true,bypass_count:0,
   force_pushes_allowed:false,deletions_allowed:false};
 const r=auditLedger(l);assert.equal(r.blocked,5);
 assert(r.entries.every(x=>x.blockers.some(b=>b.kind==='review')&&x.blockers.some(b=>b.kind==='ci')));
});
test('tampered main ancestry is rejected',()=>{
 const l=load();l.entries[0].main_observation.merge_base_sha='f'.repeat(40);
 assert(auditLedger(l).entries[0].blockers.some(b=>b.kind==='ancestry'));
});
test('duplicate merge identity is flagged, not double counted',()=>{
 const l=load();l.entries.push(structuredClone(l.entries[0]));
 assert(auditLedger(l).entries.at(-1).blockers.some(b=>b.reason==='duplicate_pr_or_merge_commit'));
});
