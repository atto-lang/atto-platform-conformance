import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCheckedI64, evaluateCheckedI64Json,
  renderCheckedI64GuestSource, I64_MIN, I64_MAX,
  CHECKED_I64_SOURCE_DIRECTIVE
} from '../src/checked-i64-oracle.mjs';

const lit=value=>({op:'literal',value:String(value)});
const bin=(op,a,b)=>({op,args:[lit(a),lit(b)]});

test('abstract checked remainder retains signed dividend semantics', () => {
  for(const [a,b,expected] of [
    [-7n,3n,-1n],[7n,-3n,1n],[-7n,-3n,-1n],
    [I64_MIN,-1n,0n],[0n,-7n,0n]
  ]) assert.equal(evaluateCheckedI64(bin('rem',a,b)),expected);
  assert.throws(()=>evaluateCheckedI64(bin('rem',1n,0n)),
    error=>error?.code==='division_by_zero');
});

test('signed endpoints, intermediate overflows and truncating quotient stay distinct', () => {
  assert.equal(evaluateCheckedI64(lit(I64_MIN)),I64_MIN);
  assert.equal(evaluateCheckedI64(lit(I64_MAX)),I64_MAX);
  assert.equal(evaluateCheckedI64(bin('div_trunc',-7n,3n)),-2n);
  assert.equal(renderCheckedI64GuestSource(bin('div_trunc',-7n,3n)),null);
  for(const expr of [
    bin('add',I64_MAX,1n),
    bin('sub',I64_MIN,1n),
    bin('mul',I64_MAX,2n),
    {op:'neg',args:[lit(I64_MIN)]},
    bin('div_trunc',I64_MIN,-1n)
  ]) assert.throws(()=>evaluateCheckedI64(expr),error=>error?.code==='integer_overflow');
});

test('canonical JSON rejects decimal aliases and duplicate fields', () => {
  const valid=JSON.stringify(lit('-7'));
  assert.equal(evaluateCheckedI64Json(valid),-7n);
  for(const raw of [
    ' '+valid,valid+' ',
    '{"op":"literal","value":"-0"}',
    '{"op":"literal","value":"01"}',
    '{"op":"literal","value":"-07"}',
    '{"op":"literal","value":"1","value":"1"}'
  ]) assert.throws(()=>evaluateCheckedI64Json(raw));
});

test('guest-source renderer adds checked profile directive only when requested', () => {
  const expr={op:'add',args:[lit(1n),{op:'neg',args:[lit(2n)]}]};
  const source=renderCheckedI64GuestSource(expr);
  assert.equal(source,'pub fnc main(): int { return (1 + (-2)); }\n');
  assert.equal(renderCheckedI64GuestSource(expr,'checked-i64-v1'),
    CHECKED_I64_SOURCE_DIRECTIVE+source);
  assert.throws(()=>renderCheckedI64GuestSource(expr,'foreign-profile'));
});
