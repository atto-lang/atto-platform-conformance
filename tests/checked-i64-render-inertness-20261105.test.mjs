import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderCheckedI64GuestSource, CHECKED_I64_SOURCE_DIRECTIVE,
  evaluateCheckedI64Json
} from '../src/checked-i64-oracle.mjs';

const lit = value => ({op: 'literal', value: String(value)});
const unary = expr => ({op: 'neg', args: [expr]});
const bin = (op, a, b) => ({op, args: [a,b]});

test('nested render is byte-stable with and without the checked-i64 directive', () => {
  const expr = bin('add', unary(lit(7)), bin('rem', lit(8), lit(3)));
  const source = 'pub fnc main(): int { return ((-7) + (8 % 3)); }\n';
  assert.equal(renderCheckedI64GuestSource(expr), source);
  assert.equal(renderCheckedI64GuestSource(expr, 'checked-i64-v1'),
    CHECKED_I64_SOURCE_DIRECTIVE + source);
  assert.equal(renderCheckedI64GuestSource(expr), source);
});

test('unmapped integer division cannot emit guest source even when nested', () => {
  const quotient = bin('div_trunc', lit(9), lit(2));
  for (const expr of [quotient, unary(quotient), bin('add', lit(1), quotient)]) {
    assert.equal(renderCheckedI64GuestSource(expr), null);
    assert.equal(renderCheckedI64GuestSource(expr, 'checked-i64-v1'), null);
  }
});

test('unsupported source profile is rejected before an attacker operand getter', () => {
  let calls = 0;
  const operand = {};
  Object.defineProperty(operand, 'op', {get() { calls++; throw Error('getter executed'); }});
  assert.throws(() => renderCheckedI64GuestSource(operand, 'unsafe'), /unsupported checked-i64 source profile/);
  assert.throws(() => renderCheckedI64GuestSource(operand), /invalid expression operator/);
  assert.equal(calls, 0);
});

test('canonical JSON boundary rejects extra formatting while source render stays exact', () => {
  const expr = bin('sub', lit(10), lit(4));
  const canonical = JSON.stringify(expr);
  assert.equal(evaluateCheckedI64Json(canonical), 6n);
  assert.throws(() => evaluateCheckedI64Json(' ' + canonical), /noncanonical JSON expression/);
  assert.equal(renderCheckedI64GuestSource(expr), 'pub fnc main(): int { return (10 - 4); }\n');
});
