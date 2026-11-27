import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyNegative} from '../scripts/run-copy-readonly-rust-wasm-v1.mjs';
const f={path:'fixtures/copy-readonly-sharing-v1/reject-copy-write.atto',diagnostic_line:12,expect:{compile_reject:'E_COPY_READONLY'}};
const outcome=(msg,changes={})=>({status:1,signal:null,stderr:f.path+': '+msg,...changes});
test('only paired positive and exact forbidden line/code admit the negative',()=>{
  const good=outcome('12:5: E_COPY_READONLY: shared value');
  assert.equal(classifyNegative(f,true,good,false),'EXPECTED_REJECT');
  assert.equal(classifyNegative(f,false,good,false),'PAIRED_POSITIVE_NOT_EXECUTED');
  for(const msg of ['11:5: E_COPY_READONLY: shared value','12:5: E_COPY_SHALLOW_ALIAS: unavailable',
    '12:0: E_COPY_READONLY: bad column','12:5: E_COPY_READONLY_SLOT: wrong code',
    '12:5: E_SYNTAX: spoof E_COPY_READONLY','12:5: E_COPY_READONLY: shared value\nextra line']){
    assert.equal(classifyNegative(f,true,outcome(msg),false),'WRONG_DIAGNOSTIC');
  }
  assert.equal(classifyNegative(f,true,{...good,stderr:'other.atto: 12:5: E_COPY_READONLY: wrong file'},false),'WRONG_DIAGNOSTIC');
});
test('artifact, process failure, timeout and compiler usage errors never pass',()=>{
  const good=outcome('12:5: E_COPY_READONLY: shared value');
  assert.equal(classifyNegative(f,true,good,true),'UNSAFE_ACCEPT_OR_ARTIFACT');
  assert.equal(classifyNegative(f,true,{...good,status:0},false),'UNSAFE_ACCEPT_OR_ARTIFACT');
  assert.equal(classifyNegative(f,true,{...good,status:2},false),'INFRA_ERROR');
  assert.equal(classifyNegative(f,true,{...good,status:null,signal:'SIGKILL'},false),'INFRA_ERROR');
  assert.equal(classifyNegative(f,true,{...good,error:new Error('timeout')},false),'INFRA_ERROR');
  assert.equal(classifyNegative(f,true,{...good,status:101},false),'UNEXPECTED_EXIT');
});

test('LLVM compact source location matches the same strict rejection contract',()=>{
  const good={status:1,signal:null,stderr:f.path+':12:5: E_COPY_READONLY: shared value\n'};
  assert.equal(classifyNegative(f,true,good,false),'EXPECTED_REJECT');
  assert.equal(classifyNegative(f,false,good,false),'PAIRED_POSITIVE_NOT_EXECUTED');
  assert.equal(classifyNegative(f,true,good,true),'UNSAFE_ACCEPT_OR_ARTIFACT');
  for(const stderr of [f.path+':  12:5: E_COPY_READONLY: extra space', f.path+':11:5: E_COPY_READONLY: wrong line', f.path+':12:0: E_COPY_READONLY: bad column', f.path+':12:5: E_COPY_READONLY_SLOT: wrong code', f.path+'.bak:12:5: E_COPY_READONLY: wrong file',f.path+':12:5: E_COPY_READONLY: shared value\nextra line']) {
    assert.equal(classifyNegative(f,true,{...good,stderr},false),'WRONG_DIAGNOSTIC');
  }
});
