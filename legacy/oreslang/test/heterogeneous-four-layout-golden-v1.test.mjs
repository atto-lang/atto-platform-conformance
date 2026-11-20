import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {computeLayoutAbi} from '../verification/data-layout-abi-v1.mjs';

const location = new URL('../contracts/v1/heterogeneous-four-layout-golden-v1.json',import.meta.url);
const readVectors=async()=>JSON.parse(await readFile(location,'utf8'));

test('immutable reference fixture proves mixed-width offsets across all four physical layouts',async()=>{
  const fixture=await readVectors();
  assert.equal(fixture.schemaVersion,1);
  assert.equal(fixture.status,'SOURCE_FREE_REFERENCE_ONLY');
  assert.equal(fixture.endian,'little');
  assert.deepEqual(fixture.fields.map(f=>f.type),['u32','f64','bool','ref32']);
  assert.deepEqual(fixture.plans.map(p=>p.layout),['aos','soa','aosoa','soaos']);
  let fieldCells=0;
  for(const plan of fixture.plans){
    const geometry=computeLayoutAbi({
      layout:plan.layout,fields:fixture.fields,capacity:plan.capacity,
      ...(plan.tileWidth===undefined?{}:{tileWidth:plan.tileWidth}),
      ...(plan.groups===undefined?{}:{groups:plan.groups}),
      maxTotalBytes:BigInt(plan.expectedPhysicalBytes)
    });
    assert.equal(geometry.payloadBytes.toString(),plan.expectedPayloadBytes);
    assert.equal(geometry.physicalBytes.toString(),plan.expectedPhysicalBytes);
    assert.equal(geometry.segments.length,plan.segments.length);
    plan.segments.forEach((segment,i)=>{
      const a=geometry.segments[i];
      assert.equal(a.align.toString(),segment.alignment);
      assert.equal(a.base.toString(),segment.base);
      assert.equal(a.bytes.toString(),segment.byteLength);
      assert.equal(a.stride.toString(),segment.stride);
    });
    const occupied=new Set();
    for(const item of plan.cells){
      const cell=geometry.address(item.row,item.field);
      assert.equal(cell.segment,item.segment);
      assert.equal(cell.byteOffset.toString(),item.relativeByteOffset);
      const absolute=geometry.segments[cell.segment].base+cell.byteOffset;
      assert.equal(absolute.toString(),item.absoluteByteOffset);
      const type=fixture.fields.find(f=>f.name===item.field);
      const widths={u32:4,f64:8,bool:1,ref32:4};
      const bytes=widths[type.type],align=BigInt(bytes);
      assert.equal(absolute%align,0n);
      for(let byte=0n;byte<BigInt(bytes);byte++){
        const key=(absolute+byte).toString();
        assert.equal(occupied.has(key),false,`cell alias in ${plan.layout}`);
        occupied.add(key);
      }
      fieldCells++;
    }
    assert.equal(plan.cells.length,plan.capacity*fixture.fields.length);
    assert.throws(()=>geometry.address(plan.capacity,'id'),RangeError);
    assert.throws(()=>computeLayoutAbi({
      layout:plan.layout,fields:fixture.fields,capacity:plan.capacity,
      ...(plan.tileWidth===undefined?{}:{tileWidth:plan.tileWidth}),
      ...(plan.groups===undefined?{}:{groups:plan.groups}),
      maxTotalBytes:BigInt(plan.expectedPhysicalBytes)-1n
    }),RangeError);
  }
  assert.equal(fieldCells,56);
});

test('SoA absolute segment-base padding is charged independently from payload',async()=>{
  const {fields,plans}=await readVectors();
  const soa=plans.find(p=>p.layout==='soa');
  assert.equal(soa.expectedPayloadBytes,'51');
  assert.equal(soa.expectedPhysicalBytes,'56');
  const g=computeLayoutAbi({layout:'soa',fields,capacity:3,maxTotalBytes:56n});
  assert.deepEqual(g.segments.map(s=>s.base),[0n,16n,40n,44n]);
  assert.equal(g.address(2,'x').byteOffset+g.segments[1].base,32n);
  assert.throws(()=>computeLayoutAbi({
    layout:'soa',fields,capacity:3,maxTotalBytes:51n
  }),RangeError);
});

test('each layout must preserve its own golden physical geometry',async()=>{
  const fixture=await readVectors();
  const p=fixture.plans.find(p=>p.layout==='soaos');
  assert.deepEqual(p.groups,[['id','flag'],['x','next']]);
  const mutated=computeLayoutAbi({layout:'soaos',fields:fixture.fields,
    capacity:p.capacity,groups:[['id','x'],['flag','next']]});
  assert.notEqual(mutated.address(2,'next').byteOffset.toString(),
    p.cells.find(x=>x.row===2&&x.field==='next').relativeByteOffset);
});
