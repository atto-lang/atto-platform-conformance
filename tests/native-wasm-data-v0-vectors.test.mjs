import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const fixtures = JSON.parse(readFileSync(new URL(
  '../contracts/fixtures/native-wasm-data-v0-vectors.json', import.meta.url), 'utf8'));

const MIN = -(1n << 63n), MAX = (1n << 63n) - 1n;
const schemes = [
  'oreslang.native_wasm.data.request.v0',
  'oreslang.native_wasm.data.response.v0',
  'oreslang.native_wasm.data.ack.v0'
];
function unsigned(value, count) {
  return Buffer.from(Array.from({length: count}, (_, i) =>
    Number((value >> BigInt(8 * (count - i - 1))) & 255n)));
}
function msgpackI64(value) {
  if (value < MIN || value > MAX) throw new RangeError('out of signed i64 range');
  if (value >= 0n) {
    if (value < 128n) return unsigned(value, 1);
    if (value <= 255n) return Buffer.concat([Buffer.from([0xcc]), unsigned(value, 1)]);
    if (value <= 65535n) return Buffer.concat([Buffer.from([0xcd]), unsigned(value, 2)]);
    if (value <= 4294967295n) return Buffer.concat([Buffer.from([0xce]), unsigned(value, 4)]);
    return Buffer.concat([Buffer.from([0xcf]), unsigned(value, 8)]);
  }
  if (value >= -32n) return unsigned(value, 1);
  if (value >= -128n) return Buffer.concat([Buffer.from([0xd0]), unsigned(value, 1)]);
  if (value >= -32768n) return Buffer.concat([Buffer.from([0xd1]), unsigned(value, 2)]);
  if (value >= -2147483648n) return Buffer.concat([Buffer.from([0xd2]), unsigned(value, 4)]);
  return Buffer.concat([Buffer.from([0xd3]), unsigned(value, 8)]);
}
function canonicalTuple(schema, ticket, value) {
  if (!schemes.includes(schema) || ticket <= 0n)
    throw new TypeError('invalid DATA schema or ticket');
  const id = Buffer.from(schema, 'utf8');
  const prefix = id.length <= 31 ? Buffer.from([0xa0 | id.length]) :
    Buffer.from([0xd9, id.length]);
  const digest = createHash('sha256').update(
    'oreslang.actor.shape.v2/T[I,I]', 'utf8').digest();
  return Buffer.concat([
    Buffer.from([0x94, 0x02]), prefix, id,
    Buffer.from([0xc4, 32]), digest, Buffer.from([0x92]),
    msgpackI64(ticket), msgpackI64(value)
  ]);
}

test('native/WASM DATA fixture has a bounded host-only non-executed claim', () => {
  assert.equal(fixtures.contract, 'attolang.native-wasm-data-v0/1');
  assert.equal(fixtures.schemaVersion, 1);
  assert.equal(fixtures.executionEvidence, 'NOT_EXECUTED');
  assert.equal(fixtures.implementationScope, 'host-only-messagepack-data');
  assert.equal(fixtures.compiledGuestParity, false);
  assert.equal(fixtures.maxFrameBytes, 4096);
  assert.equal(fixtures.shapeDescriptor, 'T[I,I]');
  assert.equal(fixtures.shapeHashPrefix, 'oreslang.actor.shape.v2/');
  assert.deepEqual(fixtures.permittedSchemas, schemes);
  assert.equal(fixtures.positives.length, 3);
  assert.equal(fixtures.negatives.length, 5);
  assert.equal(Object.hasOwn(fixtures, 'backendReceipts'), false);
});

test('independent canonical MessagePack oracle checks exact wire bytes', () => {
  const ids = new Set();
  for (const row of fixtures.positives) {
    assert.match(row.id, /^[a-z][a-z0-9_]+$/);
    assert.equal(ids.has(row.id), false);
    ids.add(row.id);
    assert.match(row.ticket, /^(0|[1-9][0-9]*)$/);
    assert.match(row.value, /^-?(0|[1-9][0-9]*)$/);
    const ticket = BigInt(row.ticket), value = BigInt(row.value);
    const native = canonicalTuple(row.schema, ticket, value);
    assert.ok(native.length <= fixtures.maxFrameBytes);
    assert.equal(native.toString('hex'), row.hex, row.id);
  }
  assert.deepEqual([...ids].sort(), [
    'ack_i64_endpoints','request_positive_i64','response_negative_i64'
  ]);
});

test('negative contract IDs cover DATA-only, ownership and integer admission', () => {
  const cases = new Map(fixtures.negatives.map(x => [x.id, x.kind]));
  assert.equal(cases.size, 5);
  assert.deepEqual([...cases].sort(([a], [b]) => a.localeCompare(b)), [
    ['control_schema','unregistered-schema'],
    ['proxy_typedarray','forged-view-denial'],
    ['shared_backing','shared-memory-denial'],
    ['uint64_overflow','signed-i64-range'],
    ['zero_ticket','ticket-not-positive']
  ]);
  assert.throws(() => canonicalTuple('CONTROL', 1n, 1n), /invalid DATA/);
  assert.throws(() => canonicalTuple(schemes[0], 0n, 1n), /invalid DATA/);
  assert.throws(() => canonicalTuple(schemes[0], 1n, MAX + 1n), /signed i64/);
});
