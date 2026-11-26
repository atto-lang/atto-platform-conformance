// TARGET corpus integrity only; no compiler execution or guest proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const c = JSON.parse(readFileSync(new URL('../contracts/copy-ownership-parity-v1.json',import.meta.url),'utf8'));
test('all eleven compiler profiles are present and NOT_EXECUTED',()=>{
 const expected=['atto','cranelift','forge','hdl','java','js','llvm','net','realtime','rs','wasm'].map(x=>'atto-lang/atto-source.'+x).sort();
 assert.deepEqual(c.backendProfiles.map(x=>x.repo).sort(),expected);
 assert.ok(c.backendProfiles.every(x=>x.status==='NOT_EXECUTED'));
});
test('every source is unique and has an explicit result or semantic diagnostic',()=>{
 assert.equal(c.cases.length,19);
 assert.equal(new Set(c.cases.map(x=>x.id)).size,19);
 assert.equal(new Set(c.cases.map(x=>x.source)).size,19);
 for(const x of c.cases) {
   assert.ok(x.source.endsWith('\n'));
   assert.match(x.source,/pub fnc main\(/);
   if(x.expect.kind==='execute') assert.equal(x.expect.value,42);
   else {
     assert.equal(x.expect.kind,'semantic_reject');
     assert.match(x.expect.diagnostic,/^E_[A-Z_]+$/);
   }
 }
});
test('canonical scope and explicit deep opt-in rules stay distinct',()=>{
 const lookup=id=>c.cases.find(x=>x.id===id);
 assert.match(lookup('shallow-lexical-release').source,/block \{/);
 assert.match(lookup('deep-flat-opt-in').source,/implements DeepCopyable<Flat>/);
 assert.doesNotMatch(lookup('deep-no-opt-in').source,/implements DeepCopyable/);
 assert.equal(lookup('take-scalar').source.replace('take!','move!'),lookup('move-scalar').source);
});
