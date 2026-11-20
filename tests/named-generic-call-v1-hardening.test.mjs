import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bind_generic_args, plan_named_call, evaluate_named_call, OMITTED
} from '../lib/named-generic-call-v1.mjs';

const type = (type, name = null) => ({ type, name });
const arg = (name = null) => ({ kind: 'value', name });
const required = name => ({ name });
const optional = name => ({ name, optional: true, checkedDefault: true });
const failsWith = (run, code) => assert.throws(run, { code });

test('generic declarations reject malformed records and unsupported keys', () => {
  const good = [{ name: 'T' }];
  for (const bad of [
    [null], [false], [[]], ['T'], [{ name: 'T', extra: 'shadow' }]
  ]) failsWith(() => bind_generic_args(bad, []), 'invalid-generic-declaration');
  for (const bad of [
    [{ name: 'T', default: { type: 'int', ref: 'T' } }],
    [{ name: 'T', default: [] }],
    [{ name: 'T', default: { type: 42 } }],
    [{ name: 'T', default: { ref: 'T' } }]
  ]) failsWith(() => bind_generic_args(bad, []), 'invalid-generic-default');
  for (const item of [null, 4, [], {}, { type: 'int', value: 'side-effect' },
    { type: 'int', name: 'T', label: 'T' }])
    failsWith(() => bind_generic_args(good, [item]), 'invalid-generic-argument');
  for (const inferred of [null, [], 4, 'T'])
    failsWith(() => bind_generic_args(good, [type('int')], { inferred }),
      'invalid-inferred-generic');
});

test('generic defaults fail closed on unknown and forward references', () => {
  for (const formals of [
    [{ name: 'A', default: { ref: 'Missing' } }],
    [{ name: 'A', default: { ref: 'B' } }, { name: 'B' }],
    [{ name: 'A', default: { ref: 'A' } }]
  ]) failsWith(() => bind_generic_args(formals, []), 'invalid-generic-default');
});

test('generic binding canonicalizes named permutations but preserves source mappings', () => {
  const f = [{ name: 'A' }, { name: 'B' }, { name: 'C', default: { ref: 'B' } }];
  const p = bind_generic_args(f, [type('bool', 'B'), type('int', 'A')]);
  const q = bind_generic_args(f, [type('int'), type('bool', 'B')]);
  assert.equal(p.specializationKey, q.specializationKey);
  assert.deepEqual(p.sourceToFormal, [1, 0]);
  assert.deepEqual(q.sourceToFormal, [0, 1]);
  assert.deepEqual(p.ordered, ['int', 'bool', 'bool']);
  assert.ok(Object.isFrozen(p.ordered));
  assert.ok(Object.isFrozen(p.sourceToFormal));
  for (let i = 0; i < 512; i++) {
    const swap = i % 2 === 0;
    const actual = swap ? [type('bool', 'B'), type('int', 'A')] :
      [type('int', 'A'), type('bool', 'B')];
    assert.equal(bind_generic_args(f, actual).specializationKey, p.specializationKey);
  }
});

test('value formals require a checked omission default, not an optional-looking flag', () => {
  const failures = [
    [required('x'), { name: 'middle', optional: true }],
    [required('x'), { name: 'middle', optional: true, checkedDefault: false }],
    [required('x'), { name: 'middle', optional: false, checkedDefault: true }]
  ];
  for (const formals of failures)
    failsWith(() => plan_named_call(formals, [arg('x')]), 'unchecked-optional-default');
  const plan = plan_named_call([required('x'), optional('middle')], [arg('x')]);
  assert.deepEqual(evaluate_named_call(plan, [() => 9]), [9, OMITTED]);
  failsWith(() => plan_named_call([required('x'), required('middle')], [arg('x')]),
    'missing-required-value');
});

test('malformed value descriptors and extra fields never become argument slots', () => {
  const f = [required('x')];
  for (const item of [
    null, 4, [], {}, { name: 'x' }, { kind: 'omit', name: 'x' },
    { kind: 'value', name: 'x', expr: () => 8 },
    { kind: 'value', name: 'x', spread: false },
    { kind: 'value', name: 'x', assign: false },
    { kind: 'value', name: 'x', value: 8 }
  ]) failsWith(() => plan_named_call(f, [item]), 'unsupported-call-item');
  for (const formals of [
    [null], [false], [[]], [{ name: 'x', optional: 'true' }],
    [{ name: 'x', other: 'y' }]
  ]) failsWith(() => plan_named_call(formals, []), 'invalid-callable-formals');
});

test('forged but internally consistent permutations cannot evaluate receiver or thunks', () => {
  const legitimate = plan_named_call([required('a'), required('b')], [arg('b'), arg('a')]);
  const forged = [
    { slotToSource: [0, 1], sourceToFormal: [0, 1] },
    { slotToSource: [1, 0], sourceToFormal: [1, 0] },
    { slotToSource: [...legitimate.slotToSource], sourceToFormal: [...legitimate.sourceToFormal] },
    Object.assign(Object.create(null), legitimate)
  ];
  const trace = [];
  for (const plan of forged) {
    failsWith(() => evaluate_named_call(plan,
      [() => trace.push('first'), () => trace.push('second')],
      () => trace.push('receiver')), 'invalid-execution-plan');
    assert.deepEqual(trace, []);
  }
  assert.deepEqual(evaluate_named_call(legitimate, [() => 2, () => 1]), [1, 2]);
  assert.ok(Object.isFrozen(legitimate));
  assert.ok(Object.isFrozen(legitimate.slotToSource));
});

test('receiver and argument failures preserve lexical evaluation and abort remaining work', () => {
  const plan = plan_named_call([required('a'), required('b'), optional('c')],
    [arg('b'), arg('a')]);
  const trace = [];
  const boom = new Error('boom');
  assert.throws(() => evaluate_named_call(plan, [
    () => { trace.push('b'); throw boom; },
    () => { trace.push('a'); return 1; }
  ], () => trace.push('receiver')), error => error === boom);
  assert.deepEqual(trace, ['receiver', 'b']);
  trace.length = 0;
  assert.throws(() => evaluate_named_call(plan, [
    () => { trace.push('b'); return 2; },
    () => { trace.push('a'); return 1; }
  ], () => { trace.push('receiver'); throw boom; }), error => error === boom);
  assert.deepEqual(trace, ['receiver']);
  trace.length = 0;
  const out = evaluate_named_call(plan, [
    () => { trace.push('b'); return 2; },
    () => { trace.push('a'); return 1; }
  ], () => trace.push('receiver'));
  assert.deepEqual(trace, ['receiver', 'b', 'a']);
  assert.deepEqual(out, [1, 2, OMITTED]);
});

test('value labels are case-sensitive and cannot rescue missing or duplicate slots', () => {
  const f = [required('First'), required('second')];
  failsWith(() => plan_named_call(f, [arg('first'), arg('second')]), 'unknown-value-label');
  failsWith(() => plan_named_call(f, [arg(), arg('First')]), 'duplicate-value-slot');
  failsWith(() => plan_named_call(f, [arg('First'), arg()]), 'value-positional-after-named');
  const plan = plan_named_call(f, [arg('second'), arg('First')]);
  assert.deepEqual(plan.slotToSource, [1, 0]);
});

test('accessor-backed, hidden, symbol and sparse descriptors fail before getter effects', () => {
  let getterCalls = 0;
  const accessor = (key, fields = {}) => {
    const object = { ...fields };
    Object.defineProperty(object, key, {
      enumerable: true,
      get() { getterCalls++; return key === 'type' ? 'int' : 'T'; }
    });
    return object;
  };
  failsWith(() => bind_generic_args([accessor('name')], []),
    'invalid-generic-declaration');
  failsWith(() => bind_generic_args([{ name: 'T' }], [
    accessor('type', { name: 'T' })
  ]), 'invalid-generic-argument');
  failsWith(() => bind_generic_args([{ name: 'T' }], [], {
    inferred: accessor('T')
  }), 'invalid-inferred-generic');
  failsWith(() => plan_named_call([accessor('name')], []),
    'invalid-callable-formals');
  failsWith(() => plan_named_call([required('T')], [
    accessor('name', { kind: 'value' })
  ]), 'unsupported-call-item');
  assert.equal(getterCalls, 0);

  const nonEnumerable = { type: 'int' };
  Object.defineProperty(nonEnumerable, 'hidden', { value: 1 });
  failsWith(() => bind_generic_args([{ name: 'T' }], [nonEnumerable]),
    'invalid-generic-argument');

  const symbolKeyed = { kind: 'value', name: 'T' };
  symbolKeyed[Symbol('hidden')] = true;
  failsWith(() => plan_named_call([required('T')], [symbolKeyed]),
    'unsupported-call-item');

  failsWith(() => bind_generic_args(new Array(1), []),
    'invalid-generic-declaration');
  failsWith(() => plan_named_call(new Array(1), []),
    'invalid-callable-formals');
  failsWith(() => bind_generic_args([{ name: 'T' }], [type('int')], {
    metadataKeys: new Array(1)
  }), 'invalid-metadata-schema');
});
