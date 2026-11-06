import test from 'node:test';
import assert from 'node:assert/strict';
import { FourLayoutOracle } from '../verification/dop-four-layout-reference.mjs';
import { computeLayoutAbi } from '../verification/data-layout-abi-v1.mjs';

// Source-free test of two independently reviewed reference layers.
// This is NOT AttoLang compiler/guest, actual native allocator, or SIMD proof.
test('f64 logical cell addresses refine exact physical layout geometry for four layouts', () => {
  const fields = ['x','y','vx','vy'];
  const typed = fields.map(name => ({name,type:'f64'}));
  const plans = [
    {layout:'aos'}, {layout:'soa'},
    {layout:'aosoa',tileWidth:4}, {layout:'aosoa',tileWidth:8},
    {layout:'soaos',groups:[['x','y'],['vx','vy']]}
  ];
  let checked = 0;
  for (const capacity of [0,1,2,3,4,5,7,8,9,17,129]) {
    for (const plan of plans) {
      const store = new FourLayoutOracle({owner:'geometry-test',fields,capacity,...plan});
      const abi = computeLayoutAbi({fields:typed,capacity,...plan});
      for (let row=0;row<capacity;row++) {
        for (const field of fields) {
          const logical = store.address(row,field);
          const physical = abi.address(row,field);
          assert.equal(physical.segment,logical.segment);
          assert.equal(physical.byteOffset,BigInt(logical.element)*8n,
            `${plan.layout}/${capacity}/${row}/${field}`);
          checked++;
        }
      }
      assert.throws(()=>abi.address(capacity,'x'),RangeError);
      assert.throws(()=>store.address(capacity,'x'),RangeError);
      store.retire();
    }
  }
  assert.equal(checked,55*0 + (0+1+2+3+4+5+7+8+9+17+129)*5*4);
});

test('guest-like row snapshot cannot mutate the store during admission or change ABI widths', () => {
  const store = new FourLayoutOracle({owner:'geometry-test',fields:['x','y'],capacity:2,layout:'soa'});
  const first = store.push({x:7,y:8});
  let reads = 0;
  const descriptor = {name:'x',get type() { reads++; return reads===1?'u32':'f64'; }};
  const row = {y:12};
  Object.defineProperty(row,'x',{enumerable:true,get() {
    assert.throws(()=>store.eraseSwap(first),/reentrant row admission mutation/);
    assert.throws(()=>store.convert('aosoa',{tileWidth:4}),/reentrant row admission mutation/);
    assert.throws(()=>store.push({x:1,y:2}),/reentrant row admission mutation/);
    const geometry = computeLayoutAbi({layout:'soa',fields:[descriptor],capacity:2});
    assert.equal(geometry.fields[0].type,'u32');
    assert.equal(geometry.fields[0].size,4n);
    assert.equal(geometry.physicalBytes,8n);
    return 11;
  }});
  const second = store.push(row);
  assert.equal(reads,1);
  assert.equal(store.count,2);
  assert.equal(store.read(first,'x'),7);
  assert.equal(store.read(second,'x'),11);
  assert.equal(store.read(second,'y'),12);
  store.eraseSwap(first);
  assert.equal(store.read(second,'x'),11);
  assert.throws(()=>store.read(first,'x'),/stale row handle/);
});
