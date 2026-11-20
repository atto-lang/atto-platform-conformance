import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const vectorPath=new URL('../fixtures/heterogeneous-v1/tensor-span-v1.json',import.meta.url);
const document=JSON.parse(fs.readFileSync(vectorPath,'utf8'));
const min=-(1n<<63n),max=(1n<<63n)-1n,range= n=>n>=min&&n<=max;
const expectedSemantics=Object.freeze({
  indexing:'start + (count - 1)*stride < backing_elements for count > 0, in mathematical integers',
  empty:'zero count valid when 0 <= start <= backing_elements and stride > 0',
  authority:'metadata only; no allocation access, owner, actor or GPU capability'
});
const expectedCaseIds=Object.freeze([
  'full','stepped','empty_end','zero_storage_empty','max_last','past_end',
  'nonempty_at_end','zero_stride','negative_stride','overflow_guard',
  'negative_capacity','negative_start','negative_count','empty_past_end',
  'last_index_off_by_one','max_contiguous','max_stride_invalid','zero_nonempty',
  'empty_max_end','max_end_nonempty','negative_min','valid_one',
  'valid_one_large_stride','invalid_count_two','valid_large_start','invalid_large_start'
]);


function parseVector(item) {
  const names=['backing_elements','start_element','element_count','element_stride'];
  const args=names.map(k=>{
    assert.match(item[k],/^-?(0|[1-9][0-9]*)$/,`malformed ${k}`);
    const n=BigInt(item[k]);
    assert.ok(range(n),`out-of-domain signed-i64 ${k}`);
    return n;
  });
  return args;
}
function oracle(n,start,count,stride) {
  if(n<0n||start<0n||count<0n||stride<=0n||start>n)return false;
  if(count===0n)return true;
  // Unlimited integer arithmetic; deliberate independent reference.
  return start+(count-1n)*stride<n;
}
function bounded(n,start,count,stride) {
  if(n<0n||start<0n||count<0n||stride<=0n||start>n)return false;
  if(count===0n)return true;
  if(start===n)return false;
  return count-1n<=(n-1n-start)/stride;
}
test('versioned tensor span fixture has valid schema and unique ids',()=>{
  assert.equal(document.schema,'oreslang.tensor-span-v1');
  assert.equal(document.scalar,'signed-i64');
  assert.deepEqual(document.semantics,expectedSemantics,'TensorSpan v1 semantics drift');
  assert.ok(Array.isArray(document.cases));
  assert.equal(document.cases.length,expectedCaseIds.length,'canonical case count drift');
  const seen=new Set();
  for(const item of document.cases){
    assert.equal(typeof item.id,'string');
    assert.match(item.id,/^[a-z][a-z0-9_]*$/);
    assert.ok(!seen.has(item.id),'duplicate case: '+item.id);
    seen.add(item.id);
    assert.equal(typeof item.valid,'boolean');
    const args=parseVector(item);
    assert.equal(oracle(...args),item.valid,`reference mismatch for ${item.id}`);
    assert.equal(bounded(...args),item.valid,`bounded mismatch for ${item.id}`);
  }
  assert.deepEqual([...seen].sort(),[...expectedCaseIds].sort(),'canonical TensorSpan case inventory drift');
});
test('reject out-of-domain and malformed vectors',()=>{
  assert.throws(()=>parseVector({backing_elements:'9223372036854775808',start_element:'0',element_count:'0',element_stride:'1'}),/out-of-domain/);
  assert.throws(()=>parseVector({backing_elements:'1.5',start_element:'0',element_count:'0',element_stride:'1'}),/malformed/);
  assert.throws(()=>parseVector({backing_elements:'1',start_element:'0',element_count:'0',element_stride:'0x1'}),/malformed/);
});
test('independent oracle detects off-by-one/overflow/stride mutations',()=>{
  assert.equal(oracle(8n,7n,2n,1n),false);
  assert.equal(oracle(8n,8n,1n,1n),false);
  assert.equal(oracle(max,1n,max,2n),false);
  assert.equal(oracle(8n,1n,3n,3n),true);
  assert.equal(oracle(0n,0n,0n,1n),true);
  assert.equal(bounded(max,0n,max,1n),true);
});
