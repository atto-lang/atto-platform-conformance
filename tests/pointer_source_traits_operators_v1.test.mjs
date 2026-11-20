// SOURCE_ONLY registry integrity; not Atto compiler, guest or backend evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const registry = JSON.parse(readFileSync(resolve(root, 'contracts/pointer-source-traits-operators-v1.json'), 'utf8'));
const source = (p) => {
  assert.match(p, /^fixtures\/pointer-(source-operators-v1|ref-local-v1)\/(pass|fail)\/[a-z-]+\.atto$/);
  assert.ok(!p.includes('..'));
  return readFileSync(resolve(root, p), 'utf8');
};
const backends = [
  'atto-source.atto', 'atto-source.cranelift', 'atto-source.forge',
  'atto-source.hdl', 'atto-source.java', 'atto-source.js',
  'atto-source.llvm', 'atto-source.net', 'atto-source.realtime',
  'atto-source.rs', 'atto-source.wasm'
];

test('Pointer<T> is builtin, invariant, distinct from CheckedRef<Class>', () => {
  assert.equal(registry.schema, 'atto.pointer-source-traits-operators.v1');
  assert.equal(registry.status, 'TARGET_ONLY_NOT_EXECUTED');
  assert.equal(registry.normative_source, 'atto-lang/atto-spec#18');
  assert.deepEqual(
    [registry.nominal_type.builtin, registry.nominal_type.invariant, registry.nominal_type.non_forgeable, registry.nominal_type.shadowable],
    [true, true, true, false]
  );
  assert.equal(registry.nominal_type.separate_from, 'CheckedRef<Class>');
  assert.deepEqual(registry.nominal_type.authority_states, ['BorrowedLocal<T>', 'OwnedRegion<T>']);
});

test('Pointer capability never automatically inherits Copy, Clone, Sendable or Serializable', () => {
  assert.deepEqual(registry.implicit_traits, {
    Copy: false, Clone: false, Sendable: false, Serializable: false, Shareable: false
  });
  assert.match(registry.transport, /No raw pointer cross tenant/);
  assert.match(registry.transport, /separate proof/);
});

test('no C-style unary & or *; binary operators stay valid', () => {
  assert.equal(registry.cases.length, 6);
  assert.equal(new Set(registry.cases.map(c => c.id)).size, 6);
  assert.deepEqual(registry.cases.map(c => c.id), ['PTO-001','PTO-002','PTO-003','PTO-004','PTO-005','PTO-006']);
  const [mul, and, address, deref, copy, share] = registry.cases.map(c => source(c.source));
  assert.match(mul, /6 \* 7/);
  assert.match(and, /12 & 10/);
  assert.match(address, /= &value;/);
  assert.match(deref, /= \*ptr;/);
  assert.match(copy, /copy! ptr;/);
  assert.match(share, /share! ptr;/);
  registry.cases.forEach((c,i) => {
    assert.equal(c.status, 'NOT_EXECUTED');
    assert.ok(source(c.source).endsWith('\n'));
    if(i < 2) {
      assert.equal(c.kind,'EXECUTE');
      assert.equal(c.exit,42);
      assert.ok(!('error_category' in c));
    } else {
      assert.equal(c.kind,'REJECT_NO_ARTIFACT');
      assert.match(c.error_category, /^E_POINTER_/);
      assert.ok(!('exit' in c));
    }
  });
});

test('all eleven sources retain independent no-evidence status until compiled guests execute', () => {
  assert.deepEqual(Object.keys(registry.backends).sort(), backends);
  Object.values(registry.backends).forEach(v => {
    assert.equal(v.operator_boundary,'NOT_EXECUTED');
    assert.equal(v.pointer_traits,'NOT_EXECUTED');
    assert.equal(v.compiled_guest,'NOT_EXECUTED');
    assert.equal(v.exact_head_receipt,null);
  });
});
