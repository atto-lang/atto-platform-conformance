import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64,renderCheckedI64GuestSource} from '../src/checked-i64-oracle.mjs';

const lit=value=>({op:'literal',value:String(value)});
const neg=args=>({op:'neg',args:[args]});
const balanced=leaves=>leaves===1?lit(1):{
 op:'add',args:[balanced(Math.floor(leaves/2)),balanced(Math.ceil(leaves/2))]
};

test('64 levels of unary nesting are admitted but 65 are rejected',()=>{
 let expr=lit(1);
 for(let level=0;level<64;level++)expr=neg(expr);
 assert.equal(evaluateCheckedI64(expr),1n);
 expr=neg(expr);
 assert.throws(()=>evaluateCheckedI64(expr),/expression budget exceeded/);
 assert.throws(()=>renderCheckedI64GuestSource(expr),/expression budget exceeded/);
});

test('the 255-node balanced tree is admitted, while 257 nodes fail closed',()=>{
 assert.equal(evaluateCheckedI64(balanced(128)),128n);
 assert.throws(()=>evaluateCheckedI64(balanced(129)),/expression budget exceeded/);
 assert.throws(()=>renderCheckedI64GuestSource(balanced(129)),/expression budget exceeded/);
});

test('larger trees cannot bypass validation by placing extra nodes in right branch',()=>{
 const expr={op:'add',args:[lit(0),balanced(129)]};
 assert.throws(()=>evaluateCheckedI64(expr),/expression budget exceeded/);
});
