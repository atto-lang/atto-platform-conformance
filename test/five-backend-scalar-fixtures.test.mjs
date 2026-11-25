// HOST-ONLY: checks authored Oreslang corpus bytes, not any compiler execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {REQUIRED_CASES, FIXTURE_SHA256} from '../verification/five-backend-scalar-gate.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const read = id => readFileSync(new URL('../verification/fixtures/five-backend-scalar/' + id + '.ores', import.meta.url));
const content = id => read(id).toString('utf8');
for (const id of REQUIRED_CASES) {
  test('fixture exact SHA-256 pinned: ' + id, () => {
    const bytes = read(id);
    assert.equal(digest(bytes), FIXTURE_SHA256[id]);
    assert.equal(bytes.includes(0), false);
    assert.equal(bytes.length > 0 && bytes.length < 1024 * 1024, true);
  });
}
test('all eight pinned fixtures have a single scalar main and do not import secrets', () => {
  assert.equal(REQUIRED_CASES.length, 8);
  for (const id of REQUIRED_CASES) {
    const code = content(id);
    assert.match(code, /^pub fnc main\(\): int \{ return [^\n]+; \}\n$/);
    assert.doesNotMatch(code, /\b(import|actor|async|unsafe|spawn|ffi)\b/);
  }
});
test('the six accepted scalar outputs are exactly representable signed i64', () => {
  const expected = [
    ['scalar.literal-42', '42'],
    ['scalar.precedence', '28'],
    ['scalar.unary', '-21'],
    ['scalar.i64-min', '-9223372036854775808'],
    ['scalar.i64-max', '9223372036854775807'],
    ['scalar.i64-max-minus-one', '9223372036854775806']
  ];
  const min = -(1n << 63n), max = (1n << 63n) - 1n;
  for (const [id, value] of expected) {
    assert.ok(content(id).startsWith('pub fnc main()'));
    assert.ok(BigInt(value) >= min && BigInt(value) <= max);
  }
});
test('both overflow fixtures exceed signed i64 under BigInt reference arithmetic', () => {
  const max = (1n << 63n) - 1n;
  assert.equal(9223372036854775807n + 1n > max, true);
  assert.equal(4611686018427387904n * 2n > max, true);
  assert.match(content('checked-overflow.add'), /9223372036854775807 \+ 1/);
  assert.match(content('checked-overflow.multiply'), /4611686018427387904 \* 2/);
});
test('fixture mutation changes identity even when syntax remains plausible', () => {
  const before = read('scalar.literal-42');
  const mutant = Buffer.from(before.toString('utf8').replace('42;', '43;'));
  assert.notEqual(digest(mutant), FIXTURE_SHA256['scalar.literal-42']);
});
