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
  // Catching the rejection in the proxy must not authorize outer insertion.
  assert.throws(()=>s.insert(input),/tainted/);
  assert.deepEqual(s.snapshot(),{x:[]});
  const h=s.insert({x:7});
  assert.deepEqual(s.read(h),{x:7});
  assert.deepEqual(s.snapshot(),{x:[7]});
});


test('deterministic 900-step AoS/SoA/AoSoA/SoAoS differential trace',()=>{
  const layouts=['aos','soa','aosoa','soaos'];
  const fields=['x','y','flag'];
  const groups=[['x','flag'],['y']];
  const stores=layouts.map(l=>new LayoutOracle(fields,l,3,l==='soaos'?groups:undefined));
  let state=0x5a11c0de;
  const random=()=>{ state=(Math.imul(state,1664525)+1013904223)>>>0; return state; };
  const live=[];
  function normalize(store) {
    const snap=store.snapshot();
    if(store.layout==='aos') return snap;
    if(store.layout==='soa') return snap.x.map((x,i)=>({x,y:snap.y[i],flag:snap.flag[i]}));
    if(store.layout==='aosoa') return snap.flatMap(tile=>tile.x.map((x,i)=>({
      x,y:tile.y[i],flag:tile.flag[i]
    })));
    // Field-grouped arrays of row records, not AoSoA column tiles.
    return snap[0].map((group,i)=>({x:group.x,y:snap[1][i].y,flag:group.flag}));
  }
  const check=()=>{
    const expected=live.slice().sort((a,b)=>a.handles[0].slot-b.handles[0].slot)
      .map(({row})=>({...row}));
    for(let i=0;i<stores.length;i++) {
      assert.deepEqual(normalize(stores[i]),expected);
      for(const value of live) assert.deepEqual(stores[i].read(value.handles[i]),value.row);
    }
  };
  for(let step=0;step<900;step++) {
    const choice=random()%100;
    if(!live.length || choice<43) {
      const row={x:(random()%20000)-10000,y:(random()%9999),flag:(random()%2)===0};
      const handles=stores.map(store=>store.insert(row));
      for(const h of handles) {
        assert.equal(h.slot,handles[0].slot);
        assert.equal(h.generation,handles[0].generation);
      }
      live.push({row,handles});
    } else if(choice<64) {
      const selected=live[random()%live.length],field=fields[random()%fields.length];
      const value=field==='flag' ? random()%2===0 : (random()%8000)-4000;
      for(let i=0;i<stores.length;i++) stores[i].write(selected.handles[i],field,value);
      selected.row[field]=value;
    } else if(choice<80) {
      const at=random()%live.length;
      const [selected]=live.splice(at,1);
      for(let i=0;i<stores.length;i++) {
        stores[i].remove(selected.handles[i]);
        assert.throws(()=>stores[i].read(selected.handles[i]),/stale/);
      }
    } else {
      const next=layouts[random()%layouts.length];
      for(const store of stores)
        store.convert(next,next==='soaos'?groups:undefined);
    }
    if(step%19===0) check();
  }
  check();
});

test('SoAoS proxy groups cannot insert a row while conversion validates metadata',()=>{
  const store=new LayoutOracle(['x','y'],'soa');
  const first=store.insert({x:1,y:2});
  let intercepted=false;
  const groups=new Proxy([['x'],['y']],{
    get(target,key) {
      if(key==='length'&&!intercepted) {
        intercepted=true;
        assert.throws(()=>store.insert({x:99,y:88}),/reentrant/);
      }
      return Reflect.get(target,key);
    }
  });
  assert.throws(()=>store.convert('soaos',groups),/tainted/);
  assert.equal(intercepted,true);
  assert.equal(store.layout,'soa');
  assert.deepEqual(store.snapshot(),{x:[1],y:[2]});
  assert.deepEqual(store.read(first),{x:1,y:2});
  store.convert('soaos',[['x'],['y']]);
  assert.deepEqual(store.snapshot(),[[{x:1}],[{y:2}]]);
});

test('SoAoS validation cannot swallow a nested layout conversion',()=>{
  const store=new LayoutOracle(['x','y'],'aos');
  const h=store.insert({x:10,y:20});
  let seen=false;
  const groups=new Proxy([['x'],['y']],{
    get(target,key) {
      if(key===Symbol.iterator&&!seen) {
        seen=true;
        assert.throws(()=>store.convert('soa'),/reentrant/);
      }
      return Reflect.get(target,key);
    }
  });
  assert.throws(()=>store.convert('soaos',groups),/tainted/);
  assert.equal(seen,true);
  assert.equal(store.layout,'aos');
  assert.deepEqual(store.read(h),{x:10,y:20});
  assert.deepEqual(store.snapshot(),[{x:10,y:20}]);
  store.convert('soa');
  assert.deepEqual(store.snapshot(),{x:[10],y:[20]});
});

test('nested SoAoS group iteration cannot delete a row and silently commit',()=>{
  const store=new LayoutOracle(['x','y'],'soa');
  const h=store.insert({x:7,y:9});
  let intercepted=false;
  const group=new Proxy(['x'],{
    get(target,key) {
      if(key===Symbol.iterator&&!intercepted) {
        intercepted=true;
        assert.throws(()=>store.remove(h),/reentrant/);
      }
      return Reflect.get(target,key);
    }
  });
  assert.throws(()=>store.convert('soaos',[group,['y']]),/tainted/);
  assert.equal(intercepted,true);
  assert.equal(store.layout,'soa');
  assert.deepEqual(store.read(h),{x:7,y:9});
  assert.deepEqual(store.snapshot(),{x:[7],y:[9]});
});
