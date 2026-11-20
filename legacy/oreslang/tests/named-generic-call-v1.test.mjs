import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bind_generic_args, plan_named_call, evaluate_named_call, OMITTED } from '../lib/named-generic-call-v1.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backends = ['java', 'llvm', 'net', 'wasm', 'forge'];
const formal = (name, optional = false) => ({ name, optional, ...(optional ? { checkedDefault: true } : {}) });
const typ = (type, name = null) => ({ type, name });
const value = (name = null) => ({ kind: 'value', name });

test('registry is bounded, unique, source-only, .atto and not a parity claim', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'contracts/named-generic-call-v1.json')));
  assert.equal(manifest.id, 'named-generic-call-v1');
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.backends, backends);
  assert.equal(manifest.evidence, 'source-target-only');
  assert.ok(manifest.cases.length >= 18 && manifest.cases.length <= 64);
  const ids = new Set();
  let accepts = 0, rejects = 0;
  for (const entry of manifest.cases) {
    assert.match(entry.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(entry.id), 'duplicate ' + entry.id);
    ids.add(entry.id);
    assert.equal(entry.path, 'fixtures/named-generic-call-v1/' + entry.id + '.atto');
    const pathname = resolve(root, entry.path);
    assert.ok(pathname.startsWith(root + sep));
    assert.equal(await realpath(pathname), pathname, 'no symlinked fixtures');
    const source = await readFile(pathname, 'utf8');
    assert.ok(source.length > 15 && source.length < 10000);
    assert.match(source, /\b(?:fnc|class|main)\b/);
    assert.deepEqual(entry.status, Object.fromEntries(backends.map(b => [b, 'pending'])));
    assert.ok(['generic', 'value', 'combined', 'shape'].includes(entry.category));
    if (entry.compile === 'accept') accepts++;
    else {
      rejects++;
      assert.equal(entry.compile, 'reject');
      assert.match(entry.diagnostic, /^[a-z-]+$/);
    }
  }
  assert.ok(accepts >= 8 && rejects >= 8);
});

test('named generic source permutations have identical ordered specialization identity', () => {
  const formals = [{ name: 'T' }, { name: 'Alloc', default: { type: 'Heap' } }];
  const p = bind_generic_args(formals, [typ('Pool', 'Alloc'), typ('int', 'T')]);
  const q = bind_generic_args(formals, [typ('int'), typ('Pool', 'Alloc')]);
  assert.deepEqual(p.ordered, ['int', 'Pool']);
  assert.deepEqual(p.sourceToFormal, [1, 0]);
  assert.equal(p.specializationKey, q.specializationKey);
  assert.deepEqual(bind_generic_args(formals, [typ('int')]).ordered, ['int', 'Heap']);
});

test('named generic defaults reference earlier parameters after explicit binding', () => {
  const f = [{ name: 'A', default: { type: 'int' } },
    { name: 'B', default: { ref: 'A' } },
    { name: 'C', default: { ref: 'B' } }];
  assert.deepEqual(bind_generic_args(f, [typ('bool', 'B')]).ordered,
    ['int', 'bool', 'bool']);
  assert.deepEqual(bind_generic_args(f, [], { inferred: { A: 'float' } }).ordered,
    ['float', 'float', 'float']);
});

test('generic negative matrix rejects ambiguity, schema overlap, inference conflicts and cycles', () => {
  const f = [{ name: 'T' }, { name: 'U', default: { ref: 'T' } }];
  const invalid = [
    [() => bind_generic_args(f, [typ('int', 'bad')]), 'unknown-generic-label'],
    [() => bind_generic_args(f, [typ('int'), typ('bool', 'T')]), 'duplicate-generic-slot'],
    [() => bind_generic_args(f, [typ('int', 'T'), typ('bool')]), 'generic-positional-after-named'],
    [() => bind_generic_args(f, []), 'missing-generic-argument'],
    [() => bind_generic_args(f, [typ('int', 'T'), typ('string', 'T')]), 'duplicate-generic-slot'],
    [() => bind_generic_args(f, [typ('int', 'T')], { inferred: { T: 'float' } }), 'generic-inference-conflict'],
    [() => bind_generic_args(f, [typ('int', 'T')], { metadataKeys: ['T'] }), 'generic-metadata-collision'],
    [() => bind_generic_args([{ name: 'A', default: { ref: 'B' } }, { name: 'B' }], []), 'invalid-generic-default'],
    [() => bind_generic_args([{ name: 'A', default: { ref: 'A' } }], []), 'invalid-generic-default'],
    [() => bind_generic_args([{ name: 'A' }, { name: 'A' }], []), 'invalid-generic-declaration'],
    [() => bind_generic_args(f, [typ('int'), typ('bool'), typ('float')]), 'excess-generic-arguments']
  ];
  for (const [run, code] of invalid) assert.throws(run, { code });
});

test('value-call lexical evaluation is exactly once, receiver first, ABI reordered', () => {
  const plan = plan_named_call([formal('first'), formal('second')],
    [value('second'), value('first')]);
  assert.deepEqual(plan.sourceToFormal, [1, 0]);
  const trace = [];
  const slots = evaluate_named_call(plan, [
    () => { trace.push('second'); return 2; },
    () => { trace.push('first'); return 1; }
  ], () => trace.push('receiver'));
  assert.deepEqual(trace, ['receiver', 'second', 'first']);
  assert.deepEqual(slots, [1, 2]);
});

test('value-call optional omission is distinct from an explicit None-like value', () => {
  const formals = [formal('first'), formal('middle', true), formal('last')];
  const plan = plan_named_call(formals, [value('last'), value('first')]);
  assert.deepEqual(plan.slotToSource, [1, -1, 0]);
  const slots = evaluate_named_call(plan, [() => 3, () => 1]);
  assert.equal(slots[0], 1);
  assert.strictEqual(slots[1], OMITTED);
  assert.equal(slots[2], 3);
  const explicit = evaluate_named_call(plan_named_call(formals,
    [value(), value(), value()]), [() => 1, () => null, () => 3]);
  assert.strictEqual(explicit[1], null);
  assert.notStrictEqual(explicit[1], OMITTED);
});

test('value-call negative matrix rejects collision, unknown, omission and unsupported spread', () => {
  const f = [formal('first'), formal('second')];
  const invalid = [
    [() => plan_named_call(f, [value('bogus'), value('first')]), 'unknown-value-label'],
    [() => plan_named_call(f, [value('first'), value('first')]), 'duplicate-value-slot'],
    [() => plan_named_call(f, [value(), value('first')]), 'duplicate-value-slot'],
    [() => plan_named_call(f, [value('second'), value()]), 'value-positional-after-named'],
    [() => plan_named_call(f, [value('second')]), 'missing-required-value'],
    [() => plan_named_call(f, [value(), value(), value()]), 'excess-value-arguments'],
    [() => plan_named_call(f, [{ name: 'first', spread: true }]), 'unsupported-call-item'],
    [() => plan_named_call(f, [{ name: 'first', assign: true }]), 'unsupported-call-item'],
    [() => plan_named_call([formal('x'), formal('x')], [value('x')]), 'invalid-callable-formals']
  ];
  for (const [run, code] of invalid) assert.throws(run, { code });
});

test('forged or inconsistent call plans fail before any observable effects', () => {
  const trace = [];
  const bad = [
    { sourceToFormal: [0], slotToSource: [0, 0] },
    { sourceToFormal: [0, 0], slotToSource: [1] },
    { sourceToFormal: [2], slotToSource: [0] },
    { sourceToFormal: [0], slotToSource: [-1] }
  ];
  for (const plan of bad) {
    assert.throws(() => evaluate_named_call(plan, [() => trace.push('actual')],
      () => trace.push('receiver')), { code: 'invalid-execution-plan' });
    assert.deepEqual(trace, []);
  }
});

test('invalid bindings cannot evaluate expressions', () => {
  let invoked = 0;
  assert.throws(() => plan_named_call([formal('a')], [value('missing')]),
    { code: 'unknown-value-label' });
  assert.equal(invoked, 0);
  const plan = plan_named_call([formal('a')], [value('a')]);
  assert.deepEqual(evaluate_named_call(plan, [() => ++invoked]), [1]);
  assert.equal(invoked, 1);
});
