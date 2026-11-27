import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyNegative, checkInventory } from '../scripts/copy-readonly-receipt-v1.mjs';
const f={id:'negative',path:'fixtures/copy-readonly-sharing-v1/negative.atto',status:'NOT_EXECUTED',diagnostic_line:12,forbidden_statement:'a.scores.n = 22;',paired_positive:'positive',expect:{compile_reject:'E_COPY_READONLY'}};
const p={id:'positive',path:'fixtures/copy-readonly-sharing-v1/positive.atto',status:'NOT_EXECUTED',expect:{main_result:42}};
const manifest={schema:'atto.copy-readonly-sharing.v1',status:'SOURCE_CANDIDATE_ONLY',full_parity:false,fixtures:[p,f]};
const names=['positive.atto','negative.atto'];
const good={status:1,signal:null,stderr:f.path+':12:5: E_COPY_READONLY: shared value\n'};
test('strict receipt accepts compact or spaced positions and one optional newline',()=>{
  for (const space of ['', ' ']) for (const ending of ['', '\n', '\r\n']) {
    const run={...good,stderr:f.path+':'+space+'12:5: E_COPY_READONLY: shared value'+ending};
    assert.equal(classifyNegative(f,true,run,false),'EXPECTED_REJECT');
  }
  for (const stderr of [' '+good.stderr,good.stderr+'\n',good.stderr+'extra',f.path+':12:9007199254740993: E_COPY_READONLY: invalid col',f.path+':012:5: E_COPY_READONLY: invalid line',f.path+':12:0: E_COPY_READONLY: invalid col',f.path+':11:5: E_COPY_READONLY: wrong line',f.path+':12:5: E_TYPE: E_COPY_READONLY',f.path+'.bak:12:5: E_COPY_READONLY: wrong file',null]) {
    assert.equal(classifyNegative(f,true,{...good,stderr},false),'WRONG_DIAGNOSTIC');
  }
});
test('unexecuted positive, infrastructure and published artifact fail closed',()=>{
  assert.equal(classifyNegative(f,false,good,false),'PAIRED_POSITIVE_NOT_EXECUTED');
  assert.equal(classifyNegative(f,true,good,true),'UNSAFE_ACCEPT_OR_ARTIFACT');
  assert.equal(classifyNegative(f,true,{...good,status:0},false),'UNSAFE_ACCEPT_OR_ARTIFACT');
  assert.equal(classifyNegative(f,true,{...good,status:2},false),'INFRA_ERROR');
  assert.equal(classifyNegative(f,true,{...good,status:null,signal:'SIGKILL'},false),'INFRA_ERROR');
  assert.equal(classifyNegative(f,true,{...good,error:new Error('timeout')},false),'INFRA_ERROR');
  assert.equal(classifyNegative(f,true,{...good,signal:undefined},false),'INFRA_ERROR');
  assert.equal(classifyNegative(f,true,{...good,status:101},false),'UNEXPECTED_EXIT');
});
test('fixture inventory rejects ambiguity, missing controls and incomplete corpus',()=>{
  assert.equal(checkInventory(manifest,names).size,2);
  for (const bad of [
    {...manifest,fixtures:[]}, {...manifest,full_parity:true},
    {...manifest,fixtures:[p,p]}, {...manifest,fixtures:[f]},
    {...manifest,fixtures:[p,{...f,paired_positive:'negative'}]},
    {...manifest,fixtures:[p,{...f,diagnostic_line:0}]},
    {...manifest,fixtures:[p,{...f,expect:{main_result:42,compile_reject:'E_COPY_READONLY'}}]},
    {...manifest,fixtures:[p,{...f,expect:{compile_reject:['E_COPY_READONLY']}}]},
    {...manifest,fixtures:[p,{...f,status:'GUEST_PASS'}]},
    {...manifest,fixtures:[p,{...f,path:'other.atto'}]},
  ]) assert.throws(()=>checkInventory(bad,names));
  assert.throws(()=>checkInventory(manifest,['positive.atto']));
  assert.throws(()=>checkInventory(manifest,[...names,'unregistered.atto']));
});
