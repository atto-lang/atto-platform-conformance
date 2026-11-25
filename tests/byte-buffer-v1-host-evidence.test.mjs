import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = p => JSON.parse(readFileSync(new URL('../'+p, import.meta.url),'utf8'));
const hosts = read('evidence/byte-buffer-v1-host-foundations.json');
const guests = read('contracts/byte-buffer-v1.json');
const names = ['java','llvm','wasm','rs','net','forge','cranelift','js','atto','hdl'];

test('host-only receipts must never turn into compiled Atto guest PASS',()=>{
  assert.equal(hosts.schema,'atto.byte-buffer.host-foundations.v1');
  assert.equal(hosts.status,'HOST_ONLY_EVIDENCE_NOT_GUEST_CONFORMANCE');
  assert.equal(hosts.guest_cases_total,22);
  assert.equal(guests.cases.length,22);
  assert.equal(guests.status,'TARGET_NOT_EXECUTED');
  assert.deepEqual(hosts.host_tests.map(x=>x.backend).sort(),names.slice().sort());
  assert.deepEqual(guests.backends.map(x=>x.backend),names);
  for(const g of guests.backends) {
    assert.equal(g.execution,'NOT_EXECUTED');
    assert.equal(g.receipt,null);
  }
  assert.equal(hosts.guest_status,'NOT_EXECUTED');
  assert.equal(hosts.native_aot_status,'NOT_EXECUTED');
  assert.equal(hosts.aggregate_tenant_isolation_certified,false);
  assert.equal(hosts.release_authorized,false);
});

test('host evidence is exact-source scoped and does not imply any .atto lowering',()=>{
  for(const h of hosts.host_tests){
    assert.ok(['HOST_PASS','NOT_EXECUTED'].includes(h.status));
    assert.match(h.scope,/host|Host|runtime|frontend|compiler|profile|ActorArena|module/i);
    if(h.status==='HOST_PASS') {
      assert.match(h.source_repo,/^atto-lang\/atto-source\./);
      assert.match(h.source_blob_sha,/^[0-9a-f]{40}$/);
      assert.match(h.test_blob_sha,/^[0-9a-f]{40}$/);
      assert.ok(h.executions>=1);
      assert.ok(h.toolchains.length>=1);
      assert.ok(!/guest.*PASS/i.test(h.scope));
    } else {
      assert.equal(h.executions,undefined);
    }
  }
  assert.equal(hosts.host_tests.filter(h=>h.status==='HOST_PASS').length,4);
  assert.equal(hosts.host_tests.filter(h=>h.status==='NOT_EXECUTED').length,6);
  const cpp=hosts.host_tests.filter(h=>['llvm','forge'].includes(h.backend));
  assert.equal(cpp[0].source_blob_sha,cpp[1].source_blob_sha);
  assert.equal(cpp[0].test_blob_sha,cpp[1].test_blob_sha);
  assert.equal(cpp[0].assertions_per_mode,200133);
  assert.deepEqual(cpp[0].sanitizers,['ASan','UBSan']);
});
