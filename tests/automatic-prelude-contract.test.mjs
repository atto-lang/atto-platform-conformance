import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root = new URL('../', import.meta.url);
const contract = JSON.parse(readFileSync(new URL('contracts/automatic-prelude-v1.json',root),'utf8'));
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

test('positive and negative cases cover core ADTs, spoofing and affine borrows', () => {
  const m=new Map(contract.cases.map(c=>[c.id,c]));
  for (const id of ['some_no_import','none_no_import','ok_no_import','err_no_import','read_only_borrow']) {
    assert.equal(m.get(id)?.outcome,'guest_exit_42',id);
  }
  for (const id of ['none_ambiguous','err_ambiguous','forge_result_type','forge_some_function','borrowed_sum_extraction','sum_use_after_take','alloc_type_without_allocator']) {
    assert.equal(m.get(id)?.outcome,'compile_reject',id);
  }
  assert.match(read(m.get('borrowed_sum_extraction').source),/borrow Option<Envelope>/);
  assert.match(read(m.get('sum_use_after_take').source),/rt take owner/);
  assert.equal(m.get('alloc_type_without_allocator').profile,'core');
});

// These source-only checks intentionally do NOT execute any Atto compiler.
