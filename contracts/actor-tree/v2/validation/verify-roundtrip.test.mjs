import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {identityKey, signedI64, MIN_I64, MAX_I64, verifyRoundTrip} from './verify-roundtrip.mjs';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const valid = () => JSON.parse(readFileSync(resolve(dir, 'fixtures/valid-roundtrip.json'), 'utf8'));

test('lossless four-hop bidirectional round trip at signed-64 endpoints', () => {
  const result = verifyRoundTrip(valid());
  assert.deepEqual(result.values, [MIN_I64, MIN_I64, MAX_I64, MAX_I64]);
  assert.equal(result.route.length, 3);
});
test('canonical signed i64 accepts both extrema and zero', () => {
  assert.equal(signedI64('-9223372036854775808'), MIN_I64);
  assert.equal(signedI64('9223372036854775807'), MAX_I64);
  assert.equal(signedI64('0'), 0n);
});
for (const value of ['-9223372036854775809', '9223372036854775808',
    '-0', '+1', '01', '-01', '1.0', '1e9', '', 7, 9007199254740993]) {
  test('reject noncanonical/out-of-range signed i64 ' + JSON.stringify(value), () => {
    assert.throws(() => signedI64(value));
  });
}
test('slash and bracket identity combinations do not collide', () => {
  assert.notEqual(
    identityKey({runtimeId:'r/a', actorId:'b', incarnation:1}),
    identityKey({runtimeId:'r', actorId:'a/b', incarnation:1}));
});
const mutations = [
  ['wrong forward/backward direction', t => t.messages[2].direction = 'forward', /hop 2/],
  ['wrong intermediate actor', t => t.messages[1].from.actorId = 'stage/X', /hop 1/],
  ['ABA incarnation swap', t => t.messages[3].to.incarnation = 2, /hop 3/],
  ['duplicate message replay', t => t.messages[3].messageId = t.messages[0].messageId, /duplicate/],
  ['schema hash substitution', t => t.messages[3].schemaHash = 'f'.repeat(64), /schemaHash changed/],
  ['schema hash length', t => t.messages[3].schemaHash = 'f'.repeat(16), /invalid signed-64 schema hash/],
  ['nominal variant substitution', t => t.messages[2].payload.variant = 'Text', /nominal variant changed/],
  ['payload overflow', t => t.messages[3].payload.i64Decimal = '9223372036854775808', /outside/],
  ['cross-runtime route', t => t.route[2].runtimeId = 'foreign', /cross-runtime/],
  ['duplicate actor', t => t.route[1] = structuredClone(t.route[0]), /distinct incarnations/]
];
for (const [name,mutate,match] of mutations) {
  test('reject ' + name, () => {
    const trace=valid(); mutate(trace);
    assert.throws(() => verifyRoundTrip(trace), match);
  });
}
