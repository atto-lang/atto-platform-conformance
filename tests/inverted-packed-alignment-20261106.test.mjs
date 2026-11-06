// Source-free nested fixed-struct layout reference: not guest compiler evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {compile_inverted_layout, InvertedReferenceStore} from '../src/inverted-layout-reference.mjs';

const types = {
  Mixed: {kind:'struct',fields:{flag:'bool',counter:'i64',tail:'bool'}},
  Envelope: {kind:'struct',fields:{flag:'bool',payload:'Mixed',tail:'bool'}},
  Particle: {kind:'inverted-class',fields:{packed:'Envelope',tag:'i64'}},
  State: {kind:'inverted-struct',fields:{packed:'Envelope',tag:'i64'}}
};
const payload = {flag:true, payload:{flag:false,counter:5n,tail:true}, tail:false};
const data = {packed:payload,tag:12n};

for (const typeName of ['Particle','State']) {
  test(`${typeName}: nested bool/i64 padding is counted once, never flattened into columns`,()=>{
    const layout=compile_inverted_layout(types,typeName);
    assert.deepEqual(layout.columns.map(c=>c.name),['packed','tag']);
    const envelope=layout.columns[0].descriptor;
    assert.equal(envelope.kind,'packed-struct');
    assert.equal(envelope.width,40);
    assert.equal(envelope.align,8);
    assert.deepEqual(envelope.fields.map(f=>f.offset),[0,8,32]);
    const mixed=envelope.fields[1].descriptor;
    assert.equal(mixed.width,24);
    assert.equal(mixed.align,8);
    assert.deepEqual(mixed.fields.map(f=>f.offset),[0,8,16]);
    assert.equal(layout.rowWidth,48);
    assert.equal(Object.isFrozen(envelope.fields[1]),true);
    const store=new InvertedReferenceStore(layout,2);
    const row=store.push(data);
    payload.payload.counter=999n;
    assert.equal(store.snapshot(row).packed.payload.counter,5n);
    const detached=store.snapshot(row);
    detached.packed.payload.counter=500n;
    assert.equal(store.snapshot(row).packed.payload.counter,5n);
    store.erase_swap(row);
    assert.throws(()=>store.snapshot(row),/stale/);
  });
}

test('padded packed width, not unaligned field-width sum, controls owner quota',()=>{
  const layout=compile_inverted_layout(types,'State');
  assert.equal(layout.rowWidth,48);
  assert.throws(()=>new InvertedReferenceStore(layout,350000),/untrusted owner initialization/);
  assert.ok(new InvertedReferenceStore(layout,1));
});

test('layout snapshot retains frozen ABI offsets after user-supplied schema mutation',()=>{
  const mutable={
    Mixed:{kind:'struct',fields:{flag:'bool',counter:'i64',tail:'bool'}},
    Row:{kind:'inverted-struct',fields:{payload:'Mixed'}}
  };
  const layout=compile_inverted_layout(mutable,'Row');
  mutable.Mixed.fields.counter='bool';
  mutable.Mixed.fields.tail='i64';
  assert.equal(layout.columns[0].descriptor.width,24);
  assert.deepEqual(layout.columns[0].descriptor.fields.map(f=>f.offset),[0,8,16]);
  assert.throws(()=>{layout.columns[0].descriptor.fields[1].offset=0;},TypeError);
});
