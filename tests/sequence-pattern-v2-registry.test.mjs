// Registry integrity only. NOT a compiler/guest test and NOT semantic reference matcher.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const registry=JSON.parse(readFileSync(new URL('../contracts/sequence-pattern-v2-registry.json',import.meta.url),'utf8'));
const backends=['rust-wasm','java','llvm','net','forge'];

test('version, provenance, and source-only evidence cannot impersonate guest execution',()=>{
  assert.equal(registry.schema,'atto.sequence-patterns.v2/1');
  assert.equal(registry.status,'TARGET_SOURCE_ONLY');
  assert.equal(registry.evidence.kind,'HOST_REFERENCE_ONLY');
  assert.equal(registry.evidence.guest_execution,'NOT_EXECUTED');
  assert.deepEqual(registry.backends,backends);
  assert.match(registry.spec_pr,/atto-spec\/pull\/59/);
  for(const sha of Object.values(registry.source_blobs)) assert.match(sha,/^[0-9a-f]{40}$/);
});

test('every distinct case records bounded semantic target and explicitly unexecuted backends',()=>{
  assert.ok(registry.cases.length>=30);
  const ids=new Set(),names=new Set();let accept=0,reject=0;
  for(const c of registry.cases){
    assert.match(c.id,/^SPV2-[0-9]{3}$/);
    assert.equal(ids.has(c.id),false);ids.add(c.id);
    assert.equal(names.has(c.name),false);names.add(c.name);
    assert.equal(typeof c.pattern,'string');assert.ok(c.pattern.length>1);
    assert.deepEqual(c.execution,Object.fromEntries(backends.map(x=>[x,'NOT_EXECUTED'])));
    if(c.kind==='match'){
      accept++;assert.ok(['List','Array','Tuple'].includes(c.subject.kind));
      assert.ok(Array.isArray(c.subject.items));
      assert.equal(typeof c.expected.matched,'boolean');
      assert.equal(typeof c.expected.bindings,'object');
    }else{
      assert.equal(c.kind,'reject');reject++;
      assert.deepEqual(c.expected,{parse:'REJECT'});
    }
  }
  assert.ok(accept>=20 && reject>=15);
});

test('contract coverage includes exact values, type guards, anchored rests, counted groups and invalid legacy spellings',()=>{
  const a=registry.cases.filter(c=>c.kind==='match').map(c=>c.pattern);
  const n=registry.cases.filter(c=>c.kind==='reject').map(c=>c.pattern);
  for(const needed of ['List.of(..., 3)','List.of(1, ...)','...(3 of int, 3 of bool)','...(3 of 7)','is int as val x','Tuple.of(1, 2, 3)'])
    assert.ok(a.some(x=>x.includes(needed)),needed);
  for(const needed of ['..._','_...','...(int)...','...(2..4 of int)','Tuple.of(..., 1)'])
    assert.ok(n.some(x=>x.includes(needed)),needed);
});
