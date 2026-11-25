import test from 'node:test';
import assert from 'node:assert/strict';
import { FourLayoutOracle } from '../verification/dop-four-layout-reference.mjs';

// Deterministic source-free model replay, NOT .atto guest execution.
const shapes = [
  {layout:'aos'}, {layout:'soa'},
  {layout:'aosoa',tileWidth:4}, {layout:'aosoa',tileWidth:16},
  {layout:'soaos',groups:[['x','y'],['vx','vy']]}
];
function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return state >>> 0;
  };
}
function replay(seed) {
  const random = generator(seed);
  const store = new FourLayoutOracle({
    owner:'replay-'+seed,fields:['x','y','vx','vy'],capacity:32,...shapes[seed%shapes.length]
  });
  const live = [];
  let stale = 0;
  for (let step=0; step<320; step++) {
    const choice = random()%10;
    if ((choice<3 && live.length<32) || live.length===0) {
      const values = {x:step+1,y:-(step+1),vx:step*3,vy:step*7};
      live.push({handle:store.push(values),values});
    } else if (choice<6) {
      const row = live[random()%live.length];
      const value = -step*13;
      store.write(row.handle,'vx',value);
      row.values.vx=value;
    } else if (choice<8) {
      const index = random()%live.length;
      const [dead] = live.splice(index,1);
      store.eraseSwap(dead.handle);
      assert.throws(()=>store.read(dead.handle,'x'),/stale|invalid/i);
      stale++;
    } else if (choice===8) {
      const variant = shapes[random()%shapes.length];
      store.convert(variant.layout,variant);
    } else {
      const row = live[random()%live.length];
      const loanX = store.borrow(['x'],'write');
      const loanY = store.borrow(['y'],'read');
      assert.throws(()=>store.eraseSwap(row.handle),/loan/i);
      assert.throws(()=>store.convert('aos'),/loan/i);
      assert.equal(loanY.read(row.handle,'y'),row.values.y);
      const value = step*17;
      loanX.write(row.handle,'x',value);
      row.values.x=value;
      loanX.release();
      loanY.release();
    }
    assert.equal(store.count,live.length);
    for (const item of live) for (const field of ['x','y','vx','vy']) {
      assert.equal(store.read(item.handle,field),item.values[field],
        `seed=${seed} step=${step} field=${field}`);
    }
  }
  store.retire();
  for (const item of live) assert.throws(()=>store.read(item.handle,'x'));
  return stale;
}

test('four physical layouts preserve handle identity through deterministic interleavings',()=>{
  let invalidated=0;
  for (const seed of [1,2,3,4,5,19,41,255,65537,0xfeedbeef]) {
    invalidated+=replay(seed);
  }
  assert.ok(invalidated>200);
});

test('loan collision, revocation and retirement are layout independent',()=>{
  for (const shape of shapes) {
    const store = new FourLayoutOracle({
      owner:'loan-replay',fields:['x','y','vx','vy'],capacity:2,...shape
    });
    const handle=store.push({x:1,y:2,vx:3,vy:4});
    const write=store.borrow(['x'],'write');
    assert.throws(()=>store.borrow(['x'],'read'),/loan/i);
    assert.throws(()=>store.write(handle,'x',7),/loan/i);
    assert.throws(()=>store.retire(),/loan/i);
    write.write(handle,'x',8);
    write.release();
    assert.throws(()=>write.write(handle,'x',9));
    assert.equal(store.read(handle,'x'),8);
    store.retire();
    assert.throws(()=>store.read(handle,'x'));
  }
});
