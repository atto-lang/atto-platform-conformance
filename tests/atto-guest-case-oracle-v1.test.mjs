import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {evaluateGuestCaseInventory,validateGuestCaseInventory} from '../tools/atto-guest-case-oracle-v1.mjs';
import {evaluateCandidate} from '../tools/atto-five-backend-certification-v1.mjs';
const path=fileURLToPath(new URL('../contracts/atto-guest-case-oracle-v1.json',import.meta.url));
const fresh=()=>JSON.parse(readFileSync(path,'utf8'));
function denies(name,fn){
 test(name,()=>{
  const s=fresh();fn(s);
  assert.throws(()=>validateGuestCaseInventory(s),TypeError);
 });
}
test('exact 20 cases across five backends are structured yet never executed',()=>{
 const r=evaluateGuestCaseInventory(fresh());
 assert.equal(r.status,'BLOCKED');
 assert.equal(r.release_authorized,false);
 assert.equal(r.suite_count,2);
 assert.equal(r.case_count,20);
 assert.equal(r.backend_case_cells,100);
 assert.equal(r.executed_guest_cells,0);
 assert.deepEqual(r.required_backends,['java','llvm','wasm','forge','net']);
 for(const suite of r.suites)
  for(const c of suite.cases)
   assert(Object.values(c.backend_results).every(x=>x==='NOT_EXECUTED'));
});
test('task and actor positive/negative coverage remains complete',()=>{
 const r=evaluateGuestCaseInventory(fresh());
 const actor=r.suites.find(x=>x.id==='actor-channel-v1');
 const task=r.suites.find(x=>x.id==='portable-task-v1');
 assert.equal(actor.case_count,6);assert.equal(actor.positive_count,3);assert.equal(actor.negative_count,3);
 assert.equal(task.case_count,14);assert.equal(task.positive_count,10);assert.equal(task.negative_count,4);
 assert.equal(r.suites.reduce((n,x)=>n+x.negative_count,0),7);
 assert.equal(r.suites.reduce((n,x)=>n+x.positive_count,0),13);
});
test('Forge cannot be silently substituted for Cranelift in proposed actor draft',()=>{
 const r=evaluateGuestCaseInventory(fresh());
 assert.deepEqual(r.suites[0].missing_required_backends,['forge']);
 assert.deepEqual(r.suites[0].unexpected_original_backends,['cranelift']);
 assert(r.holds.includes('SOURCE_BACKEND_ROSTER_MISMATCH'));
 assert.deepEqual(r.suites[1].missing_required_backends,[]);
});
test('all sources, fixture hashes and proposed oracles remain pinned',()=>{
 const s=fresh();
 assert.equal(validateGuestCaseInventory(s),true);
 assert.equal(s.suites[0].source.manifest_blob_sha,'68401237c65beb48b2e3d680e01830d0afe79f51');
 assert.equal(s.suites[1].source.manifest_blob_sha,'5a53b01ad864805809d06c4747fb8a18430de77e');
 assert.equal(s.suites[0].cases[0].fixture_blob_sha,'bc5c42d269b3e7e6dc5f90aa648db4eab33e4870');
 assert.equal(s.suites[1].cases[0].fixture_blob_sha,'3e1411fad3c9932b4c616a7f0d2f9b378aa3a3ad');
 assert.equal(s.suites[1].cases[10].fixture_blob_sha,'0072db5d74cd72430b3116eef51cb7237faae901');
 assert.equal(s.suites[1].cases[10].expect.expected_diagnostic_category,'ATTO_TASK_E_HASFUTURE_WITNESS');
});
test('all 20 draft case oracles remain pending exact evidence, never PASS',()=>{
 const r=evaluateGuestCaseInventory(fresh());
 for(const suite of r.suites)for(const c of suite.cases){
  assert.match(c.fixture_sha,/^[a-f0-9]{40}$/);
  assert.match(c.oracle_state,/^PENDING_/);
  assert(Object.values(c.backend_results).every(x=>x==='NOT_EXECUTED'));
 }
 assert(r.holds.includes('ALL_CASE_GUEST_RUNS_NOT_EXECUTED'));
 assert(r.holds.includes('EXACT_POSITIVE_BYTES_NOT_ADMITTED'));
 assert(r.holds.includes('NEGATIVE_DIAGNOSTIC_PROVENANCE_INCOMPLETE'));
});
test('Task observations bind the exact source constraints rather than arbitrary strings',()=>{
 const s=fresh(),t=s.suites[1].cases;
 const generic=t.find(x=>x.id==='generic-hasfuture-once');
 assert.deepEqual(generic.expect.required_observations,['projection_count=1']);
 const cancel=t.find(x=>x.id==='cancel-before-start');
 assert.deepEqual(cancel.expect.required_observations,['physical_done=true']);
 assert.deepEqual(cancel.expect.forbidden_observations,['should_not_start']);
 const negative=t.find(x=>x.id==='reject-await-in-critical');
 assert.equal(negative.expect.expected_diagnostic_category,'ATTO_TASK_E_CRITICAL_SUSPEND');
 assert.equal(negative.expect.expected_phase,null);
});
denies('missing backend fails closed',s=>s.required_backends.pop());
denies('duplicate backend fails closed',s=>s.required_backends[4]='java');
denies('foreign backend fails closed',s=>s.required_backends[4]='cranelift');
denies('duplicate suite identity fails closed',s=>s.suites[1].id='actor-channel-v1');
denies('omitted suite fails closed',s=>s.suites.pop());
denies('extra suite fails closed',s=>s.suites.push(structuredClone(s.suites[0])));
denies('missing actor positive fails closed',s=>s.suites[0].cases.shift());
denies('missing Task negative fails closed',s=>s.suites[1].cases.pop());
denies('duplicate case ID fails closed',s=>s.suites[1].cases[1].id=s.suites[1].cases[0].id);
denies('different actor PR head fails closed',s=>s.suites[0].source.pr_head='f'.repeat(40));
denies('different Task manifest Git blob fails closed',s=>s.suites[1].source.manifest_blob_sha='f'.repeat(40));
denies('forged roster with Forge fails closed',s=>s.suites[0].source.original_backends=['java','llvm','wasm','forge','net']);
denies('truncated actor roster fails closed',s=>s.suites[0].source.original_backends.pop());
denies('repeated Task roster entry fails closed',s=>s.suites[1].source.original_backends[1]='java');
denies('unknown actor fixture hash fails closed',s=>s.suites[0].cases[0].fixture_blob_sha='f'.repeat(40));
denies('unknown Task fixture hash fails closed',s=>s.suites[1].cases[0].fixture_blob_sha='f'.repeat(40));
denies('fixture path traversal fails closed',s=>s.suites[1].cases[0].fixture_path='../outside.atto');
denies('case-kind swap fails closed',s=>s.suites[0].cases[0].expect.kind='negative');
denies('missing actor positive stdout fails closed',s=>s.suites[0].cases[0].expect.expected_stdout_text='');
denies('actor stdout weakened to different value fails closed',s=>s.suites[0].cases[0].expect.expected_stdout_text='ok');
denies('actor exit invented from source fails closed',s=>s.suites[0].cases[0].expect.expected_exit_code=0);
denies('actor reject regex weakened fails closed',s=>s.suites[0].cases[3].expect.expected_diagnostic_pattern='.*');
denies('actor reject gets unsupported imaginary diagnostic category',s=>s.suites[0].cases[3].expect.expected_diagnostic_category='SYNTAX_ERROR');
denies('Task expected exit altered fails closed',s=>s.suites[1].cases[0].expect.expected_exit_code=0);
denies('Task required event dropped fails closed',s=>s.suites[1].cases[0].expect.required_observations=[]);
denies('Task forbidden event dropped fails closed',s=>s.suites[1].cases[6].expect.forbidden_observations=[]);
denies('Task required and forbidden overlap fails closed',s=>{
 s.suites[1].cases[6].expect.required_observations.push('should_not_start');
});
denies('Task event spoof nonstring fails closed',s=>s.suites[1].cases[0].expect.required_observations=[42]);
denies('Task targeted negative diagnostic rewritten fails closed',s=>{
 s.suites[1].cases[10].expect.expected_diagnostic_category='ATTO_TASK_E_PARSE_ERROR';
});
denies('Task negative diagnostic phase claimed without evidence fails closed',s=>{
 s.suites[1].cases[10].expect.expected_phase='typechecker';
});
denies('positive exact stdout bytes invented without provenance fails closed',s=>{
 s.suites[0].cases[0].expect.expected_stdout_hex='3432';
});
denies('malicious synthetic PASS evidence cannot be admitted',s=>{
 s.evidence=[{backend:'java',contract:'actor-channel-v1',result:'PASS'}];
});
denies('malformed source timestamp is rejected',s=>s.as_of='yesterday');
denies('future source timestamp is rejected',s=>s.as_of='2099-01-01T00:00:00Z');
denies('wrong advisory scope is rejected',s=>s.scope='release_authority');

const candidatePath=fileURLToPath(new URL('../evidence/atto-five-backend-release-candidate-v1.json',import.meta.url));
const landedPath=fileURLToPath(new URL('../evidence/landed-main-20261106-platform-wave.json',import.meta.url));
const candidate=()=>JSON.parse(readFileSync(candidatePath,'utf8'));
const landed=()=>JSON.parse(readFileSync(landedPath,'utf8'));
test('parent certification report carries exact 20-case inventory and 100 absent execution cells',()=>{
 const r=evaluateCandidate(candidate(),landed(),fresh());
 assert.equal(r.status,'BLOCKED');assert.equal(r.release_authorized,false);
 assert.equal(r.case_oracle_inventory.case_count,20);
 assert.equal(r.case_oracle_inventory.backend_case_cells,100);
 assert.equal(r.case_oracle_inventory.executed_guest_cells,0);
 assert(r.holds.includes('CASE_SOURCE_BACKEND_ROSTER_MISMATCH'));
 assert(r.holds.includes('CASE_ALL_CASE_GUEST_RUNS_NOT_EXECUTED'));
});
test('certification rejects a mismatched normalized case-suite PR head',()=>{
 const c=candidate();c.contracts.find(x=>x.id==='actor-channel-v1').proposal.sha='f'.repeat(40);
 assert.throws(()=>evaluateCandidate(c,landed(),fresh()),/case-level oracle does not match/);
});
test('certification rejects a mismatched normalized source manifest blob',()=>{
 const c=candidate();c.contracts.find(x=>x.id==='portable-task-v1').oracle.manifest_blob_sha='f'.repeat(40);
 assert.throws(()=>evaluateCandidate(c,landed(),fresh()),/case-level oracle does not match/);
});
test('zero fabricated execution remains fail-closed with missing case inventory input',()=>{
 const r=evaluateCandidate(candidate(),landed());
 assert.equal(r.status,'BLOCKED');
 assert(r.holds.includes('CASE_LEVEL_ORACLE_INVENTORY_NOT_EVALUATED'));
 assert.equal(r.release_authorized,false);
});
