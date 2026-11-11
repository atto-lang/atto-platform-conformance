// Provenance/claim-shape validation ONLY. Not an AttoLang compiler test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const inventory=JSON.parse(readFileSync(
  new URL('../../contracts/event-sourcing-backend-parity-v1.json',import.meta.url),'utf8'));
test('five independent toolchains, exact commit heads and no promoted guest evidence',()=>{
  assert.equal(inventory.schema,'atto.event-sourcing.backend-parity/1');
  assert.deepEqual(inventory.backends.map(x=>x.id),['java','llvm','wasm','forge','net']);
  assert.equal(new Set(inventory.backends.map(x=>x.repo)).size,5);
  for(const entry of inventory.backends){
    assert.match(entry.head_sha,/^[a-f0-9]{40}$/);
    assert.equal(entry.compiled_atto_guest,'NOT_EXECUTED');
    assert.ok(entry.required_profiles.length>=2);
    assert.ok(entry.host_wire!=='PASS' && entry.durable_provider!=='PASS');
  }
  assert.equal(inventory.status,'DRAFT_ALL_GUEST_BACKENDS_NOT_EXECUTED');
});
test('host-only success is never labeled source guest or durable provider success',()=>{
  const forge=inventory.backends.find(x=>x.id==='forge');
  assert.equal(forge.host_wire,'LOCAL_STRICT_GCC_CLANG_PASS');
  assert.equal(forge.durable_provider,'NOT_IMPLEMENTED');
  assert.equal(forge.host_evidence.guest,false);
  assert.equal(forge.host_evidence.durable,false);
  const wasm=inventory.backends.find(x=>x.id==='wasm');
  assert.equal(wasm.host_wire,'LOCAL_NODE22_EXACT_BLOB_PASS');
  assert.equal(wasm.durable_provider,'NOT_IMPLEMENTED');
  assert.equal(wasm.host_evidence.guest,false);
  assert.equal(wasm.host_evidence.durable,false);
  for(const hash of Object.values(wasm.host_evidence.files))
    assert.match(hash,/^[a-f0-9]{40}$/);
  for(const path of Object.values(forge.host_evidence.files))
    assert.match(path,/^[a-f0-9]{40}$/);
});
test('crash, idempotency and real compiler evidence remain release blocking',()=>{
  const gates=inventory.release_gates.join(' ');
  for(const item of ['crash','original reply','borrowed alias','binary SHA','nonzero'])
    assert.ok(gates.includes(item),item);
  for(const id of ['wasm','forge','net'])
    assert.equal(inventory.backends.find(x=>x.id===id).durable_provider,
      'NOT_IMPLEMENTED');
});
