import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayoutAbi } from '../verification/data-layout-abi-v1.mjs';
import { certifyPhysicalLayout } from '../verification/dop-layout-physical-certifier-v1.mjs';

// Exhaustive physical field-cell check only within an explicit finite budget.
const fields = [
  {name:'flag',type:'bool'}, {name:'count',type:'i64'},
  {name:'ratio',type:'f32'}, {name:'tag',type:'u16'}
];
const shapes = [
  {layout:'aos'}, {layout:'soa'},
  {layout:'aosoa',tileWidth:4}, {layout:'aosoa',tileWidth:16},
  {layout:'soaos',groups:[['flag','count'],['ratio','tag']]}
];
test('mixed-width physical segments do not overlap, misalign or undercharge',()=>{
  let verified=0;
  for(const capacity of [0,1,2,3,4,5,16,17,63]) for(const shape of shapes) {
    const plan=computeLayoutAbi({...shape,fields,capacity});
    const result=certifyPhysicalLayout(plan);
    assert.equal(result.checkedCells,BigInt(capacity*fields.length));
    assert.equal(result.liveBytes,BigInt(capacity*15));
    assert.equal(result.physicalBytes,plan.physicalBytes);
    assert.ok(result.paddingAndUnusedBytes>=0n);
    verified+=capacity*fields.length;
  }
  assert.equal(verified,2220);
});

test('forged address mapping cannot alias the same physical cell',()=>{
  const plan=computeLayoutAbi({layout:'soa',capacity:3,
    fields:[{name:'x',type:'u32'},{name:'y',type:'u32'}]});
  const forged={...plan,address(){return {segment:0,byteOffset:0n};}};
  assert.throws(()=>certifyPhysicalLayout(forged),/aliased physical cells/);
});

test('forged address crossing segment extent is rejected',()=>{
  const plan=computeLayoutAbi({layout:'soa',capacity:1,fields:[{name:'x',type:'i64'}]});
  const forged={...plan,address(){return {segment:0,byteOffset:8n};}};
  assert.throws(()=>certifyPhysicalLayout(forged),/outside allocation/);
});

test('forged field type physical width and charged extents are rejected',()=>{
  const plan=computeLayoutAbi({layout:'aos',capacity:2,fields});
  const wrongWidth={...plan,fields:[{...plan.fields[0],size:8n},...plan.fields.slice(1)]};
  assert.throws(()=>certifyPhysicalLayout(wrongWidth),/scalar physical width/);
  const wrongCharge={...plan,physicalBytes:plan.physicalBytes-1n};
  assert.throws(()=>certifyPhysicalLayout(wrongCharge),/charged physical allocation/);
  const wrongBase={...plan,segments:[{...plan.segments[0],base:1n}]};
  assert.throws(()=>certifyPhysicalLayout(wrongBase),/segment base/);
});

test('finite checker refuses oversize programs rather than sampling rows',()=>{
  const plan=computeLayoutAbi({layout:'soa',capacity:30,fields});
  assert.throws(()=>certifyPhysicalLayout(plan,100),/budget exceeded/);
  assert.throws(()=>certifyPhysicalLayout(plan,-1),/budget or field count/);
  assert.equal(certifyPhysicalLayout(plan,120).checkedCells,120n);
});
