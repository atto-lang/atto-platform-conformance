// Source-free host regression. This does not establish AttoLang guest execution
// or GPU/SIMD kernel correctness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LayoutStore } from '../src/layout-storage-oracle.mjs';
import { computeLayoutAbi } from '../verification/data-layout-abi-v1.mjs';

const schema = [
  { name: 'x', type: 'f64' },
  { name: 'group', type: 'u32' }
];

test('AoSoA host reference honors canonical power-of-two widths 1..1024', () => {
  for (const width of [1, 2, 4, 64, 128, 1024]) {
    // The +1 forces a second partially occupied tile, including at width 1024.
    const capacity = width + 1;
    const abi = computeLayoutAbi({
      layout: 'aosoa', fields: schema, capacity, tileWidth: width
    });
    const store = new LayoutStore(schema, {
      layout: 'aosoa', capacity, width, maxBytes: 131072
    });
    const handles = [];
    for (let i = 0; i < capacity; i++) {
      handles.push(store.push({ x: i + 0.5, group: i }));
    }
    assert.equal(BigInt(store.byteLength), abi.physicalBytes, 'physical bytes, width ' + width);
    for (const i of [0, width - 1, width]) {
      for (const field of schema) {
        const expected = abi.address(i, field.name);
        assert.equal(BigInt(store.physicalOffset(handles[i], field.name)),
          abi.segments[expected.segment].base + expected.byteOffset,
          'absolute byte offset, width ' + width + ', row ' + i + ', ' + field.name);
      }
      assert.deepEqual(store.get(handles[i]), { x: i + 0.5, group: i });
    }
    store.convert('soa');
    store.convert('aosoa', { width });
    for (const i of [0, width - 1, width]) {
      assert.deepEqual(store.get(handles[i]), { x: i + 0.5, group: i },
        'stable row handle after roundtrip, width ' + width);
    }
    store.dispose();
  }
});

test('AoSoA rejects all noncanonical widths before allocation or publication', () => {
  for (const width of [0, -1, 3, 65, 1023, 1025, 2048,
                       NaN, Infinity, 1.5, '8', Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => new LayoutStore(schema, {
      layout: 'aosoa', capacity: 2, width
    }), RangeError, 'width ' + String(width));
  }
  const empty = new LayoutStore(schema, {
    layout: 'aosoa', capacity: 0, width: 1
  });
  assert.equal(empty.length, 0);
  assert.equal(empty.byteLength, 0);
  empty.dispose();
});
