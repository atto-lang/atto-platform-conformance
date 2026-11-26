import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const registry = JSON.parse(readFileSync(new URL('../contracts/execution-context-unwind-v1.json', import.meta.url), 'utf8'));
const expected_backends = [
  'atto-source.atto', 'atto-source.cranelift', 'atto-source.forge',
  'atto-source.hdl', 'atto-source.java', 'atto-source.js',
  'atto-source.llvm', 'atto-source.net', 'atto-source.realtime',
  'atto-source.rs', 'atto-source.wasm',
];

test('execution-context unwind registry enumerates all eleven active backends',()=>{
  assert.equal(registry.schema_version,1);
  assert.equal(registry.contract,'atto-execution-context-unwind-v1');
  assert.deepEqual(registry.backends,expected_backends);
  assert.match(registry.normative_spec,/atto-spec\/blob\/main\/language\/defer-recover-unwind-v1\.md$/);
  assert.deepEqual(registry.allowed_verification_statuses,['passed','failed','unsupported','not_executed']);
});

test('complete source-free positive/negative semantics without invented guest passes',()=>{
  const cases=registry.cases;
  assert.ok(cases.length >= 33);
  assert.equal(registry.extended_spec_candidate,'https://github.com/atto-lang/atto-spec/pull/245');
  assert.equal(new Set(cases.map(x=>x.id)).size,cases.length);
  for(const x of cases){
    assert.match(x.id,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(x.reason.length > 20);
    assert.ok(x.expected_trace.length >= 2);
    assert.equal(x.overall_status,'not_executed');
    assert.deepEqual(Object.keys(x.backend_statuses),expected_backends);
    for (const b of expected_backends) {
      assert.equal(x.backend_statuses[b],'not_executed',
        `${x.id}/${b}: host-only proofs never imply guest PASS`);
    }
  }
  for(const id of ['return-lifo','throw-outer-catch','raise-catch-bypass',
    'panic-fatal','cancel-terminal','recovery-one-shot','task-await-context',
    'sibling-task-separation','tenant-generation','async-cleanup-proof',
    'braceless-delayed','bound-closure-factory','named-cleanup','factory-registration-failure',
    'bare-await-cleanup','assignment-await-cleanup','susp-recover-cursor','callback-local-error-handled',
    'callback-error-panic','multiple-cleanup-panics','cancel-cleanup-panic','recover-error-panic',
    'nested-defer-scope','unsafe-borrow-suspension','nonsuspending-block-await','wrong-callback-arity',
    'susp-cleanup-stale-wakeup','discarded-fallible-result'])
    assert.ok(cases.some(c=>c.id===id),`missing ${id}`);
  assert.ok(cases.some(c=>c.group==='compile-reject'));
});

test('local JS host model is explicitly segregated from transpiled guest evidence',()=>{
  const h=registry.local_js_host_reference;
  assert.equal(h.draft_pr,'https://github.com/atto-lang/atto-source.js/pull/74');
  assert.match(h.source_blob_sha,/^[a-f0-9]{40}$/);
  assert.match(h.test_blob_sha,/^[a-f0-9]{40}$/);
  assert.equal(h.node_version,'v22.16.0');
  assert.equal(h.local_host_tests_passed,18);
  assert.equal(h.local_host_tests_failed,0);
  assert.equal(h.guest_level_verification,'not_executed');
  assert.equal(registry.cases[0].backend_statuses['atto-source.js'],'not_executed');
});

test('candidate guest source blobs are exact and not execution receipts',()=>{
  const fixtures=registry.candidate_guest_fixtures;
  assert.equal(fixtures.length,4);
  assert.equal(new Set(fixtures.map(f=>f.path)).size,4);
  for(const f of fixtures){
    assert.match(f.path,/^fixtures\/execution-context-unwind-v1\/[a-z-]+\.atto$/);
    const b=readFileSync(new URL('../'+f.path,import.meta.url));
    const blob=createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
    assert.equal(blob,f.git_blob_sha);
    assert.ok(registry.cases.some(c=>c.id===f.case_id));
    assert.ok(['return','panic'].includes(f.expected.kind));
  }
});
