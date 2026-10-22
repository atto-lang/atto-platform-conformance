import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const contract=JSON.parse(await readFile(new URL('../contracts/v1/portable-option-result/option-result-i64-v0.json',import.meta.url),'utf8'));
const source=await readFile(new URL('../contracts/v1/portable-option-result/option-result-i64-v0.ores',import.meta.url),'utf8');
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
const functions=new Set(['optional_positive','optional_or_zero','checked_nonnegative']);
const checked=n=>{
  assert.match(n,/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/);
  const v=BigInt(n);assert.ok(v>=MIN&&v<=MAX);return v;
};

test('portable ADT manifest is explicitly experimental and pure-host-capability-free',()=>{
  assert.equal(contract.schema,'oreslang.portable-option-result-i64.v0');
  assert.match(contract.status,/NOT verified backend parity/);
  assert.equal(contract.numericModel,'signed-i64-checked-provisional');
  assert.deepEqual(contract.capabilityRequirements,[]);
  assert.deepEqual(contract.typeDomains,['Option<int>','Result<int,int>']);
  assert.ok(contract.acceptanceGates.some(g=>g.includes('LLVM')));
  assert.ok(contract.acceptanceGates.some(g=>g.includes('Wasm')));
});

test('canonical pure source fixture declares variants without hosted std',()=>{
  assert.match(source,/Some\(x\)/);
  assert.match(source,/return None;/);
  assert.match(source,/return Err\(x\)/);
  assert.match(source,/return Ok\(x\)/);
  assert.match(source,/Option\.unwrap_or/);
  assert.match(source,/Result\.unwrap_or/);
  assert.doesNotMatch(source,/\b(?:stdio|process|fs|fetch|Worker|await|spawn|interop)\b/);
  assert.equal((source.match(/define module core/g)||[]).length,1);
});

test('cross-backend vectors agree with a separate signed-i64 reference model',()=>{
  const ids=new Set();
  for(const x of contract.testVectors){
    assert.equal(typeof x.id,'string');assert.ok(x.id.length);
    assert.equal(ids.has(x.id),false);ids.add(x.id);
    assert.ok(functions.has(x.function));
    assert.equal(x.args.length,1);
    const n=checked(x.args[0]);
    let expected;
    if(x.function==='optional_positive')
      expected=n>0n?{variant:'Some',value:String(n)}:{variant:'None'};
    else if(x.function==='checked_nonnegative')
      expected=n<0n?{variant:'Err',value:String(n)}:{variant:'Ok',value:String(n)};
    else expected={int:String(n>0n?n:0n)};
    assert.deepEqual(x.expected,expected,x.id);
    if(Object.hasOwn(x.expected,'value'))checked(x.expected.value);
    if(Object.hasOwn(x.expected,'int'))checked(x.expected.int);
  }
  assert.ok(ids.size>=10);
  assert.ok(ids.has('min-i64-option'));
  assert.ok(ids.has('max-i64-option'));
});
