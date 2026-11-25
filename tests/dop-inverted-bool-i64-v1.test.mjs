// Source-free corpus/provenance checks. NOT a compiler or native guest test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(
  new URL('contracts/dop-inverted-bool-i64-v1/manifest.json', root), 'utf8'));

function gitBlobSha(bytes) {
  return createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0','ascii'))
    .update(bytes).digest('hex');
}

test('typed mixed guest contract keeps every backend NOT_EXECUTED', () => {
  assert.equal(manifest.contract,'attolang.dop.inverted-bool-i64-guest-v1');
  assert.equal(manifest.source_repository,'ores-truffle-oreslang/oreslang-source.llvm');
  assert.equal(manifest.source_pr,1483);
  assert.match(manifest.source_head_at_copy,/^[0-9a-f]{40}$/);
  assert.equal(manifest.host_reference_evidence,'SOURCE_COPY_VERIFIED_ONLY');
  assert.equal(manifest.actual_guest_execution,'NOT_EXECUTED');
  assert.deepEqual(Object.keys(manifest.backend_status).sort(),
    ['dotnet-nativeaot','forge-cranelift','java-graalvm','llvm','wasm']);
  assert.ok(Object.values(manifest.backend_status).every(x => x === 'NOT_EXECUTED'));
});

test('eight canonical .atto source blobs are exact and uniquely identified', () => {
  assert.equal(manifest.cases.length,8);
  const identities = new Set();
  for (const entry of manifest.cases) {
    assert.match(entry.id,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(entry.file,'fixtures/dop-inverted-bool-i64-v1/' + entry.id + '.atto');
    assert.ok(!identities.has(entry.id));
    identities.add(entry.id);
    const bytes = readFileSync(new URL(entry.file,root));
    assert.equal(gitBlobSha(bytes),entry.source_git_blob_sha1);
    assert.match(entry.source_sha256,/^[0-9a-f]{64}$/);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),
                 entry.source_sha256);
    const source = bytes.toString('utf8');
    assert.match(source,/define inverted struct Counter as/);
    assert.match(source,/fnc main\(\): int/);
    assert.match(source,/InvertedArray<Counter>\.with_capacity\(/);
    assert.match(source,/return rows\.get\(/);
    assert.ok(!source.includes('.ores'));
  }
});

test('native positive, signal and negative matrices cannot be promoted from manifest alone', () => {
  assert.deepEqual(manifest.optimization_levels,['-O0','-O2']);
  assert.equal(manifest.expected_native_exit_runs,4);
  assert.equal(manifest.expected_native_signal_runs,2);
  assert.equal(manifest.expected_compile_rejections,5);
  const positives = manifest.cases.filter(x => x.kind === 'native_exit');
  const signals = manifest.cases.filter(x => x.kind === 'native_signal');
  const negatives = manifest.cases.filter(x => x.kind === 'compiler_reject');
  assert.equal(positives.length,2);
  assert.equal(signals.length,1);
  assert.equal(negatives.length,5);
  assert.ok(positives.every(x => x.exit_code === 42 && !('expectation' in x)));
  assert.ok(signals.every(x => x.expectation === 'SIGILL_OR_SIGTRAP'));
  assert.ok(negatives.every(x => typeof x.expectation === 'string' &&
                                   x.expectation.length > 0 &&
                                   !('exit_code' in x)));
  assert.ok(manifest.forbidden_claims.includes('five-backend guest parity'));
  assert.equal(manifest.original_i64_i64_behavior,'UNCHANGED');
});

test('single-byte source tampering defeats both independent digests', () => {
  const entry = manifest.cases.find(x => x.id === 'positive-bool-write');
  const actual = readFileSync(new URL(entry.file,root));
  const tampered = Buffer.from(actual);
  const position = tampered.indexOf(Buffer.from('false'));
  assert.notEqual(position,-1);
  tampered[position] ^= 1;
  assert.notEqual(gitBlobSha(tampered), entry.source_git_blob_sha1);
  assert.notEqual(createHash('sha256').update(tampered).digest('hex'),
                  entry.source_sha256);
});

test('unsupported status changes cannot be mistaken for executed guest receipts', () => {
  assert.deepEqual(manifest.scalar_shape, [
    {name:'active',type:'bool',llvm_lane:'i1'},
    {name:'count',type:'i64',llvm_lane:'i64'}
  ]);
  assert.ok(Object.values(manifest.backend_status).every(
    value => value === 'NOT_EXECUTED'));
  assert.equal(manifest.host_reference_evidence,'SOURCE_COPY_VERIFIED_ONLY');
});

test('bool/int implicit conversions and unsupported f64 remain explicit negatives', () => {
  const indexed = Object.fromEntries(manifest.cases.map(c => [c.id,c]));
  const source = id => readFileSync(new URL(indexed[id].file,root),'utf8');
  assert.match(source('positive-bool-write'),/rows\.push\(false, 11\)/);
  assert.match(source('positive-bool-write'),/rows\.set\(0, active, true\)/);
  assert.match(source('positive-swap-tail'),/rows\.erase_swap\(0\)/);
  assert.match(source('negative-bool-as-int'),/rows\.push\(1, 42\)/);
  assert.match(source('negative-bool-to-int-return'),/return rows\.get\(0, active\)/);
  assert.match(source('negative-immutable-bool-set'),/^\s+active: bool;/m);
  assert.match(source('negative-bool-write-int'),/rows\.set\(0, active, 1\)/);
  assert.match(source('negative-f64-unimplemented'),/let mass: f64;/);
  assert.match(source('negative-bounds-trap'),/return rows\.get\(1, count\)/);
});
