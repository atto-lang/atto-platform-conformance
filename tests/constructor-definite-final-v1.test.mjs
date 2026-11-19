import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const c=JSON.parse(readFileSync(new URL('contracts/constructor-definite-final-v1.json',root),'utf8'));
test('deferred final registry includes honest independent backend status',()=>{
  assert.equal(c.schema,'atto.constructor-definite-final.v1');
  assert.equal(c.status,'TARGET_NOT_EXECUTED');
  assert.ok(Object.values(c.backend_status).every(x=>x==='NOT_EXECUTED'));
  assert.equal(c.cases.length,13);
  assert.equal(c.cases.filter(x=>x.kind==='pass').length,3);
  assert.equal(new Set(c.cases.map(x=>x.id)).size,c.cases.length);
});
test('every ordinary Atto fixture is declared and has an expected exit or compiler diagnostic',()=>{
  for(const item of c.cases){
    const s=readFileSync(new URL(item.path,root),'utf8');
    assert.match(s,/define class Ticket as/);
    assert.match(s,/pub final int id/);
    assert.match(s,/pub fnc main\(\)/);
    if(item.kind==='pass'){
      assert.equal(item.expected_exit,42);
      assert.ok(s.startsWith('// expect-exit: 42'));
    }else{
      assert.equal(item.no_artifact,true);
      assert.ok(s.startsWith('// expect-error: '+item.expected_error));
    }
  }
});
