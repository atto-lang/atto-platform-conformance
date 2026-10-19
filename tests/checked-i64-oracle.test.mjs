import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  CHECKED_I64_CONTRACT, I64_MIN, I64_MAX,
  CheckedI64ContractError, evaluateCheckedI64
} from '../src/checked-i64-oracle.mjs';

const matrix=JSON.parse(await readFile(
  new URL('../fixtures/checked-i64-v1.json',import.meta.url),'utf8'));
const L=value=>({op:'literal',value:String(value)});
const B=(op,a,b)=>({op,args:[a,b]});
test('checked-i64 v1 contract has complete, unique, bounded evidence inventory',()=>{
  assert.equal(matrix.schemaVersion,1);
  assert.equal(matrix.contract,CHECKED_I64_CONTRACT);
  assert.equal(matrix.status,'candidate-unattested');
  assert.equal(matrix.cases.length,43);
  const ids=new Set();
  for(const row of matrix.cases){
    assert.match(row.id,/^[a-z0-9-]+$/);
    assert.ok(!ids.has(row.id),'duplicate '+row.id);
    ids.add(row.id);
    assert.ok(['value','error'].includes(row.expected.kind));
    if(row.expected.kind==='value'){
      assert.match(row.expected.decimal,/^(0|-?[1-9][0-9]*)$/);
      assert.equal(row.expected.category,undefined);
    }else{
      assert.ok(['integer_overflow','division_by_zero'].includes(row.expected.category));
      assert.ok(['compile','runtime'].includes(row.expected.phase));
    }
    assert.ok(row.guestSource?.startsWith('pub fnc main(): int')||
              row.guestSourceStatus==='abstract-unmapped',row.id);
    if(row.guestSourceStatus==='abstract-unmapped')
      assert.match(JSON.stringify(row.expr),/div_trunc/);
  }
  for(const id of ['literal-min','literal-max','literal-over-max',
    'literal-under-min','neg-min','mul-min-negative-one',
    'rem-min-minus-one','intermediate-add-overflow','intermediate-sub-overflow',
    'intermediate-mul-overflow','div-trunc-min-minus-one']){
    assert.ok(ids.has(id),'required vector '+id);
  }
});
test('every mathematical checked-i64 vector has its independently specified outcome',()=>{
  let values=0,failures=0;
  for(const row of matrix.cases){
    if(row.expected.kind==='value'){
      assert.equal(evaluateCheckedI64(row.expr).toString(),row.expected.decimal,row.id);
      values++;
    }else{
      assert.throws(()=>evaluateCheckedI64(row.expr),error=>
        error instanceof CheckedI64ContractError &&
        error.code===row.expected.category,row.id);
      failures++;
    }
  }
  assert.equal(values,26);
  assert.equal(failures,17);
});
test('checked range boundaries and signed remainder distinguish wrapping from conformance',()=>{
  assert.equal(I64_MIN.toString(),'-9223372036854775808');
  assert.equal(I64_MAX.toString(),'9223372036854775807');
  assert.equal(evaluateCheckedI64(B('rem',L(I64_MIN),L(-1))),0n);
  assert.throws(()=>evaluateCheckedI64(B('add',L(I64_MAX),L(1))),
    {name:'CheckedI64ContractError',code:'integer_overflow'});
  assert.throws(()=>evaluateCheckedI64(B('sub',
    B('add',L(I64_MAX),L(1)),L(1))),
    {name:'CheckedI64ContractError',code:'integer_overflow'});
  assert.equal(BigInt.asIntN(64,I64_MAX+1n),I64_MIN);
});
test('reference only admits bounded, well-formed expression trees',()=>{
  for(const invalid of [
    null,[],{op:'literal',value:42},{op:'literal',value:'01'},
    {op:'literal',value:'-0'},{op:'literal',value:'+'},
    {op:'literal',value:'1',extra:'ignored'},
    {op:'no-such-op',args:[]},{op:'neg',args:[]},
    {op:'add',args:[L(1)]},{op:'add',args:[L(1),L(2),L(3)]},
    {op:'literal',value:'1'.repeat(65)}
  ])assert.throws(()=>evaluateCheckedI64(invalid));
  let deep=L(1);
  for(let i=0;i<70;i++)deep={op:'neg',args:[deep]};
  assert.throws(()=>evaluateCheckedI64(deep),/budget/);
});
