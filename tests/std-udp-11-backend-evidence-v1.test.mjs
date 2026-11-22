import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ledger=JSON.parse(readFileSync(new URL(
  '../contracts/std-udp-11-backend-evidence-v1.json',import.meta.url),'utf8'));
const backends=['atto','net','hdl','java','realtime','rs','llvm','js',
  'forge','wasm','cranelift'];
const oid=/^[0-9a-f]{40}$/;
const clone=x=>structuredClone(x);
const assertOid=x=>assert.match(x,oid);
const validStatus=new Set(['passed','failed','unsupported','not_executed','not_implemented']);

function requireExecutableReceipt(status,receipt) {
  assert(validStatus.has(status),'unknown evidence status');
  if(status!=='passed') return;
  assert(receipt && typeof receipt==='object',
    'PASS requires an independently authenticated execution receipt');
  for(const field of ledger.guest_pass_admission.required_fields) {
    assert(Object.hasOwn(receipt,field), 'missing real guest proof field '+field);
  }
  assertOid(receipt.compiler_head_sha);
  assertOid(receipt.source_tree_sha);
  assert(Number.isSafeInteger(receipt.executed_steps) &&
    receipt.executed_steps>=ledger.guest_pass_admission.minimum_actual_steps,
    'zero-step CI is NOT_EXECUTED, not guest PASS');
  assert(Number.isSafeInteger(receipt.actual_run_id) && receipt.actual_run_id>0);
  assert.equal(receipt.positive_guest_exit,42,
    'compiled Atto UDP guest has not returned required 42');
  assert(Array.isArray(receipt.negative_guest_results) &&
    receipt.negative_guest_results.length>=1,
    'guest permission/ownership negatives are mandatory');
  assert(typeof receipt.toolchain==='string' && receipt.toolchain.length>0);
  assert(typeof receipt.target==='string' && receipt.target.length>0);
}

function validate(m) {
  assert.equal(m.schema,'atto.std-udp-11-backend-evidence.v1');
  assert.equal(m.compiler_repository_count,11);
  assert.equal(m.source.length,11);
  assert.deepEqual(m.source.map(x=>x.backend),backends);
  assert.deepEqual(m.status_vocabulary,
    ['passed','failed','unsupported','not_executed','not_implemented']);
  const names=new Set();
  let drafts=0,bootstraps=0,hostPass=0;
  for(const x of m.source) {
    assert.equal(x.repository,'atto-lang/atto-source.'+x.backend);
    assert(!names.has(x.repository),'duplicate compiler source');
    names.add(x.repository);
    assertOid(x.reference.head_sha);
    assert.equal(x.source_model_is_not_guest,true);
    if(x.reference.kind==='draft_pr') {
      drafts++;
      assert(Number.isSafeInteger(x.reference.pr) && x.reference.pr>0);
      assert.equal(x.reference.branch,
        'feat/std-net-udp-datagram-policy-20261122');
    } else {
      assert.equal(x.reference.kind,'main_bootstrap');
      bootstraps++;
      assert(['atto','realtime'].includes(x.backend));
    }
    assert(validStatus.has(x.host.status));
    if(x.host.status==='passed') {
      hostPass++;
      const r=x.host.receipt;
      assert(r && typeof r.kind==='string' && r.kind.length>0);
      assert(Number.isSafeInteger(r.cases) && r.cases>0);
      assert(Number.isSafeInteger(r.repetitions) && r.repetitions>0);
      assert(Array.isArray(r.blob_sha) && r.blob_sha.length>=2);
      r.blob_sha.forEach(assertOid);
      assert(typeof r.caveat==='string' && /not|no |only/i.test(r.caveat),
        'host-only receipt must state its guest limitations');
    }
    requireExecutableReceipt(x.compiled_atto_guest.status,x.compiled_atto_guest.receipt);
    requireExecutableReceipt(x.aot.status,x.aot.receipt);
    if(x.phase==='bootstrap') {
      assert.equal(x.compiled_atto_guest.status,'not_implemented');
      assert.equal(x.aot.status,'not_implemented');
    }
    if(x.compiled_atto_guest.status==='passed') {
      assert.equal(x.host.status,'passed',
        'a compiled physical UDP guest needs a real host transport too');
    }
  }
  assert.equal(drafts,9);
  assert.equal(bootstraps,2);
  assert.equal(hostPass,4);
  assert.equal(m.shared_source_model.scope,
    'translated JS model, not .atto parser or compiler');
  assert.equal(m.shared_source_model.status,'passed');
  assert(m.ci.source_free_carriers_observed.length>=1);
  for(const canary of m.ci.source_free_carriers_observed) {
    assert(Number.isSafeInteger(canary.run_id) && canary.run_id>0);
    assert(Number.isSafeInteger(canary.executed_steps) &&
      canary.executed_steps>=0);
    if(canary.executed_steps===0)
      assert.equal(canary.result,'runner_admission_failure_not_compiler_result');
  }
  if(m.ci.carrier_capacity_proven)
    assert(m.ci.source_free_carriers_observed.some(x=>x.executed_steps>0),
      'cannot prove carrier capacity with zero-step runs');
  if(m.ci.private_source_mirrored || m.ci.source_mirror_permitted) {
    assert.equal(m.ci.authenticated_export_clearance,true,
      'private-source export requires independent clearance');
    assert.equal(m.ci.carrier_capacity_proven,true,
      'private-source export requires a stepful source-free canary');
  }
}

test('eleven backend inventory is exact and host/model successes never promote guests',()=>{
  validate(ledger);
  assert(ledger.source.every(x=>x.compiled_atto_guest.status!=='passed'));
});

test('fraudulent zero-step guest PASS and missing negatives are rejected',()=>{
  const fake=clone(ledger);
  fake.source[3].compiled_atto_guest={
    status:'passed',receipt:{executed_steps:0,positive_guest_exit:42}};
  assert.throws(()=>validate(fake));
});

test('private mirror without authorized export and proven carrier is rejected',()=>{
  const fake=clone(ledger);
  fake.ci.private_source_mirrored=true;
  assert.throws(()=>validate(fake));
  const fakeCapacity=clone(ledger);
  fakeCapacity.ci.carrier_capacity_proven=true;
  assert.throws(()=>validate(fakeCapacity));
});

test('missing backend or forged host receipt cannot produce a pass',()=>{
  const missing=clone(ledger);
  missing.source.pop();
  assert.throws(()=>validate(missing));
  const fake=clone(ledger);
  fake.source[1].host={status:'passed',receipt:null};
  assert.throws(()=>validate(fake));
});
