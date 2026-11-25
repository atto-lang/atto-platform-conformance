import test from 'node:test';
import assert from 'node:assert/strict';
import {
 evaluateCheckedI64,renderCheckedI64GuestSource,I64_MIN
} from '../src/checked-i64-oracle.mjs';

const lit=n=>({op:'literal',value:String(n)});
const op=(kind,...args)=>({op:kind,args});
const throwsCode=(expr,code)=>assert.throws(
 ()=>evaluateCheckedI64(expr),error=>error?.code===code
);
// Pure BigInt oracle tests. No compiled .atto guest or backend parity claim.
test('left child fails first even when right child would also fail',()=>{
 const overflow=op('neg',lit(I64_MIN));
 const divzero=op('div_trunc',lit(7),lit(0));
 throwsCode(op('add',overflow,divzero),'integer_overflow');
 throwsCode(op('add',divzero,overflow),'division_by_zero');
});

test('zero multiplication must not skip an invalid right operand',()=>{
 const divzero=op('div_trunc',lit(8),lit(0));
 throwsCode(op('mul',lit(0),divzero),'division_by_zero');
 throwsCode(op('sub',lit(0),op('neg',lit(I64_MIN))),'integer_overflow');
});

test('negative minimum remainder is valid while division overflow is not',()=>{
 assert.equal(evaluateCheckedI64(op('rem',lit(I64_MIN),lit(-1))),0n);
 throwsCode(op('div_trunc',lit(I64_MIN),lit(-1)),'integer_overflow');
});

test('nested abstract integer quotient never emits a guest source program',()=>{
 const nested=op('add',lit(2),op('div_trunc',lit(7),lit(3)));
 assert.equal(renderCheckedI64GuestSource(nested),null);
 assert.equal(renderCheckedI64GuestSource(nested,'checked-i64-v1'),null);
});
