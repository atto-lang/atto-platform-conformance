import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('type-test case corpus and evidence are internally consistent (not guest execution)',async()=>{
 const root=new URL('../',import.meta.url);
 const manifest=JSON.parse(await readFile(new URL('contracts/type-tests-casts-v1.json',root),'utf8'));
 assert.equal(manifest.schema,'atto.type-tests-casts.v1');
 assert.equal(manifest.cases.length,12);
 assert.equal(new Set(manifest.cases.map(x=>x.id)).size,12);
 for(const c of manifest.cases){
   assert.match(c.path,/^fixtures\/type-tests\/(?:pass|fail)\/[a-z-]+\.atto$/);
   const source=await readFile(new URL(c.path,root),'utf8');
   assert.match(source,/pub fnc main\(\): int/);
   if(c.kind==='pass') assert.equal(c.expected_exit,42);
   else {assert.match(c.expected_error,/^E_[A-Z_]+$/);assert.equal(c.no_guest_artifact,true);}
 }
 const receipt=manifest.backend_status['rs-browser-scalar'];
 assert.match(receipt.source_commit,/^[0-9a-f]{40}$/);
 assert.match(receipt.source_tree,/^[0-9a-f]{40}$/);
 assert.match(receipt.carrier_commit,/^[0-9a-f]{40}$/);
 assert.equal(receipt.actions_run,43980682449);
 for(const [backend, status] of Object.entries(manifest.backend_status)){
    if(backend!=='rs-browser-scalar')assert.equal(status.state,'not_executed');
 }
});
