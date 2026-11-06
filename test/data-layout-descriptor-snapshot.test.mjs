import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayoutAbi } from '../verification/data-layout-abi-v1.mjs';

// Source-free ABI oracle tests; do not represent compiler-executed .atto.
test('field type metadata is read once before layout admission', () => {
  let reads = 0;
  const descriptor = {
    name:'value',
    get type() { return ['u32','f64','u32'][reads++]; }
  };
  const layout = computeLayoutAbi({layout:'soa',fields:[descriptor],capacity:2});
  assert.equal(reads,1,'type must not change between validation and byte allocation');
  assert.equal(layout.fields[0].type,'u32');
  assert.equal(layout.fields[0].size,4n);
  assert.equal(layout.fields[0].align,4n);
  assert.equal(layout.address(1,'value').byteOffset,4n);
});

test('field name metadata is read once and snapshots are immutable', () => {
  let reads = 0;
  const descriptor = {
    get name() { return ['value','other','missing'][reads++]; },
    type:'f64'
  };
  const layout = computeLayoutAbi({layout:'aos',fields:[descriptor],capacity:2});
  assert.equal(reads,1);
  assert.equal(layout.fields[0].name,'value');
  assert.equal(layout.address(1,'value').byteOffset,8n);
  assert.throws(()=>layout.address(1,'other'),RangeError);
  assert.equal(Object.isFrozen(layout.fields[0]),true);
});

test('coercible non-string scalar type is rejected rather than bound to mutable authority', () => {
  const trickyType = {toString() { return 'f64'; }};
  assert.throws(()=>computeLayoutAbi({
    layout:'soa',fields:[{name:'x',type:trickyType}],capacity:1
  }),TypeError);
});

test('SoAoS group membership is canonicalized before partition validation and offsets', () => {
  let reads = 0;
  const group = ['x','y'];
  Object.defineProperty(group,0,{
    enumerable:true,configurable:true,
    get() { return ['x','y','x'][reads++]; }
  });
  const layout = computeLayoutAbi({
    layout:'soaos',fields:[{name:'x',type:'u32'},{name:'y',type:'f64'}],
    capacity:2,groups:[group]
  });
  assert.equal(reads,1,'group getter must not be re-read after validation');
  assert.deepEqual(layout.segments[0].fields,['x','y']);
  assert.equal(layout.address(0,'x').byteOffset,0n);
  assert.equal(layout.address(1,'x').byteOffset,16n);
  assert.equal(layout.address(1,'y').byteOffset,24n);
  assert.equal(layout.physicalBytes,32n);
});

test('mutable caller-owned descriptors and groups cannot retarget a published layout', () => {
  const first = {name:'x',type:'u32'};
  const groups = [['x'],['y']];
  const layout = computeLayoutAbi({
    layout:'soaos',fields:[first,{name:'y',type:'i64'}],
    capacity:2,groups
  });
  const before = layout.address(1,'y');
  first.type='f64';
  groups[1][0]='x';
  assert.deepEqual(layout.address(1,'y'),before);
  assert.equal(layout.fields[0].type,'u32');
  assert.deepEqual(layout.segments[1].fields,['y']);
});
