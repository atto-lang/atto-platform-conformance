import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = path => readFileSync(new URL('../' + path, import.meta.url));
const json = path => JSON.parse(read(path).toString('utf8'));
const gitBlob = b => createHash('sha1').update('blob '+b.length+String.fromCharCode(0)).update(b).digest('hex');

test('return-first bullet and arrow fixtures are immutable exact Git blobs', () => {
 const reg=json('contracts/v2/return-first-separators-v1.json');
 assert.equal(reg.status,'SOURCE_ONLY_NOT_EXECUTED');
 assert.equal(reg.cases.length,26);
 assert.deepEqual(reg.accepted_separators.map(x=>x.spelling),['<-','•']);
 assert.match(reg.body_boundary_contract, /raises\/throws clause/);
 assert.match(reg.exception_spellings, /raise!/);
 for(const id of ['P07_bare_no_begin','P08_coloncolon_no_effects','P09_raises_begin','P10_raises_coloncolon','N08_raises_no_boundary','N09_duplicate_boundary','N10_effect_after_boundary','N11_coloncolon_missing_end'])
   assert.ok(reg.cases.some(c=>c.id===id),id);
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

test('return-first :: and effect-bearing begin variants remain cross-backend targets only', () => {
 const reg = json('contracts/v2/return-first-separators-v1.json');
 const corpus = Object.fromEntries(reg.cases.map(c => [c.id, read(c.path).toString('utf8')]));
 assert.match(corpus.P07_bare_no_begin, /double_answer\(int value\)\n  return value \* 2;/);
 assert.match(corpus.P08_coloncolon_no_effects, /double_answer\(int value\) ::\n/);
 for(const id of ['P09_raises_begin','P10_raises_coloncolon']) {
   assert.match(corpus[id], /raises Foo/);
   assert.match(corpus[id], /raise! new Foo\(\);/);
 }
 assert.match(corpus.P09_raises_begin, /raises Foo\nbegin/);
 assert.match(corpus.P10_raises_coloncolon, /raises Foo ::\n/);
 assert.match(corpus.P11_builtin_error_raises_coloncolon, /raises Error ::\n/);
 assert.match(corpus.P11_builtin_error_raises_coloncolon, /raise! Error\("too large"\);/);
 assert.match(corpus.P12_triggered_builtin_error_recover, /raise! Error\("invalid port"\)/);
 assert.match(corpus.P12_triggered_builtin_error_recover, /err\.is_raise/);
 assert.match(corpus.P13_triggered_builtin_error_bypasses_catch, /catch \(Error e\) \{ return 17; \}/);
 assert.match(corpus.P13_triggered_builtin_error_bypasses_catch, /raise! Error\("escalate"\)/);
 assert.match(corpus.N12_raise_not_covered_by_throws, /throws Error ::[\s\S]*raise! Error/);
 assert.match(corpus.P14_triggered_builtin_error_bypasses_trap, /trap maybe_escalate\(4\)/);
 assert.match(corpus.P14_triggered_builtin_error_bypasses_trap, /reason\.is_raise/);
 assert.match(corpus.P14_triggered_builtin_error_bypasses_trap, /raise! Error\("trap cannot intercept raised fault"\)/);
 assert.match(corpus.N08_raises_no_boundary, /raises Foo\n  return/);
 assert.match(corpus.N09_duplicate_boundary, /::\n  ::/);
 assert.match(corpus.N10_effect_after_boundary, /::\nraises Foo/);
 for(const c of reg.cases.slice(13)) {
   assert.ok(Object.values(c.backend_status).every(status=>status==='NOT_EXECUTED'));
   assert.equal(c.negative_no_artifact,c.kind==='negative');
 }
});
