import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlobSha, validateContract } from '../bin/full-aot-execution-model.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, 'contracts/full-aot-executable-gates-v1.json'), 'utf8'));
const clone = () => structuredClone(manifest);

test('nine source-only full-AOT fixture cases are pinned by Git blob SHA', () => {
  const cases = validateContract(manifest);
  assert.equal(cases.length, 9);
  for (const c of cases) {
    const bytes = readFileSync(resolve(root, c.fixture));
    assert.equal(gitBlobSha(bytes), c.git_blob_sha, c.id + ': expected Git blob hash mismatch');
  }
});

test('all six backends remain explicitly unexecuted', () => {
  assert.deepEqual(Object.keys(manifest.profiles).sort(),
    ['forge-native', 'graal-native-image', 'llvm-native',
     'net-native', 'rust-source-wasm', 'wasm-precompiled'].sort());
  assert.ok(Object.values(manifest.profiles).every(p => p.status === 'not_executed'));
});

test('source-only status cannot be forged into a guest pass', () => {
  for (const mutation of [
    m => { m.status = 'PASSED_ALL_BACKENDS'; },
    m => { m.profiles['llvm-native'].status = 'passed'; },
    m => { m.cases[0].status = 'passed'; },
    m => { m.profiles['rust-source-wasm'].full_native_aot = true; },
    m => { m.profiles['wasm-precompiled'].runtime_engine_jit = 'allowed'; },
  ]) {
    const altered = clone();
    mutation(altered);
    assert.throws(() => validateContract(altered));
  }
});

test('rejects duplicate, unpinned, dangerous and mislabeled cases', () => {
  for (const mutation of [
    m => { m.cases[1].id = m.cases[0].id; },
    m => { m.cases[1].fixture = m.cases[0].fixture; },
    m => { m.cases[0].git_blob_sha = '0'.repeat(39); },
    m => { m.cases[0].fixture = 'fixtures/../../stolen.atto'; },
    m => { m.cases[0].must_have_zero_imports = false; },
    m => { m.cases[0].expected_main_i64 = '9223372036854775808'; },
    m => { m.cases[4].kind = 'compiled_guest'; },
    m => { delete m.required_evidence; },
  ]) {
    const altered = clone();
    mutation(altered);
    assert.throws(() => validateContract(altered));
  }
});

test('executor refuses unpinned invocation and cannot fake a pass', () => {
  const result = spawnSync(process.execPath,
    [resolve(root, 'bin/run-full-aot-executable-gates.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /all required|are all required|required/i);
  assert.doesNotMatch(result.stdout, /"result"\s*:\s*"passed"/);
});

test('executor refuses unsupported native AOT adapter before claiming success', () => {
  const sha = 'a'.repeat(40);
  const result = spawnSync(process.execPath,
    [resolve(root, 'bin/run-full-aot-executable-gates.mjs'),
      '--profile', 'llvm-native',
      '--attoc', '/tmp/attoc-does-not-exist',
      '--source-repo', '/tmp/atto-source-not-present',
      '--checkout-head', sha,
      '--source-head', sha,
      '--source-tree', sha,
      '--receipt', '/tmp/atto-no-proof.json'],
    { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no executable adapter yet/i);
  assert.doesNotMatch(result.stdout, /passed/i);
});
