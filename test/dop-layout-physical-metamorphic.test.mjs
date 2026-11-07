import test from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, computeLayoutAbi } from '../verification/data-layout-abi-v1.mjs';
import { certifyPhysicalLayout } from '../verification/dop-layout-physical-certifier-v1.mjs';

// Source-free seeded cross-layout geometry reference. This is not SMT,
// LLVM codegen, Truffle guest, native/AOT, or GPU memory safety evidence.
const SCALARS = ['bool','i8','u16','i32','f32','i64','u64','f64','char32','ref32'];
const CAPACITIES = [0,1,2,3,5,7,8,9,15,16,17,31,32,33,63,64,65,95,96,97];
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return state >>> 0;
  };
}
function planFor(seed) {
  const next = random((seed * 2654435761) >>> 0);
  const count = 1 + next() % 6;
  const fields = Array.from({length:count},(_,i)=>({
    name:'f'+i,type:SCALARS[next()%SCALARS.length]
  }));
  const capacity = CAPACITIES[next()%CAPACITIES.length];
  const layout = ['aos','soa','aosoa','soaos'][seed % 4];
  const options = {layout,fields,capacity};
  if (layout === 'aosoa') {
    options.tileWidth = 1 << (next()%5);
  } else if (layout === 'soaos') {
    const even = fields.filter((_,i)=>i%2===0).map(x=>x.name);
    const odd = fields.filter((_,i)=>i%2===1).map(x=>x.name);
    options.groups = odd.length ? [even,odd] : [even];
  }
  return options;
}

test('192 deterministic mixed-width layouts certify exact finite field cells',()=>{
  let checked = 0n, zero = 0;
  const seen = new Set();
  for (let seed=1;seed<=192;seed++) {
    const options = planFor(seed);
    const physical = computeLayoutAbi(options);
    const certificate = certifyPhysicalLayout(physical);
    const expectedLive = physical.fields.reduce((a,f)=>a+f.size,0n)
      * BigInt(options.capacity);
    const expectedCells = BigInt(options.capacity * options.fields.length);
    assert.equal(certificate.layout,options.layout);
    assert.equal(certificate.checkedCells,expectedCells);
    assert.equal(certificate.liveBytes,expectedLive);
    assert.equal(certificate.physicalBytes,physical.physicalBytes);
    assert.ok(certificate.paddingAndUnusedBytes >= 0n);
    assert.ok(Object.isFrozen(certificate));
    assert.throws(()=>physical.address(options.capacity,options.fields[0].name),
      /invalid row|row\/field/);
    if (options.capacity === 0) zero++;
    checked += expectedCells;
    seen.add(options.layout);
  }
  assert.equal(seen.size,4,'all physical layouts exercised');
  assert.ok(checked > 5000n,'insufficient independent address coverage');
  assert.ok(zero > 0,'zero-capacity layouts were skipped');
});

test('mutation controls detect aliasing, out-of-bounds and field alignment loss',()=>{
  const plan = computeLayoutAbi({layout:'soa',capacity:4,fields:[
    {name:'x',type:'i64'}, {name:'y',type:'u16'}, {name:'flag',type:'bool'}
  ]});
  const original = plan.address;
  const alias = {...plan,address(row,field) {
    if(field === 'x') return {segment:0,byteOffset:0n};
    return original(row,field);
  }};
  assert.throws(()=>certifyPhysicalLayout(alias),/aliased physical cells/);
  const misalign = {...plan,address(row,field) {
    const pos = original(row,field);
    return field==='x' ? {segment:pos.segment,byteOffset:pos.byteOffset+1n}:pos;
  }};
  assert.throws(()=>certifyPhysicalLayout(misalign),/misaligned physical field/);
  const overflow = {...plan,address(row,field) {
    const pos = original(row,field);
    return field==='y' ? {segment:pos.segment,
      byteOffset:plan.segments[pos.segment].bytes}:pos;
  }};
  assert.throws(()=>certifyPhysicalLayout(overflow),/outside allocation/);
});

test('mutation controls detect forged extents, alignment, widths and field identities',()=>{
  const plan = computeLayoutAbi({layout:'aos',capacity:5,fields:[
    {name:'x',type:'i64'}, {name:'y',type:'i8'}
  ]});
  const mutations = [
    [{...plan,physicalBytes:plan.physicalBytes-1n},/charged physical allocation/],
    [{...plan,payloadBytes:plan.payloadBytes+1n},/charged physical allocation/],
    [{...plan,segments:[{...plan.segments[0],align:3n}]},/invalid segment/],
    [{...plan,segments:[{...plan.segments[0],base:1n}]},/incorrect segment base/],
    [{...plan,fields:[{...plan.fields[0],type:'bool'},plan.fields[1]]},
      /invalid declared scalar physical width/],
    [{...plan,fields:[plan.fields[0],
      {...plan.fields[1],name:plan.fields[0].name}]},/invalid declared scalar physical width/]
  ];
  for(const [forged,diagnostic] of mutations) {
    assert.throws(()=>certifyPhysicalLayout(forged),diagnostic);
  }
});

test('finite cell budget must be exact, not silently sample a plan',()=>{
  for(const size of [1,2,3,8,16,63]) {
    const plan = computeLayoutAbi({layout:'soa',capacity:size,fields:[
      {name:'a',type:'i32'},{name:'b',type:'i64'},{name:'c',type:'bool'}
    ]});
    assert.equal(certifyPhysicalLayout(plan,size*3).checkedCells,BigInt(size*3));
    assert.throws(()=>certifyPhysicalLayout(plan,size*3-1),/budget exceeded/);
  }
  const plain = computeLayoutAbi({layout:'soa',capacity:1,fields:[
    {name:'x',type:'u64'}
  ]});
  for (const invalid of [-1,1.5,NaN,Infinity,1000001]) {
    assert.throws(()=>certifyPhysicalLayout(plain,invalid),
      /invalid finite verification budget/);
  }
});

test('canonical scalar metadata remains frozen after randomized certifications',()=>{
  assert.ok(Object.isFrozen(TYPES));
  for(const type of SCALARS) assert.ok(Object.isFrozen(TYPES[type]));
  const plan = computeLayoutAbi({layout:'soa',capacity:3,fields:[
    {name:'x',type:'i64'},{name:'y',type:'i32'}
  ]});
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.fields));
  assert.ok(Object.isFrozen(plan.segments));
  const before = certifyPhysicalLayout(plan);
  assert.equal(before.checkedCells,6n);
  assert.equal(certifyPhysicalLayout(plan).physicalBytes,before.physicalBytes);
});
