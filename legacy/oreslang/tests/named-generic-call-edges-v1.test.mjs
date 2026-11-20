import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bind_generic_args, plan_named_call, evaluate_named_call, OMITTED
} from '../lib/named-generic-call-v1.mjs';

// This suite validates only the independent source-free binding oracle and
// verifies authored .atto target fixtures. It is not compiler/guest parity.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = ['foo', 'bar', 'T', 'Last'];
const types = ['string', 'int', 'bool', 'float'];
const canonical = { declarationIdentity: 'pkg/v1:Named#public:g0' };
const allPermutations = xs => xs.length === 0
  ? [[]]
  : xs.flatMap((x, i) => allPermutations(
      xs.filter((_, j) => j !== i)).map(rest => [x, ...rest]));

test('all 24 four-slot named generic permutations bind to identical declaration identity', () => {
  const formals = names.map(name => ({ name }));
  const permutations = allPermutations([0, 1, 2, 3]);
  assert.equal(permutations.length, 24);
  const keys = new Set();
  for (const permutation of permutations) {
    const actuals = permutation.map(i => ({ name: names[i], type: types[i] }));
    const resolved = bind_generic_args(formals, actuals, canonical);
    assert.deepEqual(resolved.ordered, types);
    assert.deepEqual(resolved.sourceToFormal, permutation);
    keys.add(resolved.specializationKey);
  }
  assert.equal(keys.size, 1);
});

test('all 24 four-slot runtime call permutations preserve lexical effects and formal ABI', () => {
  const formal = names.map(name => ({ name, optional: false }));
  for (const permutation of allPermutations([0, 1, 2, 3])) {
    const plan = plan_named_call(formal,
      permutation.map(i => ({ name: names[i] })));
    assert.deepEqual(plan.sourceToFormal, permutation);
    const seen = [];
    const argumentsInSourceOrder = permutation.map(i => () => {
      seen.push(names[i]);
      return types[i];
    });
    const actual = evaluate_named_call(plan, argumentsInSourceOrder,
      () => seen.push('receiver'));
    assert.deepEqual(seen, ['receiver', ...permutation.map(i => names[i])]);
    assert.deepEqual(actual, types);
  }
});

test('omittable middle slot stays omitted without reindexing other named slots', () => {
  const formal = [
    { name: 'first' },
    { name: 'middle', optional: true },
    { name: 'last' }
  ];
  const plan = plan_named_call(formal, [{ name: 'last' }, { name: 'first' }]);
  assert.deepEqual(plan.slotToSource, [1, -1, 0]);
  const output = evaluate_named_call(plan, [() => 42, () => 7]);
  assert.deepEqual([output[0], output[2]], [7, 42]);
  assert.strictEqual(output[1], OMITTED);

  const supplied = plan_named_call(formal, [
    { name: 'last' }, { name: 'middle' }, { name: 'first' }
  ]);
  assert.strictEqual(
    evaluate_named_call(supplied, [() => 42, () => null, () => 7])[1], null);
});

test('case-sensitive labels, source ordering and positional collisions reject', () => {
  const generic = [{ name: 'foo' }, { name: 'bar' }];
  const callable = generic.map(x => ({ name: x.name }));
  const invalidTypes = [
    [{ type: 'int', name: 'Foo' }],
    [{ type: 'int' }, { type: 'string', name: 'foo' }],
    [{ type: 'int', name: 'bar' }, { type: 'string' }],
    [{ type: 'int', name: 'foo' }, { type: 'string', name: 'foo' }]
  ];
  for (const actual of invalidTypes) {
    assert.throws(() => bind_generic_args(generic, actual, canonical));
  }
  const invalidValues = [
    [{ name: 'Foo' }],
    [{ name: null }, { name: 'foo' }],
    [{ name: 'bar' }, { name: null }],
    [{ name: 'foo' }, { name: 'foo' }]
  ];
  for (const actual of invalidValues) {
    assert.throws(() => plan_named_call(callable, actual));
  }
});

test('new target fixtures pin explicit edge semantics but remain unexecuted', async () => {
  const manifest = JSON.parse(await readFile(
    resolve(root, 'contracts/named-generic-call-v1.json'), 'utf8'));
  const cases = new Map(manifest.cases.map(c => [c.id, c]));
  const expected = new Map([
    ['generic-inference-hole', 'accept'],
    ['generic-hole-missing', 'reject'],
    ['generic-nested-hole', 'reject'],
    ['generic-type-case-mismatch', 'reject'],
    ['generic-nongeneric-explicit-type', 'reject'],
    ['generic-positional-collision', 'reject'],
    ['generic-duplicate-declaration', 'reject'],
    ['generic-self-default', 'reject'],
    ['generic-routine-named', 'accept'],
    ['generic-method-named', 'accept'],
    ['generic-caller-scoped-type', 'accept'],
    ['value-routine-reorder', 'accept'],
    ['value-optional-omission', 'accept'],
    ['value-option-required', 'reject'],
    ['value-method-unknown', 'reject'],
    ['value-static-named', 'accept'],
    ['value-overload-label-only', 'reject'],
    ['value-opaque-named', 'reject']
  ]);
  assert.ok(manifest.cases.length >= 40 && manifest.cases.length <= 64);
  for (const [id, kind] of expected) {
    const item = cases.get(id);
    assert.ok(item, 'missing ' + id);
    assert.equal(item.compile, kind);
    assert.equal(item.path, 'fixtures/named-generic-call-v1/' + id + '.atto');
    assert.deepEqual(item.status, {
      java: 'pending', llvm: 'pending', net: 'pending', wasm: 'pending',
      forge: 'pending'
    });
    if (kind === 'reject') assert.match(item.diagnostic, /^[a-z-]+$/);
    const source = await readFile(resolve(root, item.path), 'utf8');
    assert.ok(source.includes('fnc') || source.includes('routine'));
  }
  assert.match(await readFile(
    resolve(root, 'fixtures/named-generic-call-v1/generic-caller-scoped-type.atto'),
    'utf8'), /choose<foo=string,bar=T>/);
  assert.match(await readFile(
    resolve(root, 'fixtures/named-generic-call-v1/generic-nested-hole.atto'),
    'utf8'), /Array<_>/);
});
