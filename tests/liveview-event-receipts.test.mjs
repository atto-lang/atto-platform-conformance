import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EVENT_BLOB,EVENT_BACKENDS,validateEventVectors,validateEventReceipt} from '../src/liveview-event-receipts.mjs';
const raw=readFileSync(new URL('../contracts/v1/ores-liveview-event-fingerprint-v1.json',import.meta.url),'utf8');
const registry=JSON.parse(raw);
const clone=v=>structuredClone(v);
const rejected=fn=>assert.throws(fn,/LIVEVIEW_EVENT_GATE/);
const fake=()=>({schema:'ores-liveview-event-backend-receipt-v1',fixture_blob:EVENT_BLOB,
  backends:EVENT_BACKENDS.map(backend=>({backend,repository:'ores-truffle-oreslang/oreslang-source.'+backend,
    head_sha:'a'.repeat(40),tree_sha:'b'.repeat(40),runner:{run_id:1,job_id:2,runner_id:3,step_count:4,head_sha:'a'.repeat(40)},
    guest:{compiled:true,executed:true,actual_socket_io:true,actor_owned_state:true,binary_sha256:'c'.repeat(64)},
    results:registry.cases.map(c=>({case_id:c.id,sha256:c.sha256}))}))});
test('canonical fixture has exact immutable Git blob and eight real SHA-256 goldens',()=>{
  assert.equal(validateEventVectors(registry,raw).fixture_blob,EVENT_BLOB);
  assert.equal(validateEventVectors(registry,raw).vector_count,8);
});
test('synthetic complete receipts never authenticate native backend parity',()=>{
  assert.deepEqual(validateEventReceipt(fake(),registry),{structurally_complete:true,runner_provenance_authenticated:false,
    guest_execution_authenticated:false,backend_parity_certified:false,backend_count:5});
});
const mutations=[
['missing-backend',r=>r.backends.pop()],['duplicate-backend',r=>r.backends[1].backend='java'],
['wrong-repository',r=>r.backends[0].repository='other/repo'],['bad-head',r=>r.backends[0].head_sha='!'],
['runner-zero-steps',r=>r.backends[0].runner.step_count=0],['runner-mismatch',r=>r.backends[0].runner.head_sha='b'.repeat(40)],
['host-only',r=>r.backends[0].guest.compiled=false],['no-socket',r=>r.backends[0].guest.actual_socket_io=false],
['no-actor-ownership',r=>r.backends[0].guest.actor_owned_state=false],['missing-vector',r=>r.backends[0].results.pop()],
['duplicate-vector',r=>r.backends[0].results[1].case_id=r.backends[0].results[0].case_id],
['unknown-vector',r=>r.backends[0].results[0].case_id='invented'],
['wrong-hash',r=>r.backends[0].results[0].sha256='0'.repeat(64)],['wrong-fixture',r=>r.fixture_blob='d'.repeat(40)],
['extra-field',r=>r.backends[0].certified=true]];
for(const [name,change] of mutations)test('receipt fail-closed: '+name,()=>{const v=fake();change(v);rejected(()=>validateEventReceipt(v,registry));});
test('canonical key order is required independent of fixture SHA check',()=>{
  const changed=clone(registry);changed.cases[1].canonical_payload_json='{"z":3,"a":1,"b":2}';
  rejected(()=>validateEventVectors(changed,JSON.stringify(changed)));
});
test('tampered digest or Unicode vector is rejected independently of host runtime',()=>{
  const changed=clone(registry);changed.cases[3].sha256='0'.repeat(64);
  rejected(()=>validateEventVectors(changed,JSON.stringify(changed)));
});
test('fingerprint receipt rejects non-five-backend host shim',()=>{
  const report=fake();report.backends[4].backend='node';rejected(()=>validateEventReceipt(report,registry));
});
