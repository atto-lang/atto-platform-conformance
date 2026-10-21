// Host-reference checks only. This is not a source-compiler or generated-guest test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LayoutStore } from '../src/layout-storage-oracle.mjs';

const schema = [
  { name: 'x', type: 'f64' }, { name: 'y', type: 'f64' },
  { name: 'vx', type: 'f32' }, { name: 'vy', type: 'f32' },
  { name: 'team', type: 'u32' }
];
const layouts = [
  { layout: 'aos' }, { layout: 'soa' }, { layout: 'aosoa', width: 8 },
  { layout: 'soaos', groups: [['x','y'], ['vx','vy'], ['team']] }
];
const row = i => ({ x: i + 0.5, y: 2 * i + 0.5, vx: i, vy: -i, team: i % 4 });

for (const settings of layouts) {
  test(settings.layout + ': physical bytes, identity, swap-delete, growth and leases', () => {
    const store = new LayoutStore(schema, { ...settings, capacity: 2 });
    const handles = Array.from({ length: 17 }, (_, i) => store.push(row(i)));
    assert.equal(store.length, 17);
    assert.ok(store.byteLength > 0);
    handles.forEach((h,i) => assert.deepEqual(store.get(h), row(i)));
    const v = store.borrow('vx', { mutable: true });
    const y = store.borrow('y');
    assert.throws(() => store.borrow('vx'));
    assert.throws(() => store.write(handles[0], 'vx', 5));
    assert.throws(() => store.reserve(100));
    assert.throws(() => store.convert('aos'));
    assert.throws(() => store.eraseSwap(handles[3]));
    assert.throws(() => y.write(handles[0], 7));
    v.write(handles[0], 42);
    assert.equal(v.read(handles[0]), 42);
    assert.equal(y.read(handles[0]), 0.5);
    y.release(); v.release();
    assert.throws(() => v.read(handles[0]));
    assert.throws(() => v.release());
    store.eraseSwap(handles[3]);
    assert.throws(() => store.get(handles[3]), /stale/);
    assert.deepEqual(store.get(handles[16]), row(16));
    assert.equal(store.length, 16);
    const replacement = store.push(row(99));
    assert.throws(() => store.get(handles[3]), /stale/);
    assert.deepEqual(store.get(replacement), row(99));
    assert.equal(store.read(handles[0], 'vx'), 42);
    store.dispose();
    assert.throws(() => store.read(handles[0], 'x'), /retired/);
  });
}

test('all four layouts convert preserving stable handles and exact fields', () => {
  const s = new LayoutStore(schema, { ...layouts[0], capacity: 20 });
  const handles = Array.from({ length: 17 }, (_, i) => s.push(row(i)));
  for (const target of [...layouts.slice(1), layouts[0]]) {
    s.convert(target.layout, target);
    handles.forEach((h, i) => assert.deepEqual(s.get(h), row(i)));
  }
  s.dispose();
});

test('SoAoS groups are arrays of compact records; AoSoA is tiled columns', () => {
  const aos = new LayoutStore(schema, { layout: 'aos', capacity: 8 });
  const soa = new LayoutStore(schema, { layout: 'soa', capacity: 8 });
  const tiled = new LayoutStore(schema, { layout: 'aosoa', width: 4, capacity: 8 });
  const grouped = new LayoutStore(schema, { layout: 'soaos', groups: [['x','y'],['vx','vy'],['team']], capacity: 8 });
  const stores = [aos, soa, tiled, grouped];
  const handles = stores.map(s => [s.push(row(0)), s.push(row(1))]);
  assert.equal(grouped.physicalOffset(handles[3][0], 'y') - grouped.physicalOffset(handles[3][0], 'x'), 8);
  assert.equal(grouped.physicalOffset(handles[3][1], 'x') - grouped.physicalOffset(handles[3][0], 'x'), 16);
  assert.equal(soa.physicalOffset(handles[1][1], 'x') - soa.physicalOffset(handles[1][0], 'x'), 8);
  assert.equal(tiled.physicalOffset(handles[2][0], 'y') - tiled.physicalOffset(handles[2][0], 'x'), 32);
  assert.equal(aos.physicalOffset(handles[0][1], 'x') - aos.physicalOffset(handles[0][0], 'x'), 32);
  stores.forEach(s => s.dispose());
});

test('negative validation is transactional and refuses forged/cross-domain handles', () => {
  const a = new LayoutStore(schema, { layout: 'soa', capacity: 1 });
  const b = new LayoutStore(schema, { layout: 'soa', capacity: 1 });
  const valid = a.push(row(1));
  assert.throws(() => a.push({ ...row(2), team: -1 }));
  assert.throws(() => a.push({ ...row(2), extra: 8 }));
  assert.equal(a.length, 1);
  assert.deepEqual(a.get(valid), row(1));
  assert.throws(() => b.read(valid, 'x'), /forged/);
  assert.throws(() => a.read({ ...valid }, 'x'), /forged/);
  assert.throws(() => a.write(valid, 'x', NaN));
  assert.throws(() => a.write(valid, 'team', 2 ** 32));
  assert.deepEqual(a.get(valid), row(1));
  a.dispose(); b.dispose();
  assert.throws(() => new LayoutStore(schema, { layout: 'soaos', groups: [['x']] }));
  assert.throws(() => new LayoutStore(schema, { layout: 'aosoa', width: 3 }));
  assert.throws(() => new LayoutStore(schema, { layout: 'soa', capacity: 100, maxBytes: 32 }));
});

test('loan to one field permits a disjoint mutable field loan only', () => {
  const s = new LayoutStore(schema);
  const h = s.push(row(3));
  const x = s.borrow('x');
  const y = s.borrow('y', { mutable: true });
  y.write(h, 123.5);
  assert.equal(x.read(h), 3.5);
  assert.equal(y.read(h), 123.5);
  assert.throws(() => s.dispose(), /loans/);
  x.release(); y.release();
  s.dispose();
});


test('tail tiles, repeated compaction and numeric overflow do not corrupt other rows', () => {
  const s = new LayoutStore(schema, { layout: 'aosoa', width: 8, capacity: 1 });
  const handles = Array.from({ length: 1031 }, (_, i) => s.push(row(i)));
  assert.throws(() => s.write(handles[1023], 'vx', 1e100), /f32 overflow/);
  assert.equal(s.read(handles[1023], 'vx'), 1023);
  for (let i = 0; i < 200; i++) {
    s.eraseSwap(handles[i]);
    assert.throws(() => s.read(handles[i], 'x'), /stale/);
  }
  for (const target of layouts) s.convert(target.layout, target);
  for (let i = 200; i < handles.length; i++) {
    assert.deepEqual(s.get(handles[i]), row(i));
  }
  assert.equal(s.length, 831);
  s.dispose();
});

test('growth charges simultaneous old/new buffers against a strict peak quota', () => {
  const s = new LayoutStore([{ name: 'x', type: 'f64' }], {
    layout: 'soa', capacity: 1, maxBytes: 20
  });
  const h = s.push({ x: 4 });
  assert.throws(() => s.push({ x: 5 }), /quota/); // 8 old + 16 new > 20
  assert.deepEqual(s.get(h), { x: 4 });
  assert.equal(s.length, 1);
  s.dispose();
});

test('physical layout metadata is not externally writable or affected by mutated group input', () => {
  const groups = [['x','y'], ['vx','vy'], ['team']];
  const s = new LayoutStore(schema, { layout: 'soaos', groups });
  const h = s.push(row(1));
  assert.throws(() => { s.layout = 'aos'; }, TypeError);
  assert.throws(() => { s.capacity = Number.MAX_SAFE_INTEGER; }, TypeError);
  groups[0][0] = 'team'; // mutation of caller-owned array must not alter the store.
  s.convert('soaos');
  assert.deepEqual(s.get(h), row(1));
  s.dispose();
});
