import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('ETS/pg source-free matrix never upgrades backends without guest evidence',()=>{
 const path=new URL('../contracts/ets-pg-local-v1.json',import.meta.url);
 const data=JSON.parse(readFileSync(path,'utf8'));
 assert.equal(data.version,1);
 assert.equal(data.evidence_type,'source_free_model_only');
 assert.deepEqual(Object.keys(data.backends).sort(),
  ['java','llvm','wasm','cranelift','net','forge'].sort());
 for(const [name,status] of Object.entries(data.backends)){
  assert.equal(status.source_guest,'unverified',name);
  assert.match(status.host_evidence,/^[a-z0-9_]+$/);
 }
 assert.ok(data.required_test_cases.includes('pg_group_id_aba'));
 assert.ok(data.required_test_cases.includes('pg_partial_mailbox_backpressure'));
 assert.ok(data.required_test_cases.includes('pg_cross_isolate_denied'));
 assert.ok(data.required_test_cases.includes('ets_versioned_cas_aba'));
 assert.ok(data.required_test_cases.includes('vm_zero_cold_thread_budget'));
 assert.ok(data.promotion_gate.includes('real_authenticated_actor_mailbox_admission'));
 assert.ok(data.promotion_gate.includes('negative_no_IR_for_unsupported_source'));
});
