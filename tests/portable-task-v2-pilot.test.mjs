import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {portableTaskBackends} from '../lib/portable-task-v1.mjs';
const root=new URL('../fixtures/portable-task-v2-pilot/',import.meta.url);
const m=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
test('canonical pilot keeps proposed TaskFuture and compatibility Future distinct and pins every raw blob',async()=>{
 assert.equal(m.schema,'atto.portable-task.v2-pilot');
 assert.equal(m.executionVerified,false);
 assert.deepEqual(m.backends,portableTaskBackends);
 assert.equal(m.specCommit,'af7418096768d003e3dfbb83ff35069ca3f2c274');
 assert.deepEqual(m.cases.map(c=>[c.id,c.expect,c.expectedGuestExit,c.expectedDiagnosticCode??null]),[
 ['taskfuture-int','positive',42,null],['future-int','positive',42,null],['taskfuture-string','positive',42,null],
 ['reject-double-await','negative',null,'E_TASK_RESULT_CONSUMED'],['reject-const-taskfuture','negative',null,'E_CONST']]);
 for(const c of m.cases){
  assert.equal(c.file,c.id+'.atto');
  const b=await readFile(new URL(c.file,root));
  assert.equal(createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),c.fixtureBlobSha);
 }
 assert.equal(new Set(m.cases.map(c=>c.fixtureBlobSha)).size,5);
});
