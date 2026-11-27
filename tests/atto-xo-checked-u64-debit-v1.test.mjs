import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MAX = (1n << 64n) - 1n;
const rows = readFileSync(new URL('../contracts/atto-xo-checked-u64-debit-v1/cases.tsv', import.meta.url), 'utf8').trimEnd().split('\n');

function checked(n) {
  if (n < 0n || n > MAX) throw new RangeError('overflow');
  return n;
}
function exact(p, s, f, op, a) {
  try {
    const debit = checked(checked(p * s) + f);
    return checked(op === '+' ? debit + a : op === '-' ? debit - a : debit * a).toString();
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return 'overflow';
  }
}
function preflight(p, s, f, op, a) {
  if (s !== 0n && p > MAX / s) return 'overflow';
  const principal = p * s;
  if (f > MAX - principal) return 'overflow';
  const debit = principal + f;
  if (op === '+') return a > MAX - debit ? 'overflow' : (debit + a).toString();
  if (op === '-') return a > debit ? 'overflow' : (debit - a).toString();
  return a !== 0n && debit > MAX / a ? 'overflow' : (debit * a).toString();
}

test('unsigned full-width debit guest source and exact results', () => {
  assert.equal(rows.length, 12);
  const ids = new Set(), outcomes = { value: 0, overflow: 0 };
  for (const line of rows) {
    const fields = line.split('|');
    assert.equal(fields.length, 9);
    const [id, expected, type, p, s, f, op, a, source] = fields;
    assert.ok(!ids.has(id)); ids.add(id);
    assert.ok(['u64', 'uint'].includes(type));
    assert.ok(['+', '-', '*'].includes(op));
    for (const n of [p,s,f,a]) {
      assert.match(n, /^(0|[1-9][0-9]*)$/);
      assert.ok(BigInt(n) <= MAX);
    }
    const expectedSource = 'pub fnc debit(' + type + ' price,' + type + ' shares,' + type +
      ' fee): ' + type + ' { return price*shares+fee; } pub fnc main(): ' +
      type + ' { return debit(' + [p,s,f].join(',') + ')' + op + a + '; }';
    assert.equal(source, expectedSource, id);
    const args = [BigInt(p), BigInt(s), BigInt(f), op, BigInt(a)];
    assert.equal(exact(...args), expected, id);
    assert.equal(preflight(...args), expected, id);
    outcomes[expected === 'overflow' ? 'overflow' : 'value']++;
  }
  assert.deepEqual(outcomes, { value: 6, overflow: 6 });
});

test('1000000 deterministic host arithmetic cases agree with overflow preflight', () => {
  let state = 0x9e3779b97f4a7c15n;
  const next = () => {
    state ^= (state << 13n) & MAX;
    state ^= state >> 7n;
    state ^= (state << 17n) & MAX;
    return state;
  };
  let positives = 0, overflows = 0;
  const edges = [0n, 1n, 2n, 255n, 1n << 53n, 1n << 63n, MAX - 1n, MAX];
  for (let i = 0; i < 1000000; i++) {
    const operand = () => {
      const n = next();
      switch (Number(n & 3n)) {
        case 0: return n;
        case 1: return n & 0xffffn;
        case 2: return edges[Number((n >> 2n) & 7n)];
        default: return n & 0xffffffffn;
      }
    };
    const args = [operand(), operand(), operand(), ['+', '-', '*'][i % 3], operand()];
    const expected = exact(...args);
    assert.equal(preflight(...args), expected, 'case ' + i);
    if (expected === 'overflow') overflows++; else positives++;
  }
  assert.ok(positives > 1000 && overflows > 1000);
});
