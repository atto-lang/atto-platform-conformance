import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const c = JSON.parse(readFileSync(new URL('contracts/receiver-constructor-whitespace-v1.json', root)));

test('portable constructor spacing contract stays NOT_EXECUTED until real guests run', () => {
  assert.equal(c.schema, 'atto.receiver.constructor.whitespace.v1');
  assert.equal(c.status, 'TARGET_NOT_EXECUTED');
  assert.equal(c.required_cases.length, 4);
  assert.equal(new Set(c.required_cases.map(x => x.id)).size, 4);
  assert.deepEqual(new Set(Object.values(c.backend_status)), new Set(['NOT_EXECUTED']));
  assert.equal(c.canonical_header, 'constructor (Counter)(int initial): self');
});

test('all three constructor spellings have byte-identical non-whitespace source', () => {
  const positives = c.required_cases.filter(x => x.kind === 'pass');
  assert.equal(positives.length, 3);
  const source = positives.map(x => {
    const value = readFileSync(new URL(x.path, root), 'utf8');
    assert.ok(value.includes('// expect-exit: 42'));
    assert.equal(x.expected_exit, 42);
    return value;
  });
  const equivalent = source.map(x => x.replace(/\s+/g, ''));
  assert.ok(equivalent.every(x => x === equivalent[0]));
  for (const x of source) assert.ok(x.includes('pub fnc main()'));
});

test('different whitespace never introduces another constructor overload', () => {
  const negative = c.required_cases.find(x => x.id === 'duplicate_spacing');
  assert.equal(negative.kind, 'fail');
  assert.equal(negative.expected_error, 'E_DUPLICATE');
  const source = readFileSync(new URL(negative.path, root), 'utf8');
  assert.ok(source.includes('// expect-error: E_DUPLICATE'));
  assert.match(source, /constructor \(Counter\)\(\): self/);
  assert.match(source, /constructor\(Counter\) \(\): self/);
});
