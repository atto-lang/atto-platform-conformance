import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {physicalLayoutV1} from '../verification/dop-physical-layout-v1.mjs';

const registry = JSON.parse(readFileSync(
  new URL('../contracts/dop-physical-layout-v1.json', import.meta.url), 'utf8'));
const base = {rows: registry.rows, fields: registry.fields};
const plan = entry => physicalLayoutV1({...base,kind:entry.kind,lanes:entry.lanes,
  groups:entry.groups});

test('versioned corpus explicitly separates host address checks from guest compiler evidence',()=>{
  assert.equal(registry.contract, 'attolang.dop.physical-layout/1');
  assert.equal(registry.classification,'HOST_TYPED_LAYOUT_PLAN_NOT_ATTO_SOURCE_COMPILATION');
  assert.deepEqual(registry.plans.map(x=>x.kind),['aos','soa','aosoa','soaos']);
});
test('four independently fixed golden physical byte lengths, segments and addresses',()=>{
  for(const fixture of registry.plans) {
    const p=plan(fixture);
    assert.equal(p.physicalBytes.toString(),fixture.expectedPhysicalBytes, fixture.kind);
    assert.deepEqual(p.segments.map(s=>({alignment:Number(s.alignment),
      bytes:s.bytes.toString(),stride:s.stride.toString(),base:s.base.toString()})),
      fixture.expectedSegments, fixture.kind);
    for(const cell of fixture.sampledAbsoluteOffsets) {
      assert.equal(p.address(cell.row,cell.field).absolute.toString(),cell.absolute,
        fixture.kind+' row='+cell.row+' field='+cell.field);
    }
  }
});
test('physical buffer cells never overlap and are bounded across layout variants',()=>{
  for(const fixture of registry.plans) {
    const p=plan(fixture),used=new Set();
    for(let row=0;row<Number(registry.rows);row++)
      for(let field=0;field<registry.fields.length;field++) {
        const cell=p.address(row,field),width=registry.fields[field].bytes;
        assert.ok(cell.absolute>=0n && cell.absolute+BigInt(width)<=p.physicalBytes);
        for(let byte=0;byte<width;byte++) {
          const b=(cell.absolute+BigInt(byte)).toString();
          assert.ok(!used.has(b),fixture.kind+' overlapped byte '+b);
          used.add(b);
        }
      }
  }
});
test('padding and physical row ordering are layout-distinct, even for equal logical rows',()=>{
  const lookup=Object.fromEntries(registry.plans.map(x=>[x.kind,plan(x)]));
  assert.notEqual(lookup.aos.address(4,1).absolute,lookup.soa.address(4,1).absolute);
  assert.notEqual(lookup.aosoa.address(4,2).absolute,lookup.soaos.address(4,2).absolute);
  assert.deepEqual(['120','74','112','80'],
    registry.plans.map(x=>lookup[x.kind].physicalBytes.toString()));
});
test('zero-row buffers are empty and all cell accesses are rejected',()=>{
  for(const entry of registry.plans) {
    const p=physicalLayoutV1({...base,rows:'0',kind:entry.kind,lanes:entry.lanes,
      groups:entry.groups});
    assert.equal(p.physicalBytes,0n,entry.kind);
    assert.throws(()=>p.address(0,0),/out-of-bounds/);
  }
});
test('AoSoA requires a valid power-of-two lane count and proper padded tail',()=>{
  const p=physicalLayoutV1({...base,kind:'aosoa',lanes:4});
  assert.equal(p.address(4,0).absolute,56n);
  assert.equal(p.address(4,2).absolute,104n);
  for(const lanes of [0,3,1025]) assert.throws(
    ()=>physicalLayoutV1({...base,kind:'aosoa',lanes}),/lanes/);
  assert.throws(()=>physicalLayoutV1({...base,kind:'soa',lanes:4}),/lanes/);
});
test('SoAoS requires an explicit, complete, nonoverlapping field partition',()=>{
  for(const groups of [[],[[0,2]],[[0,2],[2,1]],[[],[0,1,2]],[[0,3],[1,2]]])
    assert.throws(()=>physicalLayoutV1({...base,kind:'soaos',groups}),/groups|partition|empty-group/);
  assert.throws(()=>physicalLayoutV1({...base,kind:'aos',groups:[[0,1,2]]}),/groups/);
});
test('width/alignment, field-count and size quotas fail closed',()=>{
  for(const fields of [[],Array.from({length:65},()=>({bytes:4,alignment:4})),
    [{bytes:3,alignment:4}], [{bytes:8,alignment:4}], [{bytes:4,alignment:3}],
    [{bytes:4,alignment:8192}]])
    assert.throws(()=>physicalLayoutV1({kind:'aos',rows:'5',fields}));
  assert.throws(()=>physicalLayoutV1({...base,kind:'aos',maximumBytes:'119'}),/quota-exceeded/);
  assert.throws(()=>physicalLayoutV1({...base,kind:'aos',rows:'9223372036854775807'}),
    /overflow/);
});
test('invalid signed indices, wrong fields and unsafe numeric row counts fail closed',()=>{
  for(const entry of registry.plans) {
    const p=plan(entry);
    for(const [row,field] of [[-1,0],[5,0],[0,-1],[0,3]])
      assert.throws(()=>p.address(row,field));
  }
  assert.throws(()=>physicalLayoutV1({...base,kind:'aos',rows:2**53}),/rows/);
  assert.throws(()=>physicalLayoutV1({...base,kind:'aos',rows:'-1'}),/rows/);
});

test('duplicate, empty and NUL scalar field names are rejected before allocation',()=>{
  for(const fields of [
    [{name:'position',bytes:4,alignment:4},{name:'position',bytes:8,alignment:8}],
    [{name:'',bytes:4,alignment:4}],
    [{name:'a'+String.fromCharCode(0)+'b',bytes:4,alignment:4}],
    [{name:'a'.repeat(1025),bytes:4,alignment:4}]
  ]) assert.throws(()=>physicalLayoutV1({kind:'aos',rows:'2',fields}),/field/);
});
test('validated segment plans cannot be mutated by a receipt consumer',()=>{
  for(const entry of registry.plans) {
    const p=plan(entry);
    assert.equal(Object.isFrozen(p),true);
    assert.equal(Object.isFrozen(p.segments),true);
    for(const s of p.segments) assert.equal(Object.isFrozen(s),true);
    assert.equal(p.physicalBytes.toString(),entry.expectedPhysicalBytes);
  }
});

test('SoAoS ignores an iterator that changes its group indices after validation',()=>{
  const group=[0,2];
  let iterations=0;
  group[Symbol.iterator]=function*() {
    iterations++;
    yield* (iterations===1?[0,2]:[1,2]);
  };
  const p=physicalLayoutV1({...base,kind:'soaos',groups:[group,[1]]});
  assert.equal(iterations,0);
  assert.equal(p.physicalBytes,80n);
  assert.deepEqual([0,1,2].map(field=>p.address(0,field).absolute),[0n,40n,4n]);
  assert.deepEqual([0,1,2].map(field=>p.address(4,field).absolute),[32n,72n,36n]);
});
test('field-width getters never influence physical ABI validation',()=>{
  let reads=0;
  const field={name:'unstable',alignment:4,
    get bytes() { reads++; return reads===1?4:16; }
  };
  assert.throws(()=>physicalLayoutV1({kind:'aos',rows:'2',fields:[field]}),
    /physical-layout-field/);
  assert.equal(reads,0);
});
test('SoAoS accessor group indices cannot change across validation and layout',()=>{
  const group=[0,2];
  let reads=0;
  Object.defineProperty(group,'0',{configurable:true,enumerable:true,
    get() { reads++; return reads===1?0:1; }
  });
  assert.throws(()=>physicalLayoutV1({...base,kind:'soaos',groups:[group,[1]]}),
    /physical-layout-group-partition/);
  assert.equal(reads,0);
});


test('physical field names require valid Unicode scalars and <=1024 UTF-8 bytes', () => {
  for (const name of [' ', 'β', 'é', 'e\u0301', '💾',
    'a'.repeat(1024), '💾'.repeat(256)]) {
    const p=physicalLayoutV1({kind:'soa',rows:1,
      fields:[{name,bytes:4,alignment:4}]});
    assert.equal(p.address(0,0).absolute,0n);
  }
  for (const name of ['', '\0', '\uD800', '\uDC00', 'x\uD800y',
    '\uD800\uD800', 'a'.repeat(1025), '💾'.repeat(257),
    '€'.repeat(342)]) {
    assert.throws(()=>physicalLayoutV1({kind:'aos',rows:1,
      fields:[{name,bytes:4,alignment:4}]}),/field-0/);
  }
});

test('physical field name identity is exact; do not silently normalize Unicode', () => {
  const two=physicalLayoutV1({kind:'aos',rows:2,fields:[
    {name:'é',bytes:2,alignment:2},{name:'e\u0301',bytes:4,alignment:4}
  ]});
  assert.equal(two.fields,2);
  assert.notEqual(two.address(0,0).absolute,two.address(0,1).absolute);
  assert.throws(()=>physicalLayoutV1({kind:'aos',rows:1,fields:[
    {name:'💾',bytes:4,alignment:4},{name:'💾',bytes:4,alignment:4}
  ]}),/field-1/);
});

test('exhaustive small geometry across rows, widths, padding and group layouts', () => {
  const fields=[{name:'u8',bytes:1,alignment:1},
    {name:'u16',bytes:2,alignment:4},
    {name:'u32',bytes:4,alignment:8},
    {name:'u64',bytes:8,alignment:16}];
  for(const rows of [0,1,2,3,4,5,7,8,9,17,31,32,33]) {
    for(const kind of ['aos','soa','aosoa','soaos']) {
      const p=physicalLayoutV1({kind,rows,fields,
        lanes:kind==='aosoa'?4:1,
        groups:kind==='soaos'?[[0,2],[3,1]]:[]});
      const used=new Set();
      for(let row=0;row<rows;row++)for(let field=0;field<fields.length;field++){
        const cell=p.address(row,field);
        const width=fields[field].bytes;
        assert.equal(cell.absolute%BigInt(fields[field].alignment),0n,
          kind+' alignment row='+row+' field='+field);
        assert.ok(cell.offset+BigInt(width)<=p.segments[cell.segment].bytes);
        assert.ok(cell.absolute+BigInt(width)<=p.physicalBytes);
        for(let j=0;j<width;j++){
          const byte=(cell.absolute+BigInt(j)).toString();
          assert.ok(!used.has(byte),kind+' overlapping live cell '+byte);
          used.add(byte);
        }
      }
      if(rows===0) assert.equal(p.physicalBytes,0n);
      else assert.ok(p.physicalBytes>=BigInt(rows*15));
    }
  }
});
