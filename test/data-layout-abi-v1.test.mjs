import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  TYPES, MAX_COMPRESSED32_OFFSET, MAX_COMPRESSED32_SPAN,
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

test('ABI field names include normal identifiers and use prototype-safe lookup', () => {
  const ordinary = [
    {name:'position_x',type:'f64'},
    {name:'velocity2',type:'f32'},
    {name:'__proto__',type:'u32'},
    {name:'constructor',type:'i8'},
    {name:'$local',type:'bool'}
  ];
  for (const layout of ['aos','soa','aosoa','soaos']) {
    const options = layout === 'aosoa' ? {tileWidth:4} :
      layout === 'soaos' ? {groups:[['position_x','velocity2'],['__proto__','constructor','$local']]} : {};
    const geometry = computeLayoutAbi({layout,fields:ordinary,capacity:5,...options});
    for (const field of ordinary) {
      assert.equal(typeof geometry.address(4,field.name).byteOffset,'bigint');
    }
    assert.throws(() => geometry.address(4,'toString'),RangeError);
    assert.throws(() => geometry.address(4,'hasOwnProperty'),RangeError);
  }
  for (const invalid of ['9id','x-y','a b','', 'r\\n', 'x.']) {
    assert.throws(() => computeLayoutAbi({
      layout:'aos',fields:[{name:invalid,type:'u32'}],capacity:1
    }),TypeError);
  }
});

test('heterogeneous layout cells are aligned, nonaliasing and inside committed segments', () => {
  const capacities = [0,1,2,3,5,8,17];
  for (const capacity of capacities) {
    for (const layout of ['aos','soa','aosoa','soaos']) {
      const variants = layout === 'aosoa'
        ? [1,2,4,8].map(tileWidth => ({tileWidth}))
        : layout === 'soaos'
        ? [{groups:[['id','flag'],['x','next']]},
           {groups:[['id'],['x'],['flag'],['next']]}]
        : [{}];
      for (const options of variants) {
        const geometry = computeLayoutAbi({layout,fields,capacity,...options});
        const occupied = new Set();
        for (let row = 0; row < capacity; row++) {
          for (const field of fields) {
            const cell = geometry.address(row,field.name);
            const type = TYPES[field.type];
            assert.equal(cell.byteOffset % type.align,0n,
              `${layout}: misaligned ${field.name}`);
            const segment = geometry.segments[cell.segment];
            assert.ok(segment && cell.byteOffset + type.size <= segment.bytes,
              `${layout}: out-of-bounds ${field.name}`);
            for (let i = 0n; i < type.size; i++) {
              const key = `${cell.segment}:${cell.byteOffset + i}`;
              assert.equal(occupied.has(key),false,
                `${layout}: alias in capacity ${capacity}, ${field.name}`);
              occupied.add(key);
            }
          }
        }
        assert.throws(() => geometry.address(capacity,'x'),RangeError);
      }
    }
  }
});

test('published ABI geometry cannot be mutated after verification', () => {
  assert.equal(Object.isFrozen(TYPES.f64),true);
  assert.throws(() => { TYPES.f64.size = 1n; }, TypeError);

  const geometries = [
    computeLayoutAbi({layout:'aos',fields,capacity:3}),
    computeLayoutAbi({layout:'soa',fields,capacity:3}),
    computeLayoutAbi({layout:'aosoa',fields,capacity:3,tileWidth:4}),
    computeLayoutAbi({layout:'soaos',fields,capacity:3,
      groups:[['id','flag'],['x','next']]})
  ];
  for (const geometry of geometries) {
    const baseline = geometry.address(1,'id');
    assert.equal(Object.isFrozen(geometry.fields),true);
    assert.equal(Object.isFrozen(geometry.locator.id),true);
    assert.equal(Object.isFrozen(geometry.segments[0]),true);
    assert.throws(() => { geometry.fields.push({name:'injected',type:'i64'}); },TypeError);
    assert.throws(() => { geometry.locator.id.segment = 9; },TypeError);
    assert.throws(() => { geometry.segments[0].bytes = 1n; },TypeError);
    if (geometry.layout === 'soaos') {
      assert.equal(Object.isFrozen(geometry.segments[0].fields),true);
      assert.throws(() => { geometry.segments[0].fields[0] = 'next'; },TypeError);
    }
    assert.deepEqual(geometry.address(1,'id'),baseline);
  }
});

test('physical byte quotas include SoAoS strides and AoSoA padded lanes', () => {
  const soa = {layout:'soa',fields,capacity:3};
  const admitted = computeLayoutAbi({...soa,maxSegmentBytes:24n,maxTotalBytes:56n});
  assert.equal(admitted.segments.reduce((sum,s) => sum+s.bytes,0n),51n);
  assert.throws(() => computeLayoutAbi({...soa,maxSegmentBytes:23n}),RangeError);
  assert.equal(admitted.payloadBytes,51n);
  assert.equal(admitted.physicalBytes,56n);
  assert.deepEqual(admitted.segments.map(s=>s.base),[0n,16n,40n,44n]);
  assert.throws(() => computeLayoutAbi({...soa,maxTotalBytes:55n}),RangeError);

  const tiled = {layout:'aosoa',fields,capacity:5,tileWidth:4};
  assert.equal(computeLayoutAbi({...tiled,maxTotalBytes:144n}).segments[0].bytes,144n);
  assert.throws(() => computeLayoutAbi({...tiled,maxTotalBytes:143n}),RangeError);
  assert.throws(() => computeLayoutAbi({...tiled,maxSegmentBytes:143n}),RangeError);

  const groups = {layout:'soaos',fields,capacity:3,
    groups:[['id','flag'],['x','next']]};
  assert.deepEqual(computeLayoutAbi({...groups,maxTotalBytes:72n})
    .segments.map(s => s.bytes),[24n,48n]);
  assert.throws(() => computeLayoutAbi({...groups,maxTotalBytes:71n}),RangeError);

  const empty = computeLayoutAbi({layout:'soa',fields,capacity:0,maxTotalBytes:0n});
  assert.equal(empty.segments.reduce((sum,s) => sum+s.bytes,0n),0n);
  for (const badLimit of [-1n,0,Number.MAX_SAFE_INTEGER,null]) {
    assert.throws(() => computeLayoutAbi({...soa,maxTotalBytes:badLimit}),RangeError);
  }
});

test('single actor-allocation quotas account for inter-segment alignment gaps', () => {
  const twoFields = [{name:'flag',type:'bool'},{name:'x',type:'f64'}];
  const result = computeLayoutAbi({layout:'soa',capacity:1,
    fields:twoFields,maxTotalBytes:16n});
  assert.equal(result.payloadBytes,9n);
  assert.equal(result.physicalBytes,16n);
  assert.deepEqual(result.segments.map(s=>s.base),[0n,8n]);
  assert.throws(()=>computeLayoutAbi({layout:'soa',capacity:1,
    fields:twoFields,maxTotalBytes:15n}),RangeError);
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
