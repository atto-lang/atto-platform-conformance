import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {identityKey, signedI64, MIN_I64, MAX_I64, NORMATIVE_SCHEMA_SHA256, verifyRoundTrip, verifyAndClaimRoundTrip} from './verify-roundtrip.mjs';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const valid = () => JSON.parse(readFileSync(resolve(dir, 'fixtures/valid-roundtrip.json'), 'utf8'));
const trusted = Object.freeze({
  expectedPipelineId: 'pipeline-native-i64-round-trip-1',
  expectedSchemaHash: NORMATIVE_SCHEMA_SHA256,
  expectedRoute: Object.freeze([
    {runtimeId:'runtime-1',actorId:'stage/A',incarnation:1},
    {runtimeId:'runtime-1',actorId:'stage/B',incarnation:1},
    {runtimeId:'runtime-1',actorId:'stage/C',incarnation:1},
  ])
});
const verify = trace => verifyRoundTrip(trace, trusted);

test('lossless four-hop bidirectional round trip at signed-64 endpoints', () => {
  const result = verify(valid());
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
    assert.throws(() => verify(trace), match);
  });
}

for (const [name, mutate, match] of [
  ['missing pipeline id', t => delete t.pipelineId, /missing round-trip trace field: pipelineId/],
  ['null actor incarnation', t => t.route[1].incarnation = null, /invalid physical actor identity/],
  ['empty actor id', t => t.route[0].actorId = '', /invalid physical actor identity/],
  ['oversized message id', t => t.messages[0].messageId = 'x'.repeat(129), /duplicate or missing messageId/],
  ['invalid negative incarnation', t => t.messages[0].to.incarnation = -1, /invalid physical actor identity/],
]) {
  test('reject malformed runtime identity / wire field: ' + name, () => {
    const fixture=valid(); mutate(fixture);
    assert.throws(() => verify(fixture), match);
  });
}

test('reject two incarnations of the same logical actor as distinct pipeline stages', () => {
  const fixture=valid();
  fixture.route[1].actorId = fixture.route[0].actorId;
  fixture.route[1].incarnation = 2;
  assert.throws(() => verify(fixture), /distinct logical actors/);
});

test('reject verification without independent authority context', () => {
  assert.throws(() => verifyRoundTrip(valid()), /trusted pipeline authority context/);
});
test('reject internally consistent attacker-selected schema hash', () => {
  const trace=valid();
  for (const m of trace.messages) m.schemaHash='f'.repeat(64);
  assert.throws(() => verify(trace), /trusted schema\/actor authority/);
});
test('reject internally consistent but unauthorized actor route', () => {
  const trace=valid();
  trace.route[0].actorId='attacker';
  trace.messages[0].from.actorId='attacker';
  trace.messages[3].to.actorId='attacker';
  assert.throws(() => verify(trace), /trusted schema\/actor authority/);
});
test('reject internally consistent but substituted pipeline ID', () => {
  const trace=valid();trace.pipelineId='other-request';
  assert.throws(() => verify(trace), /trusted schema\/actor authority/);
});
test('reject undeclared fields at every wire boundary', () => {
  for(const mutate of [
    t=>{t.unsafeExtra=true;},
    t=>{t.route[0].unsafeExtra=true;},
    t=>{t.messages[0].unsafeExtra=true;},
    t=>{t.messages[0].payload.unsafeExtra=true;}
  ]) {
    const trace=valid();mutate(trace);
    assert.throws(() => verify(trace), /undeclared/);
  }
});

test('reject fake 64-hex schema hash even with caller-supplied fake authority', () => {
  const trace = valid();
  const fake = 'f'.repeat(64);
  for (const msg of trace.messages) msg.schemaHash = fake;
  assert.throws(() => verifyRoundTrip(trace, {...trusted, expectedSchemaHash:fake}),
    /trusted pipeline authority context/);
});

test('host claim ledger rejects whole-trace replay after one accepted pipeline', () => {
  const seen=new Set();
  let calls=0;
  const ledger={
    claim(key) {
      calls++;
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    }
  };
  const first=verifyAndClaimRoundTrip(valid(),trusted,ledger);
  assert.equal(first.values.length,4);
  assert.equal(first.claimKey, JSON.stringify(['runtime-1','pipeline-native-i64-round-trip-1']));
  assert.throws(() => verifyAndClaimRoundTrip(valid(),trusted,ledger),
    /pipeline replay rejected/);
  assert.equal(calls,2);
  assert.equal(seen.size,1);
});

test('untrusted invalid trace cannot consume replay claim capacity', () => {
  let called=0;
  const ledger={claim(){called++;return true;}};
  const forged=valid();
  forged.messages[0].schemaHash='f'.repeat(64);
  assert.throws(() => verifyAndClaimRoundTrip(forged,trusted,ledger),
    /schemaHash changed|trusted schema\/actor authority/);
  assert.equal(called,0);
});

test('cannot replay pipelineId under a different actor route in same runtime', () => {
  const seen=new Set();
  const ledger={claim(key){if(seen.has(key))return false;seen.add(key);return true;}};
  verifyAndClaimRoundTrip(valid(),trusted,ledger);
  const forged=valid();
  for(const actor of forged.route){
    actor.actorId='other-'+actor.actorId;
  }
  for(const envelope of forged.messages){
    envelope.from.actorId='other-'+envelope.from.actorId;
    envelope.to.actorId='other-'+envelope.to.actorId;
  }
  const other={...trusted,expectedRoute:forged.route};
  assert.throws(() => verifyAndClaimRoundTrip(forged,other,ledger),
    /pipeline replay rejected/);
  assert.equal(seen.size,1);
});

test('fail closed if ledger is missing or asynchronously claims', () => {
  assert.throws(() => verifyAndClaimRoundTrip(valid(),trusted,null),
    /host-owned atomic replay claim ledger/);
  assert.throws(() => verifyAndClaimRoundTrip(valid(),trusted,{
    claim:()=>Promise.resolve(true)
  }), /claim outcome not authoritative/);
});

test('fail closed on unknown interrupted external claim', () => {
  let attempted=0;
  assert.throws(() => verifyAndClaimRoundTrip(valid(),trusted,{
    claim(){attempted++;throw new Error('durable journal fsync unknown');}
  }), /durable journal fsync unknown/);
  assert.equal(attempted,1);
});
