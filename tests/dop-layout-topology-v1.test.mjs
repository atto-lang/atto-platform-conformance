import test from 'node:test';
import assert from 'node:assert/strict';
import {createDopLayoutPlan, createDopLayoutStore} from '../src/dop-layout-topology-v1.mjs';

const schema = Object.freeze(['p', 'v', 'mass', 'kind'].map(name => Object.freeze({name, type: 'i64'})));
const choices = [
  {kind: 'aos'},
  {kind: 'soa'},
  {kind: 'aosoa', tileWidth: 8},
  {kind: 'aosoa', tileWidth: 16},
  {kind: 'soaos', groups: [['p', 'v'], ['mass', 'kind']]},
  {kind: 'soaos', groups: [['kind'], ['v', 'p', 'mass']]}
];
const mk = (choice, capacity) => createDopLayoutStore({...choice, schema, capacity});
function value(i) { return {p: BigInt(i * 5 - 200), v: BigInt(i % 11 - 5),
  mass: BigInt(i * 3 + 9), kind: BigInt(i % 7)}; }
function rowsMatch(store, oracle) {
  assert.equal(store.length, oracle.length);
  for (let i = 0; i < oracle.length; i++)
    for (const name of ['p', 'v', 'mass', 'kind'])
      assert.equal(store.get(name, i), oracle[i][name], store.plan.kind+'/'+i+'/'+name);
}

test('physical offsets are aligned, collision-free and bounded across all four topology families', () => {
  for (const capacity of [0, 1, 7, 8, 9, 15, 16, 17, 33, 257]) {
    for (const choice of choices) {
      const plan = createDopLayoutPlan({...choice, schema, capacity});
      const seen = new Set();
      for (let i = 0; i < capacity; i++) {
        for (const field of schema) {
          const at = plan.offset(i, field.name);
          assert.equal(at % 8, 0);
          assert.ok(at >= 0 && at + 8 <= plan.byteLength);
          assert.ok(!seen.has(at), plan.kind+' aliased '+i+'/'+field.name);
          seen.add(at);
        }
      }
      assert.equal(seen.size, capacity * schema.length);
      if (choice.kind === 'aosoa') {
        assert.equal(plan.byteLength, Math.ceil(capacity / choice.tileWidth) * choice.tileWidth * schema.length * 8);
      } else assert.equal(plan.byteLength, capacity * schema.length * 8);
    }
  }
});

test('SoAoS is field-group AoS, distinct from tiled AoSoA and from strict one-column-per-field SoA', () => {
  const aos = createDopLayoutPlan({kind: 'aos', schema, capacity: 3});
  const soa = createDopLayoutPlan({kind: 'soa', schema, capacity: 3});
  const aosoa = createDopLayoutPlan({kind: 'aosoa', schema, capacity: 3, tileWidth: 8});
  const soaos = createDopLayoutPlan({kind: 'soaos', schema, capacity: 3,
    groups: [['p','v'], ['mass','kind']]});
  assert.equal(aos.offset(1, 'v') - aos.offset(1, 'p'), 8);
  assert.equal(soa.offset(1, 'v') - soa.offset(1, 'p'), 3 * 8);
  assert.equal(aosoa.offset(1, 'v') - aosoa.offset(1, 'p'), 8 * 8);
  assert.equal(soaos.offset(1, 'v') - soaos.offset(1, 'p'), 8);
  assert.notEqual(soaos.offset(1, 'mass'), aos.offset(1, 'mass'));
  assert.notEqual(soaos.offset(1, 'mass'), soa.offset(1, 'mass'));
});

test('AoS/SoA/AoSoA/SoAoS observed scalar behavior matches an independent row oracle', () => {
  for (const count of [0, 1, 7, 8, 9, 15, 16, 17, 31, 32, 33, 257]) {
    for (const choice of choices) {
      const store = mk(choice, count);
      const oracle = [];
      for (let i = 0; i < count; i++) { const row = value(i); store.push(row); oracle.push(row); }
      for (let sweep = 0; sweep < 3; sweep++) {
        for (let i = 0; i < count; i++) {
          const delta = oracle[i].v * (oracle[i].mass % 5n + 1n);
          store.addI64('p', i, delta);
          oracle[i].p += delta;
        }
      }
      rowsMatch(store, oracle);
      if (count) {
        const copy = store.snapshot(0);
        store.set('p', 0, 12345n);
        assert.notEqual(copy.p, store.get('p', 0));
        oracle[0].p = 12345n;
        rowsMatch(store, oracle);
      }
    }
  }
});

test('swap-delete scrubs removed row slots and keeps every group/column coherent', () => {
  for (const choice of choices) {
    const store = mk(choice, 35);
    const oracle = [];
    for (let i = 0; i < 35; i++) {store.push(value(i)); oracle.push(value(i));}
    for (const index of [3, 0, 31, 15, 2, 0, 5, 7, 12]) {
      const oldLast = oracle.length - 1;
      const erased = index;
      const priorOffsets = schema.map(f => store.plan.offset(oldLast, f.name));
      store.eraseSwap(index);
      oracle[index] = oracle[oldLast]; oracle.pop();
      rowsMatch(store, oracle);
      const bytes = store.bytesSnapshot();
      for (const at of priorOffsets) assert.deepEqual([...bytes.slice(at, at+8)], Array(8).fill(0),
        choice.kind+'/erased '+erased);
    }
  }
});

test('invalid push and i64 overflow fail atomically without byte mutation', () => {
  for (const choice of choices) {
    const store = mk(choice, 2);
    store.push(value(1));
    const original = store.bytesSnapshot();
    assert.throws(() => store.push({...value(2), kind: 1.3}), /signed i64/);
    assert.throws(() => store.push({...value(2), unexpected: 1n}), /unexpected fields/);
    assert.throws(() => store.push({...value(2), mass: 1n << 63n}), /signed i64/);
    assert.equal(store.length, 1);
    assert.deepEqual(store.bytesSnapshot(), original);
    store.set('p', 0, (1n << 63n) - 1n);
    const before = store.bytesSnapshot();
    assert.throws(() => store.addI64('p', 0, 1n), /signed i64/);
    assert.deepEqual(store.bytesSnapshot(), before);
    assert.throws(() => store.get('p', Number.MAX_SAFE_INTEGER), /out of bounds/);
    assert.throws(() => store.get('p', -1), /out of bounds/);
    assert.throws(() => store.get('p', 0.5), /out of bounds/);
    assert.throws(() => store.get('unknown', 0), /unknown field/);
    assert.deepEqual(store.bytesSnapshot(), before);
  }
});

test('SoAoS grouping must be an exact partition, and no topology is selected implicitly', () => {
  for (const groups of [[], [['p','v'], ['mass']], [['p','v'], ['mass','p','kind']],
    [['p','v'], []], [['p','v'], ['mass', 'kind', 'other']]]) {
    assert.throws(() => createDopLayoutPlan({kind: 'soaos', schema, capacity: 1, groups}));
  }
  assert.throws(() => createDopLayoutPlan({kind: 'soaos', schema, capacity: 1}));
  assert.throws(() => createDopLayoutPlan({kind: 'aosoa', schema, capacity: 1}));
  for (const tileWidth of [0, 1, 3, 7, 65, 1.5, -8, Number.MAX_SAFE_INTEGER])
    assert.throws(() => createDopLayoutPlan({kind: 'aosoa', schema, capacity: 1, tileWidth}));
  assert.throws(() => createDopLayoutPlan({kind: 'soa', schema, capacity: 1, groups: [['p']] }));
  assert.throws(() => createDopLayoutPlan({kind: 'aos', schema, capacity: 1, tileWidth: 8}));
  for (const capacity of [-1, 65537, 1.5, NaN, Infinity])
    assert.throws(() => createDopLayoutPlan({kind: 'soa', schema, capacity}));
});

test('schema is copied, validated without invoking getters, and cannot be mutated after admission', () => {
  const field = {name: 'p', type: 'i64'};
  const original = [field];
  const plan = createDopLayoutPlan({kind: 'soa', schema: original, capacity: 2});
  field.name = 'evil'; original.push({name: 'z', type: 'i64'});
  assert.equal(plan.schema[0].name, 'p');
  assert.equal(plan.schema.length, 1);
  assert.ok(Object.isFrozen(plan.schema));
  assert.throws(() => createDopLayoutPlan({kind: 'soa', capacity: 1,
    schema: [{get name() {throw new Error('should not run');}, type: 'i64'}]}),
    /name must be own data/);
  assert.throws(() => createDopLayoutPlan({kind: 'soa', capacity: 1,
    schema: [{name: '__proto__', type: 'i64'}]}), /invalid field name/);
  assert.throws(() => createDopLayoutPlan({kind: 'soa', capacity: 1,
    schema: [{name: 'p', type: 'i64'}, {name: 'p', type: 'i64'}]}), /duplicate/);
  assert.throws(() => createDopLayoutPlan({kind: 'soa', capacity: 1,
    schema: [{name: 'p', type: 'pointer'}]}), /i64 only/);
});

test('deterministic randomized traces have identical results across four topologies', () => {
  let seed = 0x7f4a7c15;
  const rng = () => {seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0;};
  const stores = choices.map(choice => mk(choice, 133));
  const oracle = [];
  for (let step = 0; step < 1500; step++) {
    const action = oracle.length === 0 ? 0 : rng() % 4;
    if (action === 0 && oracle.length < 133) {
      const v = value(rng() % 1000);
      for (const store of stores) store.push(v);
      oracle.push({...v});
    } else if (action === 1 && oracle.length) {
      const index = rng() % oracle.length;
      for (const store of stores) store.eraseSwap(index);
      oracle[index] = oracle[oracle.length - 1]; oracle.pop();
    } else if (oracle.length) {
      const index = rng() % oracle.length;
      const delta = BigInt(rng() % 31) - 15n;
      for (const store of stores) store.addI64('p', index, delta);
      oracle[index].p += delta;
    }
    if (step % 13 === 0) for (const store of stores) rowsMatch(store, oracle);
  }
  for (const store of stores) rowsMatch(store, oracle);
});
