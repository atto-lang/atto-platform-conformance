// SOURCE_ONLY contract integrity. No Atto guest or compiler was run here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const doc=JSON.parse(readFileSync(new URL('../contracts/pointer-local-candidate-evidence-v1.json',import.meta.url),'utf8'));
const cases=JSON.parse(readFileSync(new URL('../contracts/pointer-ref-local-v1.json',import.meta.url),'utf8'));
const known={
  'atto-source.rs':{pr:264,sha:'56356874cb2da41fcd7a4cf61994aa08e9ef5a85'},
  'atto-source.llvm':{pr:64,sha:'b4049c77c71f6834a93f294c129779bfaf3ec1f1'},
  'atto-source.net':{pr:22,sha:'fa732820a0f0bc3de2c7422efd06ad365518fde1'},
};
test('candidate ledger keeps actual source commits distinct from executed evidence',()=>{
  assert.equal(doc.schema,'atto.pointer-local-candidate-evidence.v1');
  assert.equal(doc.normative_spec,'atto-lang/atto-spec#18');
  assert.equal(doc.overall_status,'NOT_EXECUTED');
  assert.equal(doc.target_case_registry,'contracts/pointer-ref-local-v1.json');
  assert.equal(doc.candidate_count,3);
  assert.equal(doc.candidates.length,3);
  assert.equal(new Set(doc.candidates.map(c=>c.backend)).size,3);
  assert.equal(Object.keys(known).length,3);
  assert.equal(doc.backend_count,Object.keys(cases.backend_status).length);
  assert.equal(doc.total_target_cases,cases.case_count);
  assert.equal(doc.expected_positive,cases.pass_count);
  assert.equal(doc.expected_negative,cases.reject_count);
  for(const c of doc.candidates){
    const expected=known[c.backend];
    assert.ok(expected,'unreviewed new backend candidate '+c.backend);
    assert.equal(c.repository,'atto-lang/'+c.backend);
    assert.equal(c.pr,expected.pr);
    assert.equal(c.source_head,expected.sha);
    assert.match(c.source_head,/^[a-f0-9]{40}$/);
    assert.equal(c.source_state,'CANDIDATE_COMMITTED');
    assert.equal(c.execution_status,'NOT_EXECUTED');
    assert.equal(c.compiler_artifact_sha256,null);
    assert.equal(c.guest_artifact_sha256,null);
    assert.equal(c.runner_job_id,null);
    assert.equal(c.executed_step_count,0);
    assert.equal(c.guest_exit_receipt,null);
    assert.equal(c.negative_rejection_receipt,null);
    assert.equal(c.independent_approval,null);
    assert.deepEqual(c.expected_guest_ids,['PRL-001','PRL-002']);
    assert.ok(c.test_entry.length>5);
    assert.ok(c.scope.includes('Pointer<int>')||c.scope.includes('BorrowedLocalIntPlan'));
    assert.match(c.last_attempted_ci_run,/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/);
    assert.equal(cases.backend_status[c.backend].status,'NOT_EXECUTED');
    assert.equal(cases.backend_status[c.backend].runner,null);
  }
});
test('no backend can inherit a PASS from a host-only candidate or zero-step failure',()=>{
  for(const v of Object.values(cases.backend_status))
    assert.equal(v.status,'NOT_EXECUTED');
  assert.ok(doc.required.includes('nonzero real job steps'));
  assert.ok(doc.required.includes('no-artifact negatives'));
  assert.equal(cases.status,'TARGET_ONLY_NOT_EXECUTED');
});
