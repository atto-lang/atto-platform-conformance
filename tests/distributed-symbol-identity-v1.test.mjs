import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const v = JSON.parse(readFileSync(new URL('../contracts/distributed-symbol-identity-v1.json', import.meta.url), 'utf8'));
test('fixture UUIDs have canonical v4 bytes and distinct declaration identities', () => {
  const seen = new Set();
  for (const b of v.bindings) {
    assert.match(b.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(Buffer.from(b.wire_hex, 'hex').length, 16);
    assert.equal(b.uuid.replaceAll('-', ''), b.wire_hex);
    assert.ok(!seen.has(b.uuid));
    seen.add(b.uuid);
  }
  assert.equal(v.bindings[0].declaration, v.bindings[1].declaration);
  assert.notEqual(v.bindings[0].namespace, v.bindings[1].namespace);
});
test('all target scenarios unique; no unearned execution status', () => {
  assert.equal(v.cases.length, 28);
  assert.equal(new Set(v.cases.map(c => c.id)).size, v.cases.length);
  assert.ok(v.cases.every(c => c.status === 'NOT_EXECUTED' && c.expected.length > 0));
  assert.deepEqual(Object.keys(v.backends).sort(), ['cranelift','forge','hdl','java','js','llvm','net','rs','wasm']);
  assert.ok(Object.values(v.backends).every(s => s === 'NOT_EXECUTED'));
});
