// Independent host-only exact binary-wire test. This does NOT compile AttoLang.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const c = JSON.parse(readFileSync(new URL('../contracts/actor-persistence-scalar-wire-v1.json', import.meta.url)));
const MASK = (1n << 64n) - 1n;
function fnv(data) {
  let h = 0xcbf29ce484222325n;
  for (const b of data) h = ((h ^ BigInt(b)) * 0x100000001b3n) & MASK;
  return h;
}
function le64(value) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt.asUintN(64, BigInt(value))); return b; }
function le32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; }
function le16(value) { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; }
function schema_vector(actor, fields) {
  const sig = [Buffer.from('atto.actor.state.schema.v1\\0'.replace('\\0', '\0'), 'utf8')];
  const actor_name = Buffer.from(actor, 'utf8');
  sig.push(le32(actor_name.length), actor_name);
  for (const f of fields) {
    const name = Buffer.from(f.name, 'utf8');
    sig.push(le32(name.length), name, Buffer.from([c.scalar_tags[f.type]]));
  }
  return fnv(Buffer.concat(sig));
}
function snapshot_vector(actor, fields) {
  const schema = schema_vector(actor, fields);
  const chunks = [Buffer.from('ATTOST01','ascii'), Buffer.from([1]), le64(schema), le16(fields.length)];
  for (const f of fields) {
    chunks.push(Buffer.from([c.scalar_tags[f.type]]));
    chunks.push(f.type === 'int' ? le64(f.value) : Buffer.from([f.value ? 1 : 0]));
  }
  const payload = Buffer.concat(chunks);
  return Buffer.concat([payload, le64(fnv(payload))]);
}
test('scalar-wire-v1 fixed vectors match schema fingerprints and snapshot bytes', () => {
  assert.equal(c.status, 'TARGET_WIRE_FORMAT_ONLY_NO_COMPILED_BACKEND_GUEST');
  assert.ok(Object.values(c.backend_status).every(x=>x==='NOT_EXECUTED'));
  assert.ok(c.vectors.length >= 4);
  for (const v of c.vectors) {
    const id = schema_vector(v.actor, v.fields);
    assert.equal('0x'+id.toString(16).padStart(16,'0'), v.schema_id_hex, v.actor);
    assert.equal(le64(id).toString('hex'), v.schema_hex, v.actor);
    const bytes = snapshot_vector(v.actor, v.fields);
    assert.equal(bytes.toString('hex'), v.snapshot_hex, v.actor);
    assert.equal(bytes.length, v.byte_length, v.actor);
    assert.equal(bytes.slice(0,8).toString('ascii'), 'ATTOST01');
    assert.equal(bytes.readUInt16LE(17), v.fields.length);
    assert.ok(bytes.length <= c.constraints.max_bytes);
  }
});
test('identity and state values are distinct and canonical', () => {
  assert.notEqual(c.vectors[0].snapshot_hex, c.vectors[1].snapshot_hex);
  assert.equal(c.vectors[0].schema_hex, c.vectors[1].schema_hex);
  assert.notEqual(c.vectors[0].schema_hex, c.vectors[3].schema_hex);
  assert.equal(c.constraints.checksum_is_mac, false);
  assert.deepEqual(c.constraints.bool_canonical, [0,1]);
});
