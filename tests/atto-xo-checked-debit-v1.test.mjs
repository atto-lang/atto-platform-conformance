import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const corpus = readFileSync(new URL('../contracts/atto-xo-checked-debit-v1/cases.tsv', import.meta.url), 'utf8');
const min = -(1n << 63n), max = (1n << 63n) - 1n;
function checked(value) {
  if (value < min || value > max) throw new RangeError('overflow');
  return value;
}
test('Atto-XO signed debit corpus matches checked intermediate arithmetic', () => {
  const rows = corpus.trimEnd().split('\n');
  assert.equal(rows.length, 7);
  const ids = new Set();
  const outcomes = { value: 0, overflow: 0 };
  for (const row of rows) {
    const fields = row.split('|');
    assert.equal(fields.length, 8);
    const [id, expected, price, shares, fee, op, adj, source] = fields;
    assert.ok(!ids.has(id), id);
    ids.add(id);
    for (const n of [price, shares, fee, adj]) {
      assert.match(n, /^(0|[1-9][0-9]*)$/);
      assert.ok(BigInt(n) <= max);
    }
    assert.ok(['+', '-', '*'].includes(op));
    assert.equal(source, 'pub fnc debit(int price,int shares,int fee): int { return price*shares+fee; } ' +
      'pub fnc main(): int { return debit(' + [price, shares, fee].join(',') + ')' + op + adj + '; }');
    let result;
    try {
      const total = checked(checked(BigInt(price) * BigInt(shares)) + BigInt(fee));
      const delta = BigInt(adj);
      result = checked(op === '+' ? total + delta : op === '-' ? total - delta : total * delta).toString();
    } catch (err) {
      assert.ok(err instanceof RangeError);
      result = 'overflow';
    }
    assert.equal(result, expected, id);
    outcomes[result === 'overflow' ? 'overflow' : 'value']++;
  }
  assert.deepEqual(outcomes, { value: 3, overflow: 4 });
});
