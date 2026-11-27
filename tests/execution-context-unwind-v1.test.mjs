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
  assert.ok(cases.length >= 40);
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
    'susp-cleanup-stale-wakeup','discarded-fallible-result',
    'scheduled-unwind-next-turn','scheduled-unwind-duplicate-completion',
    'scheduled-recovery-cancel-race','scheduled-unwind-retirement-quiescence',
    'pipeline-defer-registration','pipeline-recover-registration','pipeline-arity-rejection'])
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
  assert.equal(fixtures.length,7);
  assert.equal(new Set(fixtures.map(f=>f.path)).size,fixtures.length);
  for(const f of fixtures){
    assert.match(f.path,/^fixtures\/execution-context-unwind-v1\/[a-z-]+\.atto$/);
    const b=readFileSync(new URL('../'+f.path,import.meta.url));
    const blob=createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
    assert.equal(blob,f.git_blob_sha);
    assert.ok(registry.cases.some(c=>c.id===f.case_id));
    assert.ok(['return','panic','compile-reject'].includes(f.expected.kind));
    if (f.expected.kind==='compile-reject') assert.equal(registry.cases.find(c=>c.id===f.case_id).group,'compile-reject');
    if (typeof f.expected.stdout==='string') assert.deepEqual(f.expected.stdout.trimEnd().split('\n'),registry.cases.find(c=>c.id===f.case_id).expected_trace);
  }
});

test('scheduled JS host receipts never certify scheduler unwind guest parity',()=>{
  const h=registry.scheduled_js_host_candidate;
  assert.equal(h.pr,'https://github.com/atto-lang/atto-source.js/pull/229');
  for(const k of ['source_head','source_blob_sha','scheduler_blob_sha'])assert.match(h[k],/^[a-f0-9]{40}$/);
  assert.equal(h.isolate_test_callbacks_passed,54);
  assert.equal(h.guest_level_verification,'not_executed');
  assert.match(h.limitation,/retirement/);
  for(const id of ['scheduled-unwind-next-turn','scheduled-unwind-duplicate-completion','scheduled-recovery-cancel-race','scheduled-unwind-retirement-quiescence']) {
    const x=registry.cases.find(c=>c.id===id);
    assert.equal(x.overall_status,'not_executed');
    assert.deepEqual(Object.values(x.backend_statuses),expected_backends.map(()=> 'not_executed'));
  }
});

test('historical exact candidate receipts bind source, compiler revision and observed fixture outcome',()=>{
  const receipts=registry.exact_pipeline_candidate_receipts;
  assert.equal(receipts.length,3);
  const ids=new Set();
  for(const receipt of receipts){
    assert.ok(expected_backends.includes(receipt.backend));
    for(const k of ['compiler_head','compiler_tree','fixture_registry_head','fixture_registry_tree'])assert.match(receipt[k],/^[a-f0-9]{40}$/);
    assert.match(receipt.job,/^https:\/\/github\.com\/file-tunnel\/atto-ci\/actions\/runs\/[0-9]+\/job\/[0-9]+$/);
    assert.ok(receipt.limitation.includes('current-main'));
    for(const r of receipt.results){
      const key=receipt.backend+'/'+receipt.compiler_head+'/'+r.case_id;
      assert.ok(!ids.has(key));ids.add(key);
      const fixture=registry.candidate_guest_fixtures.find(f=>f.case_id===r.case_id);
      assert.ok(fixture);
      assert.equal(r.source_blob,fixture.git_blob_sha);
      assert.deepEqual(r.observed,fixture.expected);
      if(r.observed.kind==='compile-reject')assert.equal(r.artifact_emitted,false);
      if(receipt.backend==='atto-source.rs' && r.observed.kind==='return'){
        assert.equal(r.byte_identical,true);
        assert.match(r.guest_sha256,/^[a-f0-9]{64}$/);
      }
      // Historical evidence does not silently promote the current matrix.
      assert.equal(registry.cases.find(c=>c.id===r.case_id).backend_statuses[receipt.backend],'not_executed');
    }
    if(receipt.backend==='atto-source.rs'){
      assert.deepEqual(receipt.profiles,['native-compiler','wasm32-compiler-in-node']);
      assert.match(receipt.compiler_wasm_sha256,/^[a-f0-9]{64}$/);
      assert.equal(receipt.results.length,3);
    }else{
      assert.deepEqual(receipt.profiles,['graalvm-jvm']);
      assert.equal(receipt.results.length,2);
    }
  }
  assert.equal(ids.size,8);
  const rust=receipts.filter(r=>r.backend==='atto-source.rs');
  assert.equal(rust.length,2);
  assert.notEqual(rust[0].compiler_head,rust[1].compiler_head);
  assert.notEqual(rust[0].compiler_wasm_sha256,rust[1].compiler_wasm_sha256);
  assert.deepEqual(rust[0].results,rust[1].results);
});
