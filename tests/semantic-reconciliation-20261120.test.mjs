import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = path => readFileSync(new URL('../' + path, import.meta.url));
const json = path => JSON.parse(read(path).toString('utf8'));
const gitBlob = b => createHash('sha1').update('blob '+b.length+'\\0'.replace('\\0','\0')).update(b).digest('hex');

test('return-first bullet and arrow fixtures are immutable exact Git blobs', () => {
 const reg=json('contracts/v2/return-first-separators-v1.json');
 assert.equal(reg.status,'SOURCE_ONLY_NOT_EXECUTED');
 assert.equal(reg.cases.length,12);
 assert.deepEqual(reg.accepted_separators.map(x=>x.spelling),['<-','•']);
 for(const c of reg.cases){
  const bytes=read(c.path);
  assert.equal(gitBlob(bytes),c.git_blob_sha,c.id);
  assert.ok(Object.values(c.backend_status).every(s=>s==='NOT_EXECUTED'));
  if(c.kind==='negative') assert.equal(c.negative_no_artifact,true);
 }
 for(const c of reg.cases.filter(x=>x.id.startsWith('P02')||x.id.startsWith('P04')||x.id.startsWith('P06')))
  assert.ok(read(c.path).toString().includes('•'));
});

test('historical Option trap and contradictory effect case cannot certify canonical Result trap',()=>{
 const old=json('contracts/v1/caller-trap-parity/manifest.json');
 const effects=json('contracts/v1/function-effects-v1.json');
 const next=json('contracts/v2/trap-result-v2.json');
 assert.equal(old.canonicalReplacement,'contracts/v2/trap-result-v2.json');
 assert.equal(effects.canonical_trap_contract,'contracts/v2/trap-result-v2.json');
 assert.equal(next.result_semantics['trap(T)'],'Result<T,Error>');
 assert.ok(next.tests.some(x=>x.id==='declared-throw-inside-trap-expression'));
 assert.ok(Object.values(next.backends).every(x=>x.status==='NOT_EXECUTED'));
});

test('shared-process isolation must be independently enforced',()=>{
 const actor=json('contracts/actor-service-v1.json').cases['hostile-tenant-contained'];
 assert.ok(actor.assertion.includes('shared OS process'));
 assert.ok(actor.assertion.includes('verified per-tenant TenantVM'));
 assert.ok(actor.inadequateBoundaries.includes('thread-only'));
 assert.equal(json('contracts/v2/owner-semantic-reconciliation-v1.json').status,'DRAFT_SOURCE_ONLY_NO_GUEST_PARITY');
});
