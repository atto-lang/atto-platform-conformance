import test from 'node:test';
import assert from 'node:assert/strict';

// Reference-only semantic model: no Oreslang parser, compiler, or runtime is executed.
function shape(kind, members) {
  assert.ok(kind === 'struct' || kind === 'record');
  assert.ok(members.length <= 64);
  const keys = new Set();
  for (const [name, type] of members) {
    assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/);
    assert.ok(['int', 'bool', 'string'].includes(type), 'unsupported field type: ' + type);
    assert.ok(!keys.has(name), 'duplicate field: ' + name);
    keys.add(name);
  }
  const sorted = [...members].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return Object.freeze({kind, members: sorted});
}
function sameType(a, b) {
  return a.kind === b.kind && JSON.stringify(a.members) === JSON.stringify(b.members);
}
function construct(declared, entries) {
  assert.equal(declared.kind, 'struct', 'record alias cannot be constructed with T{...}');
  const keys = declared.members.map(([name]) => name);
  const seen = new Set();
  // Check all field names before evaluation. Invalid programs never run thunks.
  for (const [name] of entries) {
    assert.ok(keys.includes(name), 'unknown field ' + name);
    assert.ok(!seen.has(name), 'duplicate field ' + name);
    seen.add(name);
  }
  assert.equal(seen.size, keys.length, 'missing exact struct field');
  const result = new Map();
  for (const [name, thunk] of entries) result.set(name, thunk());
  return {kind: declared.kind, orderedFields: keys.map(key => [key, result.get(key)])};
}

test('exact struct and readonly record have different type identities', () => {
  const a = shape('struct', [['foo','int'], ['bar','bool']]);
  const a2 = shape('struct', [['bar','bool'], ['foo','int']]);
  const b = shape('record', [['foo','int'], ['bar','bool']]);
  assert.ok(sameType(a, a2));
  assert.ok(!sameType(a, b));
  assert.ok(!sameType(b, a));
  assert.ok(!sameType(shape('struct', [['foo','bool']]), shape('struct', [['foo','int']])));
});

test('local prologue aliases do not generate nominal identity or leak scope', () => {
  const first = new Map([['T', shape('struct', [['foo','int']])]]);
  const second = new Map([['T', shape('record', [['foo','int']])]]);
  assert.ok(!sameType(first.get('T'), second.get('T')));
  assert.equal(new Map().get('T'), undefined);
  assert.ok(sameType(first.get('T'), shape('struct', [['foo','int']])));
});

test('named initializer effects are once and in source order, not layout order', () => {
  const trace = [];
  const target = shape('struct', [['foo','int'], ['bar','int']]);
  const built = construct(target, [
    ['foo', () => {trace.push('foo'); return 1;}],
    ['bar', () => {trace.push('bar'); return 2;}],
  ]);
  assert.deepEqual(trace, ['foo','bar']);
  assert.deepEqual(built.orderedFields, [['bar',2],['foo',1]]);
  assert.notDeepEqual(trace, built.orderedFields.map(([name]) => name),
    'source evaluation order must differ from sorted layout order in this regression');
});

test('initializer exceptions stop later field evaluation without retry', () => {
  const target = shape('struct', [['foo','int'], ['bar','int']]);
  const failure = new Error('initializer failed');
  const trace = [];
  assert.throws(() => construct(target, [
    ['foo', () => {trace.push('foo'); throw failure;}],
    ['bar', () => {trace.push('bar'); return 2;}],
  ]), error => error === failure);
  assert.deepEqual(trace, ['foo']);
});

test('invalid closed-field constructors reject before executing any effects', () => {
  const target = shape('struct', [['foo','int'], ['bar','int']]);
  let effects = 0;
  const call = () => {effects++; return 1;};
  assert.throws(() => construct(target, [['foo', call]]), /missing/);
  assert.throws(() => construct(target, [['foo',call],['foo',call]]), /duplicate/);
  assert.throws(() => construct(target, [['foo',call],['other',call]]), /unknown/);
  assert.equal(effects, 0);
  assert.throws(() => construct(shape('record', [['foo','int']]), [['foo',call]]), /record alias/);
});

test('invalid aggregate shapes cannot be normalized into accepted values', () => {
  assert.throws(() => shape('struct', [['foo','int'],['foo','int']]), /duplicate/);
  assert.throws(() => shape('record', [['data','Pointer<Thing>']]), /unsupported field type/);
  assert.throws(() => shape('tuple', [['foo','int']]));
});
