import test from 'node:test';
import assert from 'node:assert/strict';

// Candidate host-only arithmetic oracle; not a compiler or an ABI test.
const widths = [8n, 16n, 32n, 64n];
const ops = ['add', 'sub', 'mul'];
function bounds(w, signed) {
  const top = 1n << (signed ? w - 1n : w);
  return [signed ? -top : 0n, top - 1n];
}
function reference(op, a, b, lo, hi) {
  const value = op === 'add' ? a + b : op === 'sub' ? a - b : a * b;
  return value < lo || value > hi ? 'overflow' : value;
}
function preflight(op, a, b, lo, hi) {
  if (op === 'add') {
    if (b > 0n && a > hi - b || b < 0n && a < lo - b) return 'overflow';
    return a + b;
  }
  if (op === 'sub') {
    if (b > 0n && a < lo + b || b < 0n && a > hi + b) return 'overflow';
    return a - b;
  }
  if (a === 0n || b === 0n) return 0n;
  if (a > 0n && b > 0n && a > hi / b ||
      a > 0n && b < 0n && b < lo / a ||
      a < 0n && b > 0n && a < lo / b ||
      a < 0n && b < 0n && a < hi / b) return 'overflow';
  return a * b;
}
for (const signed of [false, true]) {
  for (const w of widths) {
    const label = `${signed ? 'i' : 'u'}${w}`;
    test(`${label}: checked add/sub/mul against independent range preflight`, () => {
      const [lo, hi] = bounds(w, signed);
      const edges = [...new Set([lo, lo + 1n, lo + 2n, -2n, -1n, 0n, 1n, 2n, hi / 2n, hi - 2n, hi - 1n, hi].filter(v => v >= lo && v <= hi))];
      let values = 0, faults = 0;
      const check = (a, b) => {
        for (const op of ops) {
          const expected = reference(op, a, b, lo, hi);
          assert.equal(preflight(op, a, b, lo, hi), expected, `${label} ${op} ${a} ${b}`);
          if (expected === 'overflow') faults++; else values++;
        }
      };
      if (w === 8n) {
        for (let a = lo; a <= hi; a++) for (let b = lo; b <= hi; b++) check(a, b);
        assert.equal(values + faults, 196608);
      } else {
        for (const a of edges) for (const b of edges) check(a, b);
        let state = 0x9e3779b97f4a7c15n;
        const mask = (1n << 64n) - 1n;
        const next = () => {
          state ^= (state << 13n) & mask;
          state ^= state >> 7n;
          state ^= (state << 17n) & mask;
          return state;
        };
        const operand = () => {
          const n = next();
          return n & 1n ? edges[Number((n >> 1n) % BigInt(edges.length))] : lo + ((n >> 1n ^ next()) & ((1n << w) - 1n));
        };
        for (let i = 0; i < 10000; i++) check(operand(), operand());
        assert.equal(values + faults, 3 * (edges.length ** 2 + 10000));
      }
      assert.ok(values > 0 && faults > 0);
    });
  }
}
