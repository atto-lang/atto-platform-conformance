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

test('adversarial row getters are snapshotted before allocation; metadata cannot be shadowed', () => {
  const s = new LayoutStore(schema, { layout: 'aos', capacity: 1 });
  assert.throws(() => Object.defineProperty(s, 'capacity', { value: 999 }), TypeError);
  assert.throws(() => Object.defineProperty(s, 'layout', { value: 'soa' }), TypeError);
  let reads = 0;
  const tricky = row(1);
  Object.defineProperty(tricky, 'x', {
    enumerable: true, get() { reads++; return reads === 1 ? 1.5 : NaN; }
  });
  const h = s.push(tricky);
  assert.equal(reads, 1);
  assert.equal(s.read(h, 'x'), 1.5);
  let invalidReads = 0;
  const invalid = row(2);
  Object.defineProperty(invalid, 'x', {
    enumerable: true, get() { invalidReads++; return NaN; }
  });
  assert.throws(() => s.push(invalid));
  assert.equal(invalidReads, 1);
  assert.equal(s.length, 1);
  assert.deepEqual(s.get(h), row(1));
  s.dispose();
});

test('untrusted row accessors cannot retire, grow or mutate store mid-append', () => {
  const s = new LayoutStore([{name:'x',type:'f64'}], {capacity:2});
  const observations = [];
  const row = Object.defineProperty({}, 'x', {enumerable:true, get() {
    for (const action of [
      () => s.dispose(),
      () => s.push({x:99}),
      () => s.reserve(100),
      () => s.convert('aos'),
      () => s.borrow('x')
    ]) {
      assert.throws(action, /reentrant/);
      observations.push(true);
    }
    return 7;
  }});
  const handle = s.push(row);
  assert.equal(observations.length, 5);
  assert.equal(s.length, 1);
  assert.deepEqual(s.get(handle), {x:7});
  const throwsRow = Object.defineProperty({}, 'x', {enumerable:true, get() {throw new Error('poisoned getter')}});
  assert.throws(() => s.push(throwsRow), /poisoned getter/);
  assert.equal(s.length, 1);
  assert.deepEqual(s.get(handle), {x:7});
  s.dispose();
});

test('prototype-named numeric fields survive round-trip without prototype mutation', () => {
  for (const layout of ['aos','soa','aosoa','soaos']) {
    const field = [{name:'__proto__',type:'i32'}];
    const opts = layout === 'soaos' ? {groups:[['__proto__']]} : {width:4};
    const s = new LayoutStore(field, {layout, ...opts, capacity:2});
    const input = Object.create(null);
    Object.defineProperty(input, '__proto__', {value:7, enumerable:true});
    const h = s.push(input);
    const observed = s.get(h);
    assert.ok(Object.hasOwn(observed, '__proto__'));
    assert.equal(observed.__proto__, 7);
    assert.equal(Object.getPrototypeOf(observed), Object.prototype);
    s.dispose();
  }
});

test('borrow options validate boolean and reject reentrant proxy getters', () => {
  const s = new LayoutStore([{name:'x',type:'f64'}]);
  const h = s.push({x:2});
  assert.throws(() => s.borrow('x',{mutable:'false'}), /boolean/);
  assert.throws(() => s.borrow('x',{mutable:1}), /boolean/);
  const opts = {get mutable() {
    assert.throws(() => s.dispose(), /reentrant/);
    return true;
  }};
  const loan = s.borrow('x', opts);
  loan.write(h, 5);
  assert.equal(loan.read(h), 5);
  loan.release();
  s.dispose();
});

test('convert options cannot reenter store during layout calculation', () => {
  const s = new LayoutStore([{name:'x',type:'f64'}], {capacity:4});
  const h = s.push({x:3.5});
  const options = {get groups() {
    assert.throws(() => s.dispose(), /reentrant/);
    assert.throws(() => s.write(h,'x',99), /reentrant/);
    return [['x']];
  }};
  s.convert('soaos',options);
  assert.deepEqual(s.get(h),{x:3.5});
  s.dispose();
});

test('deterministic randomized differential test across 4 layouts and 2048 operations', () => {
  let state = 0x59d3e1ab;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return state >>> 0;
  };
  const configs = [
    {layout:'aos'}, {layout:'soa'}, {layout:'aosoa',width:4},
    {layout:'aosoa',width:16},
    {layout:'soaos',groups:[['x','y'],['vx','vy'],['team']]}
  ];
  const stores = configs.map(c => new LayoutStore(schema, {...c, capacity: 2}));
  const active = [];
  const expected = new Map();
  const values = i => ({x:i + 0.5,y:-i - 0.5,vx:(i%1024),vy:-(i%1024),team:i%4});
  const check = () => {
    for (let j = 0; j < active.length; j++) {
      const item = active[j];
      for (let k = 0; k < stores.length; k++)
        assert.deepEqual(stores[k].get(item.handles[k]),expected.get(item.id));
    }
    assert.ok(stores.every(s => s.length === active.length));
  };
  for (let step = 0; step < 2048; step++) {
    const dice = random() % 100;
    if (active.length === 0 || dice < 35) {
      const id = step + 1, value = values(id);
      const handles = stores.map(s => s.push(value));
      expected.set(id,value);
      active.push({id,handles});
    } else if (dice < 65) {
      const j = random() % active.length, item = active[j], field = schema[random()%schema.length].name;
      const v = expected.get(item.id), number = field==='team'?random()%4:random()%1024;
      for (let k = 0; k < stores.length; k++) stores[k].write(item.handles[k],field,number);
      expected.set(item.id,{...v,[field]:number});
    } else if (dice < 84) {
      const j = random() % active.length, item = active[j];
      stores.forEach((s,k) => {
        s.eraseSwap(item.handles[k]);
        assert.throws(() => s.get(item.handles[k]),/stale/);
      });
      expected.delete(item.id);
      active.splice(j,1);
    } else {
      const config = configs[random()%configs.length];
      stores.forEach(s => s.convert(config.layout,config));
    }
    if (step%87 === 0) check();
  }
  check();
  stores.forEach(s=>s.dispose());
});


test('constructor validates the same single-read schema snapshot it stores', () => {
  let names = 0, types = 0;
  const first = {
    get name() { return ++names === 1 ? 'a' : 'b'; },
    get type() { return ++types === 1 ? 'f64' : 'invalid'; }
  };
  const store = new LayoutStore([first, {name:'b', type:'f64'}], {capacity:1});
  assert.equal(names, 1);
  assert.equal(types, 1);
  const handle = store.push({a:3, b:4});
  assert.deepEqual(store.get(handle), {a:3, b:4});
  assert.throws(() => store.push({b:3, extra:4}), /missing row field/);
  assert.equal(store.length, 1);
  store.dispose();
  assert.throws(() => new LayoutStore([
    {get name() {return 'b'}, type:'f64'}, {name:'b', type:'f64'}
  ]), /invalid field schema/);
  const emptySnapshot = [{name:'x', type:'f64'}];
  emptySnapshot[Symbol.iterator] = function* () {};
  assert.throws(() => new LayoutStore(emptySnapshot), /nonempty schema/);
});
