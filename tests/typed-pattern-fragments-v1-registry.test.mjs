// HOST-ONLY registry integrity; no compiler, guest, formatter or runtime execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const registry=JSON.parse(readFileSync(new URL('../contracts/typed-pattern-fragments-v1.json',import.meta.url),'utf8'));
const backends=['rust-wasm','java','llvm','net','forge'];
test('canonical spec pointer, exact source blob and honest unexecuted evidence',()=>{
  assert.equal(registry.schema,'atto.typed-pattern-fragments.v1/1');
  assert.equal(registry.status,'TARGET_SOURCE_ONLY');
  assert.match(registry.spec_pr,/atto-spec\/pull\/59/);
  assert.equal(registry.spec_blob_sha,'cd6b01241e9a77b3cb1c93d36f60aa0dce8b075c');
  assert.equal(registry.evidence.kind,'HOST_ONLY');
  assert.equal(registry.evidence.guest_execution,'NOT_EXECUTED');
  assert.equal(registry.evidence.host_ci,'NOT_EXECUTED_CURRENT_HEAD');
  assert.deepEqual(registry.backends,backends);
});
test('unique typed pattern cases and per-backend evidence fail closed',()=>{
  const ids=new Set(), names=new Set();let positive=0,negative=0;
  assert.ok(registry.cases.length>=35);
  for(const c of registry.cases) {
    assert.match(c.id,/^PFV1-[0-9]{3}$/);
    assert.ok(!ids.has(c.id),c.id); ids.add(c.id);
    assert.ok(!names.has(c.name),c.name); names.add(c.name);
    assert.deepEqual(c.execution,Object.fromEntries(backends.map(x=>[x,'NOT_EXECUTED'])));
    if(c.kind==='match') {
      positive++;
      assert.ok(c.subject.type.startsWith('List<'),c.name);
      assert.ok(Array.isArray(c.subject.items));
      assert.equal(typeof c.pattern,'string');
      assert.equal(typeof c.expected.matched,'boolean');
      assert.ok(c.expected.bindings&&typeof c.expected.bindings==='object');
    } else {
      negative++;
      assert.equal(c.kind,'reject');
      assert.equal(typeof c.source,'string');
      assert.match(c.expected.diagnostic_category,/^(?:E_PATTERN_[A-Z]+|E_UNSUPPORTED)$/);
      assert.equal(c.expected.guest_artifact,false);
    }
  }
  assert.ok(positive>=15 && negative>=20);
});
test('coverage includes runtime/constexpr split, type boundaries, captures, guard-once and injection',()=>{
  const names=new Set(registry.cases.map(x=>x.name));
  for(const required of ['inferred-typed-rest-three-binders','explicit-typed-rest-three-binders',
    'heterogeneous-type-test','counted-typed-fragment','borrowed-rest-capture-span',
    'guard-not-retried','runtime-fragment-source','runtime-env-backed-module-const',
    'bind-inside-string','dynamic-callback-in-string','suspend-in-string','nested-repeat',
    'adjacent-rest-after-expansion','spoofed-module-identity','cross-tenant-borrow',
    'tuple-rest-fragment','borrowed-rest-escape']) assert.ok(names.has(required),required);
  const success=registry.cases.find(x=>x.name==='inferred-typed-rest-three-binders');
  assert.equal(success.expected.result,6);
  assert.deepEqual(success.expected.bindings,{a:1,b:2,c:3});
  const guarded=registry.cases.find(x=>x.name==='guard-not-retried');
  assert.equal(guarded.expected.guard_evaluations,1);
  assert.equal(guarded.expected.fallback_result,0);
});
