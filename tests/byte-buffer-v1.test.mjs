import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const url = new URL('../contracts/byte-buffer-v1.json', import.meta.url);
const contract = JSON.parse(readFileSync(url, 'utf8'));
const expected = [
  'EXIT_1','EXIT_1','EXIT_1','EXIT_1','EXIT_1',
  'THROWS_BUFFER_BOUNDS','THROWS_BUFFER_BOUNDS','THROWS_BUFFER_BOUNDS',
  'COMPILE_IMMUTABLE','THROWS_BUFFER_VALUE','THROWS_BUFFER_BOUNDS',
  'THROWS_BUFFER_ALLOCATION',
  'EXIT_1','EXIT_1','EXIT_1','EXIT_1','EXIT_1',
  'THROWS_BUFFER_VALUE','THROWS_BUFFER_VALUE','THROWS_BUFFER_BOUNDS',
  'EXIT_1','THROWS_BUFFER_BOUNDS',
];
const backendNames = ['java','llvm','wasm','rs','net','forge','cranelift','js','atto','hdl'];

function refU32(length, offset, value, order, write = true) {
  // HOST REFERENCE ONLY. This does NOT compile or execute AttoLang.
  if (!Number.isSafeInteger(length) || length < 0) throw new Error('BufferAllocationError');
  const bytes = new Uint8Array(length);
  const checkOffset = (o) => {
    const at = BigInt(o);
    if (at < 0n || at > BigInt(length) - 4n) throw new Error('BufferBoundsError');
    return Number(at);
  };
  if (write) {
    // Preflight both value and bounds before changing the allocation.
    const pos = checkOffset(offset);
    if (typeof value !== 'bigint' || value < 0n || value > 4294967295n)
      throw new Error('BufferValueError');
    for (let i = 0; i < 4; i++) {
      const bit = BigInt(8 * (order === 'le' ? i : 3 - i));
      bytes[pos + i] = Number((value >> bit) & 255n);
    }
  }
  return bytes;
}
function readU32(bytes, offset, order) {
  const o = BigInt(offset);
  if (o < 0n || o > BigInt(bytes.length) - 4n) throw new Error('BufferBoundsError');
  let n = 0n;
  for (let i = 0; i < 4; i++) {
    const bit = BigInt(8 * (order === 'le' ? i : 3-i));
    n |= BigInt(bytes[Number(o)+i]) << bit;
  }
  return n;
}

test('registry is explicitly NOT_EXECUTED and links all portable fixtures', () => {
  assert.equal(contract.schema, 'atto.byte-buffer.v1');
  assert.equal(contract.status, 'TARGET_NOT_EXECUTED');
  assert.equal(contract.canonical_module, 'std.buffer');
  assert.deepEqual(contract.backends.map(x => x.backend), backendNames);
  for (const target of contract.backends) {
    assert.equal(target.execution, 'NOT_EXECUTED');
    assert.equal(target.receipt, null);
  }
  assert.equal(contract.cases.length, expected.length);
  assert.equal(contract.required_additional_gates.length, 13);
  for (let i=0;i<contract.cases.length;i++) {
    const item = contract.cases[i];
    assert.equal(item.id, 'BB-' + String(i+1).padStart(3, '0'));
    assert.equal(item.expected, expected[i]);
    assert.match(item.source, /^fixtures\/byte-buffer-v1\/\d\d-[a-z0-9-]+\.atto$/);
    const source = readFileSync(new URL('../' + item.source, import.meta.url), 'utf8');
    assert.match(source, /import module buffer from pkg "std\.buffer";/);
    assert.match(source, /pub fnc main\(\): int throws Error/);
    assert.ok(source.endsWith('\n') && !source.includes('\r') && !source.startsWith('\uFEFF'));
  }
});
test('host-only reference verifies endian and zero init', () => {
  for (const order of ['le','be']) {
    const bytes = refU32(8,0,0x12345678n,order);
    assert.deepEqual(Array.from(bytes.subarray(0,4)), order==='le' ? [0x78,0x56,0x34,0x12] : [0x12,0x34,0x56,0x78]);
    assert.deepEqual(Array.from(bytes.subarray(4)), [0,0,0,0]);
    assert.equal(readU32(bytes,0,order),0x12345678n);
    assert.equal(readU32(refU32(8,1,0x12345678n,order),1,order),0x12345678n);
    assert.equal(readU32(refU32(8,4,0x12345678n,order),4,order),0x12345678n);
  }
});
test('host-only reference rejects bad offsets and values without modifying prior bytes', () => {
  const original = refU32(8,0,0x12345678n,'le');
  for (const offset of [-1n,5n,9223372036854775807n]) {
    assert.throws(() => refU32(8,offset,1n,'le'), /BufferBoundsError/);
    assert.throws(() => readU32(original,offset,'le'), /BufferBoundsError/);
  }
  for (const val of [-1n,4294967296n]) assert.throws(() => refU32(8,0,val,'le'), /BufferValueError/);
  assert.deepEqual(Array.from(original),[0x78,0x56,0x34,0x12,0,0,0,0]);
});
