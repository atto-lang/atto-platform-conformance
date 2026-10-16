import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {validateBatch,loadBatch,rejectDuplicateObjectKeys} from '../bin/validate-first-five.mjs';
const path = new URL('../contracts/first-five.json',import.meta.url);
const data = JSON.parse(await readFile(path,'utf8'));
const mutate = fn => { const copy = structuredClone(data); fn(copy); return copy; };

test('real committed five-track inventory is valid but not runtime evidence', async () => {
 const result = await loadBatch();
 assert.equal(result.tasks,5);
 assert.equal(result.parity_verified,false);
 assert.equal(result.compiler_executed,false);
 assert.equal(result.status,'CONTRACT_VALID_ONLY');
 assert.match(result.manifest_sha256,/^[a-f0-9]{64}$/);
});
test('exact order and identity required', () => {
 for (const change of [x=>x.tasks.pop(), x=>x.tasks[0].number=2,
   x=>x.tasks[1].id='grammar', x=>x.backends.reverse()])
   assert.throws(()=>validateBatch(mutate(change)));
});
test('cannot silently delete or insert a backend', () => {
 for (const change of [x=>delete x.tasks[0].statuses.forge,
   x=>x.tasks[0].statuses.browser='pending',
   x=>x.tasks[0].statuses.forge='pass',
   x=>x.tasks[0].statuses.java='verified'])
   assert.throws(()=>validateBatch(mutate(change)));
});
test('proof requirements and contract cases cannot quietly disappear', () => {
 for (const change of [x=>x.tasks[0].checks=[],x=>x.tasks[1].checks[1]=x.tasks[1].checks[0],
   x=>x.tasks[2].requires.push('unknown-proof'),x=>x.tasks[3].reference='https://evil.example/pr/1',
   x=>x.tasks[4].statuses=null])
   assert.throws(()=>validateBatch(mutate(change)));
});
test('bad CLI inputs do not bypass inventory validation', () => {
 const cli=new URL('../bin/validate-first-five.mjs',import.meta.url).pathname;
 const p=spawnSync(process.execPath,[cli,'--ignore-failures'],{encoding:'utf8'});
 assert.equal(p.status,2);
 assert.equal(p.stdout,'');
 assert.match(p.stderr,/usage:/);
});

test('duplicate keys are denied even when escaped or nested', () => {
  for (const input of [
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"outer":{"v":1,"v":2}}',
    '[{"nested":{"item":0,"item":1}}]',
    '{"a":[],"b":{"x":true,"x":false}}'
  ]) {
    JSON.parse(input); // Valid JSON whose semantics would otherwise be ambiguous.
    assert.throws(() => rejectDuplicateObjectKeys(input), /duplicate JSON object key/);
  }
  for (const input of [
    '{"a":1,"b":2}',
    '{"a":{"x":1},"b":{"x":2}}',
    '[{"x":1},{"x":2}]',
    '{"escaped\\\"key":"value","array":[true,null,false]}'
  ]) { JSON.parse(input); assert.doesNotThrow(() => rejectDuplicateObjectKeys(input)); }
});
test('delimited object-key collisions cannot masquerade as exact fields', () => {
  assert.throws(() => validateBatch(mutate(x => {
    delete x.tasks[0].statuses.java;
    delete x.tasks[0].statuses.llvm;
    x.tasks[0].statuses['java|llvm'] = 'pending';
  })), /invalid fields/);
});
