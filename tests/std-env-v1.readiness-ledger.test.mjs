// SOURCE_ONLY exact-ref registry audit; NOT a guest, host or CI attestation.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const doc = JSON.parse(readFileSync(
  new URL('../contracts/std-env-v1/readiness-ledger-2026-11-22.json',import.meta.url), 'utf8'));
const backends = ['java','llvm','net','rs','forge','cranelift','js','wasm','atto','realtime','hdl'];
const sha40 = x => typeof x === 'string' && /^[0-9a-f]{40}$/.test(x) && !/^0+$/.test(x);
const byBackend = Object.fromEntries(doc.targets.map(x=>[x.backend,x]));

test('ledger contains all 11 uniquely identified exact source trees',()=>{
  assert.equal(doc.schema,'atto.std-env.readiness-ledger.v1');
  assert.equal(doc.claim,'SNAPSHOT_ONLY_NONPROMOTING');
  assert.deepEqual(doc.targets.map(x=>x.backend).sort(),backends.sort());
  assert.equal(Object.keys(byBackend).length,11);
  for(const target of doc.targets){
    assert.equal(target.repository,'atto-lang/atto-source.'+target.backend);
    assert.ok(sha40(target.source_commit),target.backend+' missing commit');
    assert.ok(sha40(target.root_tree),target.backend+' missing tree');
    assert.notEqual(target.source_commit,target.root_tree);
    assert.equal(target.ref_kind,target.pr?'DRAFT_PR_HEAD':'MAIN_HEAD');
  }
});

test('all guest and AOT statuses are unexecuted, including local host passes',()=>{
  for(const target of doc.targets){
    assert.equal(target.guest_status,'NOT_EXECUTED',target.backend);
    assert.equal(target.aot_status,'NOT_EXECUTED',target.backend);
  }
  assert.equal(byBackend.js.host_evidence,'LOCAL_HOST_15_NODE_TESTS');
  assert.equal(byBackend.wasm.host_evidence,'LOCAL_HOST_15_NODE_TESTS');
  assert.equal(byBackend.llvm.host_evidence,'LOCAL_HOST_4_SANITIZER_CONFIGS');
  for(const name of ['java','net','rs','forge','cranelift','atto','realtime','hdl'])
    assert.equal(byBackend[name].host_evidence,'NOT_EXECUTED');
});

test('source-free carrier can be a capacity proof but never a guest source export',()=>{
  assert.equal(doc.compiler_source_copied_to_carrier,false);
  assert.equal(doc.sourcefree_carrier.run_id,45057734221);
  assert.equal(doc.sourcefree_carrier.evidence_category,'SOURCE_FREE_ONLY');
  assert.equal(doc.sourcefree_carrier.guest_qualified,false);
});

test('unsupported targets require explicit capability gates, not fabricated PASS',()=>{
  assert.equal(byBackend.hdl.implementation_stage,'runtime_environment_unavailable_in_synthesis');
  assert.equal(byBackend.realtime.implementation_stage,'bounded_startup_provider_pending');
  assert.equal(byBackend.atto.implementation_stage,'selfhost_bootstrap_only');
  assert.equal(doc.targets.filter(t=>t.guest_status==='PASSED').length,0);
});
