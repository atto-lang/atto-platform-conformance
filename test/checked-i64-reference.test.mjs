// Mathematical oracle for the candidate checked-i64 contract. Source-free.
// This tests fixture semantics; it does not execute any backend/compiler.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'fixtures/checked-i64-v1.json'), 'utf8'));
const MIN = -(1n << 63n);
const MAX = (1n << 63n) - 1n;
const OPERATIONS = new Set(['literal', 'add', 'sub', 'mul', 'neg', 'rem', 'div_trunc']);
const err = (category, phase) => ({ category, phase });

function checked(n) {
  if (n < MIN || n > MAX) throw err('integer_overflow', 'runtime');
  return n;
}

function calculate(expr) {
  assert.ok(expr && typeof expr === 'object' && !Array.isArray(expr));
  assert.ok(OPERATIONS.has(expr.op), 'unknown arithmetic operation');
  if (expr.op === 'literal') {
    assert.equal(typeof expr.value, 'string');
    assert.match(expr.value, /^-?(?:0|[1-9][0-9]*)$/);
    const value = BigInt(expr.value);
    if (value < MIN || value > MAX) throw err('integer_overflow', 'compile');
    return value;
  }
  assert.ok(Array.isArray(expr.args));
  const required = expr.op === 'neg' ? 1 : 2;
  assert.equal(expr.args.length, required);
  const args = expr.args.map(calculate);
  if (expr.op === 'neg') return checked(-args[0]);
  if (expr.op === 'add') return checked(args[0] + args[1]);
  if (expr.op === 'sub') return checked(args[0] - args[1]);
  if (expr.op === 'mul') return checked(args[0] * args[1]);
  if (args[1] === 0n) throw err('division_by_zero', 'runtime');
  if (expr.op === 'rem') return checked(args[0] % args[1]);
  return checked(args[0] / args[1]); // BigInt divides toward zero.
}

function checkCase(item) {
  assert.ok(item && typeof item.id === 'string' && /^[a-z0-9-]+$/.test(item.id));
  assert.ok(item.expected && typeof item.expected === 'object');
  let result;
  try {
    result = { kind: 'value', decimal: calculate(item.expr).toString() };
  } catch (failure) {
    if (!failure || typeof failure.category !== 'string') throw failure;
    result = { kind: 'error', category: failure.category, phase: failure.phase };
  }
  assert.deepEqual(item.expected, result, `${item.id}: fixture diverges from signed-i64 reference`);
}

test('checked-i64 contract remains candidate/unattested; fixture identities are unique', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.contract, 'checked-i64-v1');
  assert.equal(manifest.status, 'candidate-unattested');
  assert.ok(Array.isArray(manifest.cases) && manifest.cases.length >= 43);
  assert.equal(new Set(manifest.cases.map(c => c.id)).size, manifest.cases.length);
  assert.deepEqual(new Set(manifest.cases.map(c => c.expr.op)), OPERATIONS);
});

for (const fixture of manifest.cases) {
  test(`mathematical reference: ${fixture.id}`, () => {
    checkCase(fixture);
    if (fixture.expr.op === 'div_trunc') {
      assert.equal(fixture.guestSource, undefined, 'stage-0 source mapping is unratified');
    } else {
      assert.equal(typeof fixture.guestSource, 'string');
      assert.ok(fixture.guestSource.length > 0 && Buffer.byteLength(fixture.guestSource) < 1024 * 1024);
    }
  });
}

test('mutation: overflow cannot be silently accepted as wrapped i64', () => {
  const original = manifest.cases.find(c => c.id === 'add-max-one');
  assert.ok(original);
  const mutated = structuredClone(original);
  mutated.expected = { kind: 'value', decimal: '-9223372036854775808' };
  assert.throws(() => checkCase(mutated), assert.AssertionError);
});

test('mutation: division toward zero is not floor division', () => {
  assert.equal(calculate({op: 'div_trunc', args: [{op: 'literal', value: '-7'}, {op: 'literal', value: '3'}]}), -2n);
});

test('mutation: signed remainder has sign of dividend', () => {
  assert.equal(calculate({op: 'rem', args: [{op: 'literal', value: '-7'}, {op: 'literal', value: '3'}]}), -1n);
});

test('mutation: min-int remainder by negative one is zero', () => {
  assert.equal(calculate({op: 'rem', args: [{op: 'literal', value: MIN.toString()}, {op: 'literal', value: '-1'}]}), 0n);
});

test('mutation: min-int truncated division by negative one overflows', () => {
  assert.throws(() => calculate({op: 'div_trunc', args: [{op: 'literal', value: MIN.toString()}, {op: 'literal', value: '-1'}]}), x => x.category === 'integer_overflow' && x.phase === 'runtime');
});

test('mutation: zero divisor cannot return an ordinary value', () => {
  assert.throws(() => calculate({op: 'rem', args: [{op: 'literal', value: '0'}, {op: 'literal', value: '0'}]}), x => x.category === 'division_by_zero');
});

test('mutation: unsupported arithmetic operator is not admitted', () => {
  assert.throws(() => calculate({op: 'shift', args: []}), assert.AssertionError);
});
