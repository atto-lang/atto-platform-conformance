import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const folder = 'fixtures/flexible-callable-headers-v1/';
const manifest = JSON.parse(readFileSync(new URL(folder + 'manifest.json', root)));
const backends = ['atto', 'cranelift', 'forge', 'hdl', 'java', 'js', 'llvm', 'net', 'realtime', 'rs', 'wasm'];
const positive = ['adjacent-braces', 'after-begin', 'after-brace', 'after-implicit', 'before-begin', 'before-brace', 'comments-after-result', 'comments-before-brace', 'nested-statement'];
const negative = ['before-implicit', 'body-clause', 'duplicate-budget', 'duplicate-budget-key', 'duplicate-effects', 'duplicate-key', 'duplicate-return', 'fallthrough', 'late-clause', 'missing-end', 'missing-outer-end', 'missing-return', 'same-line-implicit', 'trailing-clause-throws', 'trailing-colon', 'unclosed-map'];
function validate(m) {
  assert.equal(m.schema, 'atto.flexible-callable-headers.v1');
  assert.deepEqual(Object.keys(m.backend_status).sort(), backends);
  assert.ok(Object.values(m.backend_status).every(s => s === 'NOT_EXECUTED'));
  assert.equal(m.status, 'NOT_EXECUTED');
  assert.deepEqual(m.cases.filter(c => c.kind === 'pass').map(c => c.id).sort(), positive);
  assert.deepEqual(m.cases.filter(c => c.kind === 'fail').map(c => c.id).sort(), negative);
  assert.equal(m.cases.length, 25);
  assert.equal(new Set(m.cases.map(c => c.git_blob_sha)).size, 25);
  const disk = readdirSync(new URL(folder, root)).filter(f => f.endsWith('.atto')).sort();
  assert.deepEqual(disk, m.cases.map(c => c.id + '.atto').sort());
  for (const c of m.cases) {
    assert.equal(c.path, folder + c.id + '.atto');
    assert.match(c.git_blob_sha, /^[0-9a-f]{40}$/);
    const bytes = readFileSync(new URL(c.path, root));
    const actual = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    assert.equal(actual, c.git_blob_sha, c.id);
    const src = bytes.toString('utf8');
    if (c.kind === 'pass') {
      assert.equal(c.gate, 'EXECUTE_COMPILED_GUEST');
      assert.equal(c.expected_exit, 42);
      assert.ok(src.includes('effects { allocate: 0, suspend: false }'));
      assert.ok(src.includes('budget { stack: 4096, operations: 10000 }'));
      assert.ok(src.includes('return x;'));
      assert.ok(src.includes('return checked_identity(42);'));
    } else {
      assert.equal(c.gate, 'NO_ARTIFACT_DIAGNOSTIC');
      assert.ok(c.reason);
      assert.equal(c.expected_exit, undefined);
    }
  }
}
test('exact source corpus and complete NOT_EXECUTED matrix (not guest evidence)', () => validate(manifest));
test('deny fabricated pass, missing backend, changed blob and missing case', () => {
  for (const mutate of [
    m => { m.backend_status.rs = 'PASS'; },
    m => { delete m.backend_status.realtime; },
    m => { m.cases[0].git_blob_sha = '0'.repeat(40); },
    m => { m.cases.pop(); },
    m => { m.cases[0].expected_exit = 0; },
    m => { m.cases[0].path = '../other.atto'; },
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.throws(() => validate(copy));
  }
});
