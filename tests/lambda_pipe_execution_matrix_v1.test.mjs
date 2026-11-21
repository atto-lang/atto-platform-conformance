// Structural contract only: NEVER count this as executable backend conformance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const matrix = JSON.parse(readFileSync(
  new URL('../fixtures/lambda-mandatory-pipes-v1/execution-matrix.json', import.meta.url), 'utf8'
));
const targets = ['atto','cranelift','forge','hdl','java','js','llvm','net','realtime','rs','wasm'];

test('all Atto backends are represented without invented execution evidence', () => {
  assert.equal(matrix.schema_version, 1);
  assert.equal(matrix.id, 'lambda-executable-parity-v1');
  assert.equal(matrix.status, 'TARGET_NOT_EXECUTED');
  assert.deepEqual(Object.keys(matrix.backend_status).sort(), targets);
  assert.ok(Object.values(matrix.backend_status).every(s => s === 'NOT_EXECUTED'));
  assert.match(matrix.scope, /not parser-only evidence/);
  assert.match(matrix.requirements.run, /actual source/);
  assert.match(matrix.requirements.reject, /without creating executable artifact/);
  assert.match(matrix.requirements.provenance, /compiler artifact SHA-256/);
  assert.match(matrix.requirements.unavailable, /UNSUPPORTED/);
});

test('bounded canonical lambda fixtures enforce arity, typed forms and fail-closed lowering', () => {
  const cases = matrix.cases;
  assert.equal(cases.length, 14);
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
  assert.equal(cases.filter(c => c.kind === 'run').length, 6);
  assert.equal(cases.filter(c => c.kind === 'reject').length, 8);
  assert.deepEqual(cases.filter(c => c.kind === 'run').map(c => c.exit_code),
    [5, 5, 5, 42, 42, 5]);
  assert.deepEqual(cases.filter(c => c.kind === 'reject').map(c => c.error_family),
    ['E_SYNTAX','E_SYNTAX','E_ARITY','E_ARITY','E_INFER','E_CONST',
     'E_SYNTAX','E_SYNTAX']);

  for (const c of cases) {
    assert.ok(/^[a-z0-9-]+$/.test(c.id), c.id);
    assert.ok(c.source.endsWith('\n') && c.source.includes('fnc main()'), c.id);
    assert.ok(typeof c.meaning === 'string' && c.meaning.length > 12, c.id);
    assert.ok(!/eval\s*\(|new Function|globalThis/.test(c.source), c.id);
    if (c.kind === 'run') {
      assert.ok(Number.isInteger(c.exit_code) && c.exit_code >= 0, c.id);
      assert.equal(Object.hasOwn(c, 'error_family'), false, c.id);
    } else {
      assert.match(c.error_family, /^E_[A-Z_]+$/, c.id);
      assert.equal(Object.hasOwn(c, 'exit_code'), false, c.id);
    }
  }
  const byId = Object.fromEntries(cases.map(c => [c.id, c]));
  assert.match(byId['local-const-discard-i64'].source, /const fnc v = \|_\| : int -> 5; return v\(41\)/);
  assert.match(byId['local-const-zero'].source, /const fnc v = \|\| : int -> 5; return v\(\)/);
  assert.match(byId['local-type-first'].source, /\|int x\| : int -> x \+ 1/);
  assert.match(byId['local-name-first'].source, /\|x: int\| : int -> x \+ 1/);
  assert.match(byId['module-typed-discard'].source, /^const fnc v = \|int _\|/);
  assert.match(byId['missing-pipes-discard'].source, /const fnc v = _ : int -> 5/);
  assert.match(byId['module-abi-untyped'].source, /^const fnc v = \\|_\\|/);
  assert.match(byId['anonymous-fnc-unpiped'].source, /val v = fnc\\(int x\\) -> x \\+ 1/);
  assert.match(byId['parenthesized-lambda-unpiped'].source, /val v = \\(int x\\) -> x \\+ 1/);
});
