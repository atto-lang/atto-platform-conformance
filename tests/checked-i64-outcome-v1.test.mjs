import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64Outcome, CheckedI64ContractError} from '../src/checked-i64-oracle.mjs';

const lit = value => ({op:'literal', value:String(value)});
const binary = (op, a, b) => ({op, args:[lit(a), lit(b)]});

test('structured outcome preserves decimal integer precision without JSON BigInt', () => {
  const good = evaluateCheckedI64Outcome(binary('add', '9223372036854775806', 1));
  assert.deepEqual(good, {status:'ok', decimal:'9223372036854775807'});
  assert.equal(JSON.stringify(good),
    '{"status":"ok","decimal":"9223372036854775807"}');
  assert.ok(Object.isFrozen(good));
  assert.deepEqual(evaluateCheckedI64Outcome(binary('div_trunc', -7, 3)),
    {status:'ok', decimal:'-2'});
  assert.deepEqual(evaluateCheckedI64Outcome(binary('rem', -7, 3)),
    {status:'ok', decimal:'-1'});
});

test('arithmetic faults have stable names and do not invent successful values', () => {
  const overflow = evaluateCheckedI64Outcome(binary('add', '9223372036854775807', 1));
  const zero = evaluateCheckedI64Outcome(binary('rem', 5, 0));
  assert.deepEqual(overflow, {status:'error', code:'integer_overflow'});
  assert.deepEqual(zero, {status:'error', code:'division_by_zero'});
  assert.ok(Object.isFrozen(overflow));
  assert.equal(JSON.stringify(zero), '{"status":"error","code":"division_by_zero"}');
});

test('malformed programs remain admission failures, not arithmetic results', () => {
  assert.throws(() => evaluateCheckedI64Outcome({op:'bad', args:[]}), TypeError);
  assert.throws(() => evaluateCheckedI64Outcome({op:'literal',value:'01'}), TypeError);
  const hostile = {op:'literal', get value() { throw Error('getter evaluated'); }};
  assert.throws(() => evaluateCheckedI64Outcome(hostile), /non-inert/);
  assert.throws(() => evaluateCheckedI64Outcome(null), TypeError);
  assert.equal(CheckedI64ContractError.name, 'CheckedI64ContractError');
});
