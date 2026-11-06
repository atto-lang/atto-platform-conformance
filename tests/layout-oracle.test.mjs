import test from 'node:test';
import assert from 'node:assert/strict';
import {LayoutOracle} from '../src/layout-oracle.mjs';

for (const layout of ['aos','soa','aosoa','soaos']) {
  test(`${layout}: handles, updates, slot reuse and cross-owner rejection`, () => {
    const groups = layout === 'soaos' ? [['x'],['y']] : undefined;
    const s = new LayoutOracle(['x','y'],layout,2,groups);
    const foreign = new LayoutOracle(['x','y'],layout,2,groups);
    const a=s.insert({x:40,y:2}), b=s.insert({x:1,y:3});
    const other=foreign.insert({x:100,y:200});
    assert.deepEqual(s.read(a),{x:40,y:2});
    assert.throws(()=>s.read(other),/foreign/);
    assert.throws(()=>foreign.remove(a),/foreign/);
    assert.throws(()=>s.read({...a}),/forged/);
    s.write(a,'x',41);
    assert.deepEqual(s.read(a),{x:41,y:2});
    s.remove(a);
    assert.throws(()=>s.read(a),/stale/);
    const c=s.insert({x:5,y:6});
    assert.equal(c.slot,a.slot);
    assert.notEqual(c.generation,a.generation);
    assert.deepEqual(s.read(b),{x:1,y:3});
    assert.deepEqual(s.read(c),{x:5,y:6});
  });
}

test('four representations preserve values while AoSoA and SoAoS have distinct nesting',()=>{
  const s=new LayoutOracle(['x','y'],'aos',2);
  const handles=[s.insert({x:1,y:2}),s.insert({x:3,y:4}),s.insert({x:5,y:6})];
  assert.deepEqual(s.snapshot(),[{x:1,y:2},{x:3,y:4},{x:5,y:6}]);
  s.convert('soa');
  assert.deepEqual(s.snapshot(),{x:[1,3,5],y:[2,4,6]});
  s.convert('aosoa');
  assert.deepEqual(s.snapshot(),[{x:[1,3],y:[2,4]},{x:[5],y:[6]}]);
  s.convert('soaos',[['x'],['y']]);
  assert.deepEqual(s.snapshot(),[[{x:1},{x:3},{x:5}],[{y:2},{y:4},{y:6}]]);
  assert.deepEqual(handles.map(h=>s.read(h)),[{x:1,y:2},{x:3,y:4},{x:5,y:6}]);
});

test('SoAoS requires an exact disjoint partition and failed conversion is atomic',()=>{
  const s=new LayoutOracle(['x','y','z'],'soa');
  const h=s.insert({x:1,y:2,z:3});
  const invalid=[undefined,[],[['x']], [['x','y'],['y','z']], [['x'],[]], [['x','y','nope'],['z']]];
  for(const groups of invalid) {
    assert.throws(()=>s.convert('soaos',groups),/SoAoS/);
    assert.equal(s.layout,'soa');
    assert.deepEqual(s.read(h),{x:1,y:2,z:3});
  }
  const mutable=[['x','y'],['z']];
  s.convert('soaos',mutable);
  mutable[0][0]='z';
  assert.deepEqual(s.groups,[['x','y'],['z']]);
  assert.deepEqual(s.snapshot(),[[{x:1,y:2}],[{z:3}]]);
  assert.throws(()=>s.convert('aos',[['x','y','z']]),/groups only/);
  assert.equal(s.layout,'soaos');
});

test('rejected accessors and invalid row shapes do not mutate rows or consume reusable slots',()=>{
  const s=new LayoutOracle(['x'],'soa');
  const old=s.insert({x:1});
  s.remove(old);
  let effects=0;
  const getter=Object.defineProperty({},'x',{enumerable:true,get(){effects++;return 99;}});
  assert.throws(()=>s.insert(getter),/accessors/);
  assert.equal(effects,0);
  assert.throws(()=>s.insert({x:1,extra:2}),/shape/);
  assert.throws(()=>s.insert({x:{nested:1}}),/scalar-only/);
  const h=s.insert({x:2});
  assert.equal(h.slot,old.slot);
  assert.equal(h.generation,old.generation+1);
  assert.deepEqual(s.read(h),{x:2});
  assert.throws(()=>s.write(h,'x',{nested:9}),/scalar-only/);
  assert.deepEqual(s.read(h),{x:2});
});

test('schema, snapshot and primitive signed-zero/bigint values are detached',()=>{
  const fields=['x','y'];
  const s=new LayoutOracle(fields,'soa');
  fields[0]='hijacked';
  const h=s.insert({x:-0,y:5n});
  assert.deepEqual(s.fields,['x','y']);
  const read=s.read(h);
  read.x=900;
  assert.ok(Object.is(s.read(h).x,-0));
  assert.equal(s.read(h).y,5n);
  assert.throws(()=>s.write(h,'missing',1),/unknown/);
});

test('proxy introspection may not re-enter and publish a row during input evaluation',()=>{
  const s=new LayoutOracle(['x'],'soa');
  const input=new Proxy({x:7},{
    ownKeys(target) {
      assert.throws(()=>s.insert({x:999}),/reentrant/);
      assert.throws(()=>s.convert('aos'),/reentrant/);
      assert.throws(()=>s.snapshot(),/reentrant/);
      return Reflect.ownKeys(target);
    }
  });
  const h=s.insert(input);
  assert.deepEqual(s.read(h),{x:7});
  assert.deepEqual(s.snapshot(),{x:[7]});
});
