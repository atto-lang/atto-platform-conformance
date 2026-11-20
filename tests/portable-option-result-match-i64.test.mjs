import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base=new URL('../contracts/v1/portable-option-result/', import.meta.url);
const contract=JSON.parse(await readFile(new URL('option-result-match-i64-v0.json',base),'utf8'));
const source=await readFile(new URL('option-result-match-i64-v0.ores',base),'utf8');
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
const checked=value=>{
  assert.match(value,/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/);
  const n=BigInt(value);
  assert.ok(n>=MIN&&n<=MAX);
  return n;
};

test('matching contract is portable, experimental and does not claim parity',()=>{
  assert.equal(contract.schema,'oreslang.portable-adt-match-i64.v0');
  assert.match(contract.status,/NOT backend parity/);
  assert.deepEqual(contract.confirmedBackends,[]);
  assert.deepEqual(contract.capabilityRequirements,[]);
  assert.deepEqual(contract.typeDomains,['Option<int>','Result<int,int>']);
  assert.ok(contract.pendingBackends.includes('wasm'));
  assert.ok(contract.pendingBackends.includes('llvm'));
  assert.doesNotMatch(source,/\b(?:stdio|process|fs|fetch|Worker|await|spawn|interop)\b/);
  for(const marker of ['Some(n)','on None','Ok(n)','Err(e)','Some(m)'])assert.ok(source.includes(marker),marker);
});

test('positive vector oracle models Option/Result, capture and nesting correctly',()=>{
  const ids=new Set();
  for(const vector of contract.testVectors){
    assert.equal(ids.has(vector.id),false,vector.id);ids.add(vector.id);
    assert.equal(vector.args.length,1,vector.id);
    const n=checked(vector.args[0]);
    let result;
    switch(vector.function){
      case 'option_tag':result=n>0n?1n:0n;break;
      case 'option_value':result=n>0n?n:-1n;break;
      case 'result_tag':result=n<0n?-1n:1n;break;
      case 'result_value':result=n;break;
      case 'nested':result=n>0n?2n*n:-1n;break;
      case 'lazy_some':assert.equal(n,7n);result=7n;break;
      case 'lazy_none':assert.equal(n,0n);result=7n;break;
      case 'lazy_ok':assert.equal(n,7n);result=7n;break;
      case 'lazy_err':assert.equal(n,-7n);result=-7n;break;
      default:assert.fail('unexpected function '+vector.function);
    }
    assert.deepEqual(vector.expected,{int:String(result)},vector.id);
    checked(vector.expected.int);
  }
  assert.equal(ids.size,27);
  assert.ok(ids.has('option_value-9223372036854775807'));
  assert.ok(ids.has('result_value--9223372036854775808'));
});

test('negative fixtures are distinct and require semantic rejection, not generic failures',()=>{
  const ids=new Set();
  for(const item of contract.negativeCases){
    assert.equal(ids.has(item.id),false,item.id);ids.add(item.id);
    assert.equal(item.expect,'reject');
    assert.match(item.diagnosticClass,/^[a-z-]+$/);
    assert.ok(item.source.startsWith('define module core as\n'));
    assert.ok(item.source.endsWith('\nend\n'));
    assert.doesNotMatch(item.source,/\b(?:stdio|process|fs|fetch|Worker|await|spawn|interop)\b/);
  }
  assert.equal(ids.size,9);
});
