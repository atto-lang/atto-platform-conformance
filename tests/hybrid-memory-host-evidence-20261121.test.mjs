import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// PROVENANCE CHECK ONLY: this test reads a historical, scope-limited receipt.
// It does not re-execute native code or certify Atto guest/runtime behavior.
const e = JSON.parse(readFileSync(
  new URL('../evidence/hybrid-memory/host-abi-cross-language-20261121.json', import.meta.url), 'utf8'));
test('hybrid memory host receipt has exact six source heads and immutable blob inventory', () => {
  assert.equal(e.schema_version,1);
  assert.equal(e.contract,'atto.hybrid-actor-memory.v1');
  assert.equal(e.classification,'HOST_ONLY_EXECUTED');
  assert.equal(e.provenance.conclusion,'success');
  assert.equal(e.provenance.steps_nonempty,true);
  assert.equal(e.provenance.exact_blob_checked,true);
  assert.equal(e.provenance.token_free_mirror,true);
  assert.equal(e.provenance.compiler_guest_executed,false);
  assert.equal(e.provenance.run_url,
    'https://github.com/ores-data-platform/atto-ci/actions/runs/44946676034');
  assert.deepEqual(Object.keys(e.source_branches).sort(),
    ['llvm','java','forge','wasm','rs','net'].sort());
  for(const source of Object.values(e.source_branches)) {
    assert.match(source.head,/^[a-f0-9]{40}$/);
    assert.ok(source.pr>0);
    assert.ok(source.repo.startsWith('atto-lang/atto-source.'));
    assert.ok(Object.keys(source.checked_blobs).length>=2);
    for(const blob of Object.values(source.checked_blobs))
      assert.match(blob,/^[a-f0-9]{40}$/);
  }
});
test('host sanitizer and codec proof is never promoted to compiled guest parity',()=>{
  const results=e.host_results;
  assert.equal(results.llvm_c11.matrix.length,4);
  assert.equal(results.forge_cpp20.matrix.length,4);
  assert.equal(results.wasm_node_host.tests,11);
  assert.equal(results.rust_ref_layout_standalone.tests,8);
  assert.equal(results.node_reference_and_profile.tests,13);
  assert.equal(results.registry_alignment.backends,11);
  assert.equal(results.registry_alignment.features,20);
  assert.equal(results.net10_standalone_codec.full_actor_runtime_compiled,false);
  assert.equal(results.net10_standalone_codec.nativeaot_guest_executed,false);
  for(const result of Object.values(results)) {
    assert.equal(result.status,'passed');
    assert.equal(result.guest,false);
  }
  assert.deepEqual(Object.keys(e.compiled_guest_status).sort(),
    ['java','llvm','net','forge','wasm','rs','cranelift','js','atto','hdl','realtime'].sort());
  for(const status of Object.values(e.compiled_guest_status))
    assert.equal(status,'NOT_EXECUTED');
});
