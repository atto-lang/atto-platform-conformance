import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('../contracts/pull-push-admission-v1.json',import.meta.url)));

function assertManifest(m) {
  assert.equal(m.schema,'atto.pull-push-admission.v1');
  assert.equal(m.status,'TARGET_ONLY_NO_ATTO_GUEST_EXECUTION');
  assert.deepEqual(Object.keys(m.backends).sort(),['forge','java','llvm','net','wasm']);
  for(const [id,b] of Object.entries(m.backends)) {
    assert.equal(b.status,'NOT_EXECUTED',`${id} cannot be claimed verified by a contract`);
    assert.match(b.repository,/^ores-truffle-oreslang\/oreslang-source\./);
  }
  assert.ok(m.cases.length>=18);
  const ids=m.cases.map(c=>c.id);
  assert.equal(new Set(ids).size,ids.length);
  const classes=new Set(['guest-positive','guest-negative','compile-negative','concurrency-positive','concurrency-negative','security-negative','memory-profile']);
  for(const c of m.cases) {
    assert.match(c.id,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(classes.has(c.class),`unrecognized class ${c.class}`);
    assert.equal(typeof c.expect,'string'); assert.ok(c.expect.length>2);
    assert.equal(Object.hasOwn(c,'status'),false,'case cannot self-report a pass');
  }
  const required=new Set(['source_commit_sha','source_tree_sha','fixture_blob_sha','compiler_commit_sha','workflow_url','run_id','job_id','steps_executed','guest_executed','artifact_sha256']);
  assert.ok([...required].every(k=>m.evidencePolicy.requiredBeforePass.includes(k)));
  return ids;
}

function validateClaim(claim,m) {
  const ids=assertManifest(m);
  if(!ids.includes(claim.case_id)||!Object.hasOwn(m.backends,claim.backend))throw Error('unknown case/backend');
  if(claim.status==='passed')throw Error('unverified PASS blocked: independently authenticated guest receipts required');
  if(!['not_executed','unsupported','failed'].includes(claim.status))throw Error('invalid status');
  if(typeof claim.reason!=='string'||!claim.reason.trim())throw Error('non-pass needs a reason');
  return true;
}

test('baseline has five pending backends and full category coverage',()=>{
  const ids=assertManifest(manifest);
  for(const id of ['pull-infinite-take-is-lazy','failed-send-retains-owned-value','demand-zero-negative-overflow','stale-actor-generation','native-fusion-no-tracing-gc']) assert.ok(ids.includes(id));
});

test('irrevocable terminal case is a required cross-backend execution gate',()=>{
  const ids=assertManifest(manifest);
  assert.ok(ids.includes('terminal-complete-cancel-race'));
  const terminal=manifest.cases.find(c=>c.id==='terminal-complete-cancel-race');
  assert.equal(terminal.class,'concurrency-positive');
  assert.match(terminal.expect,/cancel.*after.*complete.*rejected/i);
  for(const backend of Object.values(manifest.backends)){
    assert.equal(backend.status,'NOT_EXECUTED');
  }
});

test('all unattended PASS claims are rejected even with fake provenance',()=>{
  assert.throws(()=>validateClaim({backend:'llvm',case_id:'no-unsolicited-next',status:'passed',guest_executed:true,run_id:123,job_id:456,steps_executed:7},manifest),/unverified PASS/);
});

test('unknown backend and case identifiers fail closed',()=>{
  assert.throws(()=>validateClaim({backend:'fake',case_id:'no-unsolicited-next',status:'not_executed',reason:'pending'},manifest),/unknown/);
  assert.throws(()=>validateClaim({backend:'wasm',case_id:'fake',status:'not_executed',reason:'pending'},manifest),/unknown/);
});

test('nonpassing claims require an explicit reason',()=>{
  assert.throws(()=>validateClaim({backend:'wasm',case_id:'no-unsolicited-next',status:'unsupported'},manifest),/reason/);
  assert.equal(validateClaim({backend:'wasm',case_id:'no-unsolicited-next',status:'not_executed',reason:'guest adapter not implemented'},manifest),true);
});

test('manifest cannot silently promote a backend or embed case passing status',()=>{
  const a=structuredClone(manifest);a.backends.java.status='PASSED';assert.throws(()=>assertManifest(a),/cannot be claimed/);
  const b=structuredClone(manifest);b.cases[0].status='passed';assert.throws(()=>assertManifest(b),/cannot self-report/);
});

test('duplicate case IDs and missing evidence identities fail',()=>{
  const a=structuredClone(manifest);a.cases.push({...a.cases[0]});assert.throws(()=>assertManifest(a));
  const b=structuredClone(manifest);b.evidencePolicy.requiredBeforePass=b.evidencePolicy.requiredBeforePass.filter(x=>x!=='fixture_blob_sha');assert.throws(()=>assertManifest(b));
});
