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
