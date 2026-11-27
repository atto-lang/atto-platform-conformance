import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

// Inventory checks only. Never count these as compiler or guest execution.
const manifest = JSON.parse(readFileSync(new URL('../contracts/pair-binding-equivalence-v1.json', import.meta.url), 'utf8'));
const directory = '../fixtures/pair-binding-equivalence-v1/';
const files = new Map(manifest.fixtures.map(f => [f.id, f]));
const source = id => readFileSync(new URL(directory + id + '.atto', import.meta.url), 'utf8');
const backendRoles = ['atto','cranelift','forge','hdl','java','js','llvm','net','realtime','rs','wasm'];

test('candidate inventory cannot certify backend execution', () => {
  assert.equal(manifest.schema, 'atto.pair-binding-equivalence.v1');
  assert.equal(manifest.status, 'SOURCE_CANDIDATE_ONLY');
  assert.equal(manifest.backend_count, backendRoles.length);
  assert.deepEqual(manifest.backends.map(b => b.repo), backendRoles.map(r => 'atto-lang/atto-source.' + r));
  for (const b of manifest.backends) {
    assert.equal(b.guest_status, 'NOT_EXECUTED');
    assert.equal(b.receipt, null);
  }
});

test('all twelve complete sources are registered exactly once', () => {
  assert.equal(files.size, 12);
  assert.equal(manifest.fixtures.length, files.size);
  assert.deepEqual(readdirSync(new URL(directory, import.meta.url)).sort(), [...files.keys()].map(id => id + '.atto').sort());
  for (const [id, f] of files) {
    assert.match(id, /^[a-z0-9-]+$/);
    assert.equal(f.path, 'fixtures/pair-binding-equivalence-v1/' + id + '.atto');
    assert.equal(f.status, 'NOT_EXECUTED');
    assert.match(source(id), /^pub fnc main\(\): int \{|\npub fnc main\(\): int \{/m);
  }
});

test('eight positive targets and four negative targets remain separate', () => {
  assert.equal(manifest.fixtures.filter(f => f.expected.main_result === 5).length, 8);
  assert.equal(manifest.fixtures.filter(f => typeof f.expected.compile_reject === 'string').length, 4);
  for (const f of manifest.fixtures) assert.notEqual('main_result' in f.expected, 'compile_reject' in f.expected);
});

test('negative controls change exactly one specified source line', () => {
  for (const f of manifest.fixtures.filter(f => f.expected.compile_reject)) {
    assert.equal(files.get(f.paired_positive)?.expected.main_result, 5);
    const a = source(f.id).split('\n'), b = source(f.paired_positive).split('\n');
    assert.equal(a.length, b.length);
    assert.deepEqual(a.flatMap((line, i) => line === b[i] ? [] : [i + 1]), [f.diagnostic_line]);
  }
});

test('same-name positives observe a stored typed Pair and both projections', () => {
  const a = source('short');
  assert.equal(source('expanded'), a.replace('const x := 5;', 'const x = x := 5;'));
  assert.equal(source('factory'), a.replace('const x := 5;', 'const x = Pair.of("x", 5);'));
  assert.match(a, /const Pair<int> p = x;/);
  assert.match(a, /p\.key == "x" then p\.value else 99/);
  assert.equal(source('different-key'), a.replace('const x := 5;', 'const x = y := 5;').replace('p.key == "x"', 'p.key == "y"'));
});

test('runtime witness differs only by binding spelling and requires one marker', () => {
  assert.equal(source('runtime-expanded'), source('runtime-short').replace('val x := tick();', 'val x = x := tick();'));
  for (const id of ['runtime-short', 'runtime-expanded']) {
    const f = files.get(id);
    assert.equal(f.expected.stdout_marker, 'PAIR_TICK');
    assert.equal(f.expected.stdout_marker_count, 1);
    assert.equal(source(id).split('stdio.out.write("PAIR_TICK");').length - 1, 1);
  }
});
