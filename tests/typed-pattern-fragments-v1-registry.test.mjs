// HOST-ONLY registry integrity; no compiler, guest, formatter or runtime execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
const registry=JSON.parse(readFileSync(new URL('../contracts/typed-pattern-fragments-v1.json',import.meta.url),'utf8'));
const backends=['rust-wasm','java','llvm','net','forge','wasm-host','cranelift','js','atto-selfhost','hdl','realtime'];
test('canonical spec pointer, exact source blob and honest unexecuted evidence',()=>{
  assert.equal(registry.schema,'atto.typed-pattern-fragments.v1/1');
  assert.equal(registry.status,'TARGET_SOURCE_ONLY');
  assert.match(registry.spec_pr,/atto-spec\/pull\/59/);
  assert.equal(registry.spec_blob_sha,'cd6b01241e9a77b3cb1c93d36f60aa0dce8b075c');
  assert.equal(registry.evidence.kind,'HOST_ONLY');
  assert.equal(registry.evidence.guest_execution,'NOT_EXECUTED');
  assert.equal(registry.evidence.host_ci,'NOT_EXECUTED_CURRENT_HEAD');
  assert.deepEqual(registry.backends,backends);
  assert.equal(registry.backend_roles['wasm-host'].includes('not independent frontend'),true);
  for(const role of backends) assert.ok(typeof registry.backend_roles[role]==='string' && registry.backend_roles[role].length>10);
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

test('portable guest input fixtures are exact Git blobs, never fake pass receipts',()=>{
  const fixtures=registry.portable_guest_fixtures;
  assert.equal(fixtures.length,17);
  const named=fixtures.map(f=>f.path);
  for(const name of [
    'list-pattern-standalone-rest-11.atto',
    'list-pattern-empty-list-9.atto',
    'list-pattern-empty-rest-13.atto'
  ]) assert.ok(named.includes('fixtures/typed-pattern-fragments/'+name), name);
  const paths=new Set();
  let positives=0,negative=0,traps=0;
  for(const f of fixtures) {
    assert.match(f.path,/^fixtures\/typed-pattern-fragments\/[a-z0-9_-]+\.atto$/);
    assert.ok(!paths.has(f.path),f.path);
    paths.add(f.path);
    const file=new URL('../'+f.path,import.meta.url);
    assert.equal(lstatSync(file).isSymbolicLink(),false);
    const source=readFileSync(file);
    assert.ok(source.length>64&&source.length<8192);
    const blob=createHash('sha1').update('blob '+source.length+'\0')
      .update(source).digest('hex');
    assert.equal(blob,f.blob_sha,f.path);
    assert.ok(source.toString('utf8').includes('return match<int>'));
    if(f.kind==='positive') {
      positives++;
      assert.ok([0,1,3,7,9,11,13,30,32,60].includes(f.expected_exit_code),f.path);
      if(f.paired_with!==undefined)assert.equal(typeof f.paired_with,'string');
    }else if(f.kind==='trap'){
      traps++;
      assert.equal(f.expected_panic_code,1);
      assert.ok(f.assertion.includes('checked i64'));
    }else{
      negative++;
      assert.equal(f.kind,'reject');
      assert.match(f.expected_diagnostic,/^E_PATTERN_[A-Z]+$/);
      assert.equal(f.guest_artifact,false);
    }
  }
  assert.equal(positives,11);
  assert.equal(traps,1);
  assert.equal(negative,5);
  assert.equal(registry.implementation_candidates.rust_wasm.guest_status,'NOT_EXECUTED');
  assert.equal(registry.implementation_candidates.forge_native.guest_status,'NOT_EXECUTED');
  assert.equal(registry.implementation_candidates.forge_native.pr,43);
  for(const f of fixtures.filter(f=>f.paired_with!==undefined))assert.ok(paths.has(f.paired_with));
  for(const c of registry.cases)for(const backend of registry.backends){
    assert.equal(c.execution[backend],'NOT_EXECUTED');
  }
});
