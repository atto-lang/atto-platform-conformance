import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root = new URL('../', import.meta.url);
const contract = JSON.parse(readFileSync(new URL('contracts/automatic-prelude-v1.json',root),'utf8'));
const registry = JSON.parse(readFileSync(new URL('contracts/core-type-registry-v1.json',root),'utf8'));
const read = file => readFileSync(new URL(file,root),'utf8');

test('prelude registry is explicit about unexecuted compiler evidence', () => {
  assert.equal(contract.schema,'atto.automatic-prelude.v1');
  assert.equal(contract.status,'SOURCE_CANDIDATES_NOT_GUEST_VERIFIED');
  assert.deepEqual(contract.backends,['java','llvm','wasm','net','forge','rs','cranelift','js','hdl']);
  assert.ok(contract.cases.length >= 12 && contract.cases.length <= 40);
  const ids=new Set();
  for (const c of contract.cases) {
    assert.match(c.id,/^[a-z][a-z0-9_]{1,72}$/);
    assert.equal(ids.has(c.id),false,'duplicate fixture id');
    ids.add(c.id);
    assert.equal(c.source,`fixtures/automatic-prelude-v1/${c.id}.atto`);
    assert.ok(['core','alloc','hosted'].includes(c.profile));
    assert.ok(['guest_exit_42','compile_reject'].includes(c.outcome));
    assert.equal(c.evidence,'NOT_EXECUTED','never invent a guest receipt');
    const text=read(c.source);
    assert.ok(text.length>70 && text.length<8192,'fixture source size bound');
    assert.ok(text.includes('fnc main('),'source must contain an entrypoint');
    assert.ok(!text.includes('import '),'this registry tests implicit prelude');
  }
});


test('canonical registry pins variant arity, payload ownership and drop rules', () => {
  assert.equal(registry.schema,'atto.core-type-registry.v1');
  assert.equal(registry.status,'SOURCE_CONTRACT_NOT_GUEST_VERIFIED');
  assert.deepEqual(registry.backends.map(x=>x.name),contract.backends);
  assert.ok(registry.requirements.length >= 8);
  for (const [name,arity] of [['Option',1],['Result',2]]) {
    const item=registry.sum_contracts[name];
    assert.ok(item, name);
    assert.equal(item.generic_arity,arity);
    assert.equal(item.ownership,'PAYLOAD_DEPENDENT');
    assert.equal(item.drop_policy,'ACTIVE_PAYLOAD_ONCE');
  }
  const some=registry.sum_contracts.Option.variants.Some;
  assert.equal(some.arity,1);
  assert.equal(some.transfers_payload,true);
  assert.equal(registry.sum_contracts.Option.variants.None.arity,0);
  assert.equal(registry.sum_contracts.Option.variants.None.drop_policy,'NONE');
  assert.equal(registry.sum_contracts.Option.variants.Some.drop_policy,'ACTIVE_PAYLOAD_ONCE');
  assert.equal(registry.sum_contracts.Result.variants.Ok.drop_policy,'ACTIVE_PAYLOAD_ONCE');
  assert.equal(registry.sum_contracts.Result.variants.Err.drop_policy,'ACTIVE_PAYLOAD_ONCE');
  assert.equal(registry.sum_contracts.Result.variants.Err.transfers_payload,true);
  assert.ok(registry.drop_policies.includes('ALL_INITIALIZED_MEMBERS'));
  assert.ok(registry.samples.some(x=>x.name==='Array' && x.drop_policy==='ALL_INITIALIZED_MEMBERS'));
  assert.ok(registry.samples.some(x=>x.name==='Pair' && x.drop_policy==='ALL_INITIALIZED_MEMBERS'));
  for (const item of registry.samples) {
    assert.ok(item.name && item.canonical_identity);
    assert.ok(['core','alloc','explicit'].includes(item.scope));
    assert.ok(registry.ownership.includes(item.ownership));
  }
  const alloc=registry.samples.filter(x=>x.scope==='alloc');
  assert.ok(alloc.length >= 4 && alloc.every(x=>x.allocation==='ALLOCATOR_REQUIRED'));
  assert.ok(registry.samples.some(x=>x.name==='Slice' && x.ownership==='BORROWED_VIEW'));
});

test('positive and negative cases cover core ADTs, spoofing and affine borrows', () => {
  const m=new Map(contract.cases.map(c=>[c.id,c]));
  for (const id of ['some_no_import','none_no_import','ok_no_import','err_no_import','read_only_borrow','borrowed_affine_tag_query']) {
    assert.equal(m.get(id)?.outcome,'guest_exit_42',id);
  }
  for (const id of ['none_ambiguous','err_ambiguous','forge_result_type','forge_some_function','borrowed_sum_extraction','sum_use_after_take','alloc_type_without_allocator','option_wrong_arity','result_wrong_arity']) {
    assert.equal(m.get(id)?.outcome,'compile_reject',id);
  }
  assert.match(read(m.get('borrowed_sum_extraction').source),/borrow Option<Envelope>/);
  assert.match(read(m.get('sum_use_after_take').source),/rt take owner/);
  assert.equal(m.get('alloc_type_without_allocator').profile,'core');
  assert.equal(m.get('option_wrong_arity').profile,'core');
  assert.equal(m.get('result_wrong_arity').profile,'core');
});

// These source-only checks intentionally do NOT execute any Atto compiler.
