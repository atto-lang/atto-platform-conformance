import test from 'node:test';
import assert from 'node:assert/strict';
import {
 evaluateCheckedI64,evaluateCheckedI64Json,renderCheckedI64GuestSource,
 CHECKED_I64_SOURCE_DIRECTIVE
} from '../src/checked-i64-oracle.mjs';

const lit=n=>({op:'literal',value:String(n)});
const op=(name,...args)=>({op:name,args});
const tree=()=>op('sub',op('mul',op('add',lit(4),lit(5)),lit(7)),lit(21));

test('the same nested arithmetic tree evaluates to 42 via inert and canonical JSON APIs',()=>{
 const expr=tree();
 assert.equal(evaluateCheckedI64(expr),42n);
 assert.equal(evaluateCheckedI64Json(JSON.stringify(expr)),42n);
});

test('nested guest expression comes from exactly the evaluated expression tree',()=>{
 const expr=tree();
 const expected='pub fnc main(): int { return (((4 + 5) * 7) - 21); }\n';
 assert.equal(renderCheckedI64GuestSource(expr),expected);
 assert.equal(renderCheckedI64GuestSource(expr,'checked-i64-v1'),CHECKED_I64_SOURCE_DIRECTIVE+expected);
 assert.throws(()=>renderCheckedI64GuestSource(expr,'unsupported-profile'),/unsupported checked-i64 source profile/);
});

test('abstract truncating quotient nested within arithmetic never claims an Atto source mapping',()=>{
 const expr=op('add',op('div_trunc',lit(8),lit(3)),lit(1));
 assert.equal(evaluateCheckedI64(expr),3n);
 assert.equal(renderCheckedI64GuestSource(expr),null);
 assert.equal(renderCheckedI64GuestSource(expr,'checked-i64-v1'),null);
});
