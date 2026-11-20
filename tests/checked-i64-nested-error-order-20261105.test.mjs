import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64, CheckedI64ContractError, I64_MAX} from '../src/checked-i64-oracle.mjs';

const lit = n => ({op: 'literal', value: String(n)});
const neg = a => ({op: 'neg', args: [a]});
const binary = (op, a, b) => ({op, args: [a,b]});

const code = fn => {
  try { fn(); assert.fail('must throw a checked-i64 error'); }
  catch (e) { assert.ok(e instanceof CheckedI64ContractError, String(e)); return e.code; }
};

test('nested left subtree failures precede later right subtree failures', () => {
  const zero = binary('rem', lit(17), lit(0));
  const overflow = binary('add', lit(I64_MAX), lit(1));
  assert.equal(code(() => evaluateCheckedI64(binary('mul', zero, overflow))), 'division_by_zero');
  assert.equal(code(() => evaluateCheckedI64(binary('mul', overflow, zero))), 'integer_overflow');
});

test('exact depth-64 negation is admitted and depth 65 is rejected', () => {
  let expr = lit(0);
  for (let i = 0; i < 64; ++i) expr = neg(expr);
  assert.equal(evaluateCheckedI64(expr), 0n);
  assert.throws(() => evaluateCheckedI64(neg(expr)), /expression budget exceeded/);
});

test('shared subtrees consume a per-occurrence rather than per-identity node budget', () => {
  let expr = lit(1);
  for (let i = 0; i < 7; ++i) expr = binary('add', expr, expr);
  assert.equal(evaluateCheckedI64(expr), 128n); // 255 visited nodes
  assert.throws(() => evaluateCheckedI64(binary('add', expr, expr)), /expression budget exceeded/);
});

test('self-referential expression graphs are rejected by the finite depth budget', () => {
  const cyclic = {op: 'neg', args: []};
  cyclic.args.push(cyclic);
  assert.throws(() => evaluateCheckedI64(cyclic), /expression budget exceeded/);
});
