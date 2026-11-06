import test from 'node:test';
import assert from 'node:assert/strict';
import {auditEntry,auditLedger} from '../tools/landed-main-evidence.mjs';
const A='a'.repeat(40), B='b'.repeat(40), C='c'.repeat(40);
function good(){return {
  repo:'ores-truffle-oreslang/oreslang-source.java',pr:7,author:'contributor',pr_head_sha:A,merge_sha:B,
  main_observation:{head_sha:B,compare_status:'identical',behind_by:0},
  protection:{protected:true,required_approvals:1,codeowners:true,dismiss_stale:true,strict_checks:true,enforce_admins:true,bypass_count:0},
  approvals:[{login:'independent-reviewer',state:'APPROVED',reviewed_commit_sha:B}],
  required_checks:[{context:'compiler-guest',app_id:15368}],requires_guest:true,
  source_owned_runs:[{scope:'landed-main',commit_sha:B,tree_sha:C,context:'compiler-guest',app_id:15368,
    run_id:10,run_attempt:1,job_id:11,runner_id:22,conclusion:'success',
    steps:[{name:'Set up job',conclusion:'success'},{name:'Compile and execute native guest',conclusion:'success'}],
    tests:[{id:'scalar-42',kind:'compiler-guest',status:'PASS'},{id:'bad-import',kind:'negative',status:'PASS'}]}]
};}
const led=e=>({schema_version:1,scope:'snapshot_only',captured_at:'2026-11-06T19:00:29Z',entries:[e]});
function denies(label,mutate,kind){test(label,()=>{const e=good();mutate(e);assert(auditEntry(e).some(x=>x.kind===kind),JSON.stringify(auditEntry(e)));});}
test('even complete synthetic proof is advisory and requires LIVE recheck',()=>{
 const out=auditLedger(led(good()));assert.equal(out.status,'SNAPSHOT_READY_RECHECK_LIVE');
 assert.equal(out.entries[0].status,'SNAPSHOT_READY_RECHECK_LIVE');assert.match(out.note,/re-fetch live/);
});
denies('reject unprotected main',e=>e.protection.protected=false,'protection');
denies('reject missing minimum review count',e=>delete e.protection.required_approvals,'protection');
denies('reject stale review head',e=>e.approvals[0].reviewed_commit_sha=A,'review');
denies('reject operator-controlled approval',e=>e.approvals[0].login='ORESoftware','review');
denies('reject author self approval',e=>e.approvals[0].login='contributor','review');
denies('reject zero-runner job',e=>e.source_owned_runs[0].runner_id=0,'ci');
denies('reject zero-step job',e=>e.source_owned_runs[0].steps=[],'ci');
denies('reject housekeeping-only steps',e=>e.source_owned_runs[0].steps=[{name:'Set  up job',conclusion:'success'}],'ci');
denies('reject checkout-only step',e=>e.source_owned_runs[0].steps=[{name:'Run actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',conclusion:'success'}],'ci');
denies('reject source-head-verification-only step',e=>e.source_owned_runs[0].steps=[{name:'Verify exact PR head and clean source tree',conclusion:'success'}],'ci');
denies('reject stale PR-head test for landed-main',e=>e.source_owned_runs[0].commit_sha=A,'ci');
denies('reject wrong check issuer',e=>e.source_owned_runs[0].app_id=44,'ci');
denies('reject missing required job',e=>e.required_checks.push({context:'security',app_id:15368}),'ci');
denies('reject failed negative test',e=>e.source_owned_runs[0].tests[1].status='FAIL','ci');
denies('reject unsupported as pass',e=>e.source_owned_runs[0].tests[0].status='UNSUPPORTED','ci');
denies('reject unexecuted as pass',e=>e.source_owned_runs[0].tests[0].status='NOT_EXECUTED','ci');
denies('reject host-only work as native proof',e=>e.source_owned_runs[0].tests[0].kind='host','guest');
denies('reject missing main ancestry',e=>e.main_observation.compare_status='diverged','ancestry');
denies('reject mismatched identical main',e=>e.main_observation.head_sha=C,'ancestry');
denies('reject stale/bypass protections',e=>e.protection.bypass_count=1,'protection');
denies('reject missing approved codeowner policy',e=>e.protection.codeowners=false,'protection');
denies('reject invalid SHA',e=>e.merge_sha='bad','identity');
test('duplicate PR entries fail closed',()=>{const g=good(),l=led(g);l.entries.push(structuredClone(g));assert.equal(auditLedger(l).blocked,1);});
test('bad/oversized ledger fails closed',()=>{assert.throws(()=>auditLedger({}));assert.throws(()=>auditLedger({...led(good()),entries:Array(101).fill(good())}));});
test('realistic unprotected and zero-step merge snapshot stays blocked',()=>{const e=good();e.protection={protected:false};e.approvals=[];e.source_owned_runs=[];const r=auditLedger(led(e));assert.equal(r.status,'BLOCKED');assert.deepEqual(r.entries[0].blockers.map(x=>x.kind),['protection','review','ci','guest']);});
