import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayoutAbi } from '../verification/data-layout-abi-v1.mjs';
import { certifyPhysicalLayout } from '../verification/dop-layout-physical-certifier-v1.mjs';

// Source-free ABI semantic integrity tests. Non-overlap alone is insufficient:
// equally sized fields can exchange physical columns without colliding.
const twoI64 = () => computeLayoutAbi({
  layout:'soa',capacity:3,fields:[{name:'x',type:'i64'},{name:'y',type:'i64'}]
});

test('valid canonical geometry remains admissible across four layouts',()=>{
  for (const layout of ['aos','soa','aosoa','soaos']) {
    const options = {
      layout,capacity:5,fields:[{name:'x',type:'i64'},{name:'y',type:'i64'}]
    };
    if(layout==='aosoa') options.tileWidth=4;
    if(layout==='soaos') options.groups=[['x'],['y']];
    const canonical=computeLayoutAbi(options);
    const cert=certifyPhysicalLayout(canonical);
    assert.equal(cert.checkedCells,10n);
    assert.equal(cert.physicalBytes,canonical.physicalBytes);
  }
});

test('a safe nonoverlapping swap of physical SoA columns is not canonical',()=>{
  const original=twoI64();
  const swapped={...original,address(row,field) {
    return original.address(row,field==='x'?'y':'x');
  }};
  // All three rows still occupy valid, disjoint and correctly aligned bytes.
  // Only the declared field-to-column correspondence is wrong.
  assert.throws(()=>certifyPhysicalLayout(swapped),
    /noncanonical physical field address/);
});

test('forged locator metadata cannot be approved by valid address closure',()=>{
  const original=twoI64();
  const moved={...original,locator:{
    ...original.locator,
    x:{...original.locator.x,segment:1}
  }};
  assert.throws(()=>certifyPhysicalLayout(moved),
    /noncanonical physical locator geometry/);
});

test('forged segment stride cannot pass through alignment and extent checks',()=>{
  const original=twoI64();
  const widened={...original,segments:[
    {...original.segments[0],stride:16n},original.segments[1]
  ]};
  assert.throws(()=>certifyPhysicalLayout(widened),
    /noncanonical physical segment geometry/);
});

test('AoSoA forged tile widths fail even when allocated bytes remain unchanged',()=>{
  const original=computeLayoutAbi({
    layout:'aosoa',capacity:4,tileWidth:4,
    fields:[{name:'x',type:'i64'},{name:'y',type:'i64'}]
  });
  const forged={...original,segments:[
    {...original.segments[0],tileWidth:2}
  ]};
  assert.throws(()=>certifyPhysicalLayout(forged),
    /noncanonical physical segment geometry/);
});

test('SoAoS group order must match actual field-to-byte geometry',()=>{
  const original=computeLayoutAbi({
    layout:'soaos',capacity:5,
    fields:[{name:'x',type:'i64'},{name:'y',type:'i64'}],
    groups:[['x','y']]
  });
  const swappedGroup={...original,segments:[
    {...original.segments[0],fields:['y','x']}
  ]};
  assert.throws(()=>certifyPhysicalLayout(swappedGroup),
    /noncanonical physical locator geometry|noncanonical physical field address/);
});

test('zero-capacity layout metadata still requires canonical geometry',()=>{
  const original=computeLayoutAbi({
    layout:'aos',capacity:0,
    fields:[{name:'a',type:'i64'},{name:'b',type:'i8'}]
  });
  const forged={...original,segments:[{
    ...original.segments[0],stride:1n
  }]};
  assert.throws(()=>certifyPhysicalLayout(forged),
    /noncanonical physical segment geometry/);
  assert.equal(certifyPhysicalLayout(original).checkedCells,0n);
});
