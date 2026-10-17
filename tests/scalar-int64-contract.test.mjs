import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const matrix=JSON.parse(await readFile(resolve('fixtures/scalar-int64-v1.json'),'utf8'));
const HEX40=/^[0-9a-f]{40}$/;
const DEC=/^-?(?:0|[1-9][0-9]*)$/;

test('scalar-int64-v1 contract is pinned, bounded and uniquely identified',()=>{
  assert.equal(matrix.schemaVersion,1);
  assert.equal(matrix.contract,'scalar-int64-v1');
  assert.match(matrix.javaReferenceSha,HEX40);
  assert.equal(matrix.cases.length,32);
  const ids=new Set();
  for(const c of matrix.cases){
    assert.match(c.id,/^[a-z0-9-]+$/);
    assert.ok(!ids.has(c.id),'duplicate id '+c.id);ids.add(c.id);
    assert.equal(typeof c.source,'string');
    assert.ok(c.source.length>0&&c.source.length<4096,c.id);
    assert.ok(['runtime','compile-reject','runtime-reject'].includes(c.expect),c.id);
    if(c.expect==='runtime') assert.match(c.resultInt64,DEC);
    else assert.match(c.category,/^[a-z0-9-]+$/);
  }
});

test('contract exercises extrema, wrapping, remainder, calls and negative admission',()=>{
  const ids=new Set(matrix.cases.map(c=>c.id));
  for(const id of [
    'i64-max','i64-min','wrap-add','wrap-sub','wrap-mul','negate-min',
    'rem-pos-pos','rem-neg-pos','rem-pos-neg','rem-neg-neg','rem-min-neg-one',
    'forward-call','nested-call','overflow-literal','underflow-literal',
    'unresolved','bad-arity','duplicate-function','division-int-slice','remainder-zero'
  ]) assert.ok(ids.has(id),id);
});
