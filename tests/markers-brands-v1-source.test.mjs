import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../fixtures/markers-brands-v1/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const blob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const expected = {
  MB001: ['same-brand-nominal.atto', 42],
  MB002: ['same-brand-cross-nominal.atto', 42],
  MB003: ['reject-wrong-brand.atto', 'missing_required_brand'],
  MB004: ['reject-unbranded.atto', 'missing_required_brand'],
  MB005: ['anonymous-shape-read.atto', 42],
  MB007: ['all-markers.atto', 42],
  MB008: ['reject-missing-marker.atto', 'missing_required_marker'],
  MB027: ['structural-alias.atto', 84],
  MB028: ['integer-tilde.atto', -13],
  MB036: ['distinct-instance.atto', 42],
};
const profiles = ['atto','cranelift','forge','hdl','java','js','llvm','net','realtime','rs','wasm'];

function validate(m, load, names) {
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.status, 'CANDIDATE_SOURCE_NOT_EXECUTED');
  assert.equal(m.contract, 'https://github.com/atto-lang/atto-spec/pull/273');
  assert.equal(m.specHead, '19e4d8e2849efb0714e8f4b6dbe18a3e2da5218e');
  assert.deepEqual(Object.keys(m.backendResults).sort(), profiles);
  assert.ok(Object.values(m.backendResults).every(x => x === 'NOT_EXECUTED'));
  assert.deepEqual(m.cases.map(x => x.id).sort(), Object.keys(expected).sort());
  assert.deepEqual(m.cases.map(x => x.path).sort(), names.filter(x => x.endsWith('.atto')).sort());
  for (const c of m.cases) {
    const [path, outcome] = expected[c.id];
    assert.equal(c.path, path);
    assert.match(c.path, /^[a-z0-9-]+\.atto$/);
    assert.match(c.blob, /^[0-9a-f]{40}$/);
    assert.equal(c.status, 'NOT_EXECUTED');
    assert.deepEqual(c.expected, typeof outcome === 'number'
      ? {kind:'value',value:outcome}
      : {kind:'compile_reject',reason:outcome});
    const bytes = load(path);
    assert.equal(blob(bytes), c.blob, c.id);
    assert.match(bytes.toString('utf8'), /pub fnc main\(\): int/);
  }
}
const load = path => readFileSync(new URL(path, root));
const names = readdirSync(root);
const src = path => load(path).toString('utf8');
test('all ten source blobs and target outcomes match the manifest', () => validate(manifest,load,names));
test('wrong-brand and unbranded negatives differ from the positive only in actual type', () => {
  const positive = src('same-brand-nominal.atto');
  assert.equal(src('reject-wrong-brand.atto'), positive.replace('new UserId()', 'new OrderId()'));
  assert.equal(src('reject-unbranded.atto'), positive.replace('new UserId()', 'new PlainId()'));
  assert.equal(src('same-brand-cross-nominal.atto'), positive.replace('new UserId()', 'new OtherUserId()'));
  assert.equal(src('reject-missing-marker.atto'), src('all-markers.atto').replace('new Customer()', 'new Partial()'));
});
test('both structural spellings and integer complement have independent controls', () => {
  assert.match(src('structural-alias.atto'), /read_long\(structural UserId id\)/);
  assert.match(src('structural-alias.atto'), /read_short\(~UserId id\)/);
  assert.match(src('structural-alias.atto'), /return read_long\(id\) \+ read_short\(id\)/);
  assert.match(src('integer-tilde.atto'), /return ~12;/);
});
test('mutations fail closed: fake evidence, dropped case, wrong expected result and changed source', () => {
  const mutations = [
    m => {m.backendResults.rs = 'PASS';},
    m => {delete m.backendResults.wasm;},
    m => {m.cases.pop();},
    m => {m.cases[1].id = m.cases[0].id;},
    m => {m.cases[2].expected = {kind:'value',value:42};},
    m => {m.cases[0].blob = '0'.repeat(40);},
    m => {m.cases[0].status = 'PASS';},
  ];
  for (const mutate of mutations) {
    const m = structuredClone(manifest); mutate(m);
    assert.throws(() => validate(m,load,names));
  }
  assert.throws(() => validate(manifest, path => Buffer.concat([load(path),Buffer.from(' ')]), names));
  assert.throws(() => validate(manifest,load,[...names,'extra.atto']));
});
