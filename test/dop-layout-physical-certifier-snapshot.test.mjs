import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayoutAbi } from '../verification/data-layout-abi-v1.mjs';
import { certifyPhysicalLayout } from '../verification/dop-layout-physical-certifier-v1.mjs';

function plan() {
  return computeLayoutAbi({
    layout:'soa',capacity:2,
    fields:[{name:'x',type:'i64'},{name:'y',type:'i64'}]
  });
}

test('validated canonical frozen ABI v1 remains admissible',()=>{
  const genuine=plan();
  assert.equal(certifyPhysicalLayout(genuine).checkedCells,4n);
  assert.equal(certifyPhysicalLayout(genuine).liveBytes,32n);
});

test('hostile changing scalar descriptors cannot pass type-width inspection',()=>{
  const genuine=plan();
  let reads=0;
  const field={name:'x',get type(){return reads++===0?'i64':'bool';},
    size:8n,align:8n};
  const forged={...genuine,fields:[field,genuine.fields[1]]};
  assert.throws(()=>certifyPhysicalLayout(forged),/own data property: type/);
  assert.equal(reads,0,'accessor must never execute');
});

test('hostile group base/extent and sparse column membership fail closed',()=>{
  const genuine=plan();
  let reads=0;
  const segment={align:8n,base:0n,get bytes(){reads++;return 16n;}};
  const forged={...genuine,segments:[segment,genuine.segments[1]]};
  assert.throws(()=>certifyPhysicalLayout(forged),/own data property: bytes/);
  assert.equal(reads,0);
  const sparseFields=new Array(2);
  sparseFields[0]=genuine.fields[0];
  assert.throws(()=>certifyPhysicalLayout({...genuine,fields:sparseFields}),
    /own data property: 1/);
});

test('address segment and byte offsets are admitted as one own-data snapshot',()=>{
  const genuine=plan();
  let reads=0;
  const alias={...genuine,address(){
    return {get segment(){reads++;return reads===1?0:1;},byteOffset:0n};
  }};
  assert.throws(()=>certifyPhysicalLayout(alias),/own data property: segment/);
  assert.equal(reads,0,'never execute changing segment getter');

  const retarget={...genuine,get address(){throw Error('hostile getter executed');}};
  assert.throws(()=>certifyPhysicalLayout(retarget),/own data property: address/);
});

test('zero-row plans cannot smuggle excessive fake segments past finite budget',()=>{
  const original=computeLayoutAbi({
    layout:'soa',capacity:0,fields:[{name:'x',type:'i64'}]
  });
  const fabricated=Array.from({length:1000},(_,i)=>({
    align:8n,base:BigInt(i)*8n,bytes:8n
  }));
  assert.throws(()=>certifyPhysicalLayout({
    ...original,segments:fabricated,payloadBytes:8000n,physicalBytes:8000n
  }),/invalid segment count/);
  assert.throws(()=>certifyPhysicalLayout({...original,layout:'evil'}),
    /invalid v1 layout/);
});
