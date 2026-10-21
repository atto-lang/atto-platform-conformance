import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MAX_COMPRESSED32_OFFSET, MAX_COMPRESSED32_SPAN,
  computeLayoutAbi, encodeCompressed32, decodeCompressed32,
  decodeStoredCompressed32, dereferenceCompressed32
} from '../verification/data-layout-abi-v1.mjs';

const fields = [
  {name:'id',type:'u32'},
  {name:'x',type:'f64'},
  {name:'flag',type:'bool'},
  {name:'next',type:'ref32'}
];

test('heterogeneous AoS/SoA/AoSoA/SoAoS byte geometry is deterministic', () => {
  const aos = computeLayoutAbi({layout:'aos',fields,capacity:3});
  assert.equal(aos.segments[0].stride,24n);
  assert.deepEqual(aos.address(1,'x'),{segment:0,byteOffset:32n});

  const soa = computeLayoutAbi({layout:'soa',fields,capacity:3});
  assert.deepEqual(soa.address(2,'x'),{segment:1,byteOffset:16n});

  const tiled = computeLayoutAbi({layout:'aosoa',fields,capacity:5,tileWidth:4});
  assert.equal(tiled.segments[0].bytes,144n);
  assert.deepEqual(tiled.address(4,'id'),{segment:0,byteOffset:72n});

  const grouped = computeLayoutAbi({
    layout:'soaos',fields,capacity:3,groups:[['id','flag'],['x','next']]
  });
  assert.equal(grouped.segments[0].stride,8n);
  assert.equal(grouped.segments[1].stride,16n);
  assert.deepEqual(grouped.address(2,'next'),{segment:1,byteOffset:40n});

  assert.notDeepEqual(grouped.address(1,'x'),tiled.address(1,'x'));
});

test('AoSoA tail lanes and invalid layout parameters never become live rows', () => {
  const tiled = computeLayoutAbi({layout:'aosoa',fields,capacity:5,tileWidth:4});
  assert.throws(() => tiled.address(5,'x'));
  assert.throws(() => computeLayoutAbi({layout:'aosoa',fields,capacity:1,tileWidth:3}));
  assert.throws(() => computeLayoutAbi({
    layout:'soaos',fields,capacity:1,groups:[['id','x'],['x','flag','next']]
  }));
  assert.throws(() => computeLayoutAbi({layout:'aos',fields:[...fields,{name:'x',type:'u8'}],capacity:1}));
  assert.throws(() => computeLayoutAbi({layout:'aos',fields:[{name:'x',type:'string'}],capacity:1}));
});

test('compressed32 is unsigned, null-reserving, aligned and bounds checked', () => {
  assert.equal(MAX_COMPRESSED32_OFFSET,34359738352n);
  assert.equal(MAX_COMPRESSED32_SPAN,34359738360n);
  assert.equal(encodeCompressed32(0n),1);
  assert.equal(decodeCompressed32(1),0n);
  assert.equal(decodeCompressed32(0),null);
  assert.equal(encodeCompressed32(MAX_COMPRESSED32_OFFSET),0xffff_ffff);
  assert.equal(decodeCompressed32(0xffff_ffff),MAX_COMPRESSED32_OFFSET);
  assert.equal(decodeCompressed32(0x8000_0000),0x7fff_ffffn*8n);
  assert.throws(() => encodeCompressed32(3n));
  assert.throws(() => encodeCompressed32(MAX_COMPRESSED32_OFFSET+8n));
  assert.throws(() => decodeStoredCompressed32(0x1_0000_0000n));
  assert.throws(() => dereferenceCompressed32(0n,MAX_COMPRESSED32_SPAN,8n));
  assert.throws(() => dereferenceCompressed32(0xffff_ffffn,MAX_COMPRESSED32_OFFSET,8n));
  assert.equal(dereferenceCompressed32(1n,8n,8n),0n);
});

test('machine-readable contract matches executable compressed32 constants', async () => {
  const contract = JSON.parse(await readFile(new URL('../contracts/v1/data-layout-abi-v1.json',import.meta.url)));
  assert.equal(contract.contract,'oreslang-data-layout-abi-v1');
  assert.equal(contract.compressed32.maximumEncodedStartingOffsetBytes,String(MAX_COMPRESSED32_OFFSET));
  assert.equal(contract.compressed32.maximumLogicalSpanBytes,String(MAX_COMPRESSED32_SPAN));
  assert.equal(contract.scalarTypes.ref32.bytes,4);
  assert.equal(contract.scalarTypes.ref32.align,4);
});
