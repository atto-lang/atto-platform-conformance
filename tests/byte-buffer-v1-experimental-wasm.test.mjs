import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const evidence=read('evidence/byte-buffer-v1-experimental-wasm-guest.json');
const registry=read('contracts/byte-buffer-v1.json');
test('real partial Wasm guest evidence does not certify the canonical stdlib or negatives',()=>{
  assert.equal(evidence.schema,'atto.byte-buffer.experimental-wasm-guest.v1');
  assert.equal(evidence.status,'BOUNDED_POSITIVE_GUEST_EXECUTED_NOT_FULL_CONFORMANCE');
  assert.equal(evidence.full_atto_byte_buffer_v1_guest_conformance,'NOT_EXECUTED');
  assert.equal(evidence.release_authorized,false);
  assert.equal(evidence.local_test_groups.passed,5);
  assert.equal(evidence.local_test_groups.failed,0);
  assert.equal(evidence.compiled_wasm.host_imports,0);
  assert.equal(evidence.compiled_wasm.guest_exit_for_BB_001,'1');
  assert.equal(evidence.compiled_wasm.independent_compiled_guest_variations,256);
  assert.equal(evidence.compiled_wasm.positive_fixture_count,11);
  assert.deepEqual(Object.keys(evidence.source_fixture_provenance),evidence.compiled_wasm.positive_fixture_ids);
  const cases=new Map(registry.cases.map(x=>[x.id,x]));
  for(const id of evidence.compiled_wasm.positive_fixture_ids){
    assert.equal(cases.get(id).expected,'EXIT_1');
    assert.match(evidence.source_fixture_provenance[id],/^[0-9a-f]{40}$/);
  }
  for(const entry of registry.backends){
    assert.equal(entry.execution,'NOT_EXECUTED');
    assert.equal(entry.receipt,null);
  }
  for(const [key,value] of Object.entries(evidence.evidence_limitations)){
    if(key==='source_org_actions_zero_step_not_pass')assert.equal(value,true);
    else assert.equal(value,false,key);
  }
});
