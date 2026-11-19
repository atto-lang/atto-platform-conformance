import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const c = JSON.parse(readFileSync(new URL('contracts/constructor-definite-final-admission-v2.json',root),'utf8'));

test('admission v2 covers all nine source cases and does not invent backend parity',()=>{
 assert.equal(c.schema,'atto.constructor-definite-final-admission-hardening.v2');
 assert.equal(c.status,'NOT_EXECUTED');
 assert.equal(c.cases.length,9);
 assert.equal(c.cases.filter(x=>x.kind==='pass').length,2);
 assert.equal(new Set(c.cases.map(x=>x.id)).size,c.cases.length);
 assert.ok(Object.values(c.backend_status).every(x=>x==='NOT_EXECUTED'));
 assert.match(c.source_compiler_merge_sha,/^[0-9a-f]{40}$/);
});
test('ordinary Atto fixtures have declared expected Wasm exit or compile rejection',()=>{
 for(const x of c.cases){
   const source=readFileSync(new URL(x.path,root),'utf8');
   assert.match(source,/define class Pair as/);
   assert.match(source,/pub fnc main\(\)/);
   assert.match(source,/final int left/);
   if(x.kind==='pass'){
     assert.equal(x.expected_exit,42);
     assert.ok(source.startsWith('// expect-exit: 42'));
   }else{
     assert.equal(x.no_wasm_artifact,true);
     assert.ok(source.startsWith('// expect-error: '+x.expected_error));
   }
 }
});
