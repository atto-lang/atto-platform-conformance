// SOURCE_ONLY contract integrity. No Atto guest or compiler was run here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const doc=JSON.parse(readFileSync(new URL('../contracts/pointer-local-candidate-evidence-v1.json',import.meta.url),'utf8'));
const cases=JSON.parse(readFileSync(new URL('../contracts/pointer-ref-local-v1.json',import.meta.url),'utf8'));
const known={
  'atto-source.rs':{pr:419,sha:'00a6d3e8a86e27f635cf3b2a808b6a0b61a2b977'},
  'atto-source.llvm':{pr:64,sha:'b4049c77c71f6834a93f294c129779bfaf3ec1f1'},
  'atto-source.net':{pr:22,sha:'fa732820a0f0bc3de2c7422efd06ad365518fde1'},
  'atto-source.forge':{pr:50,sha:'bdbd253abc71c3631cf0d5b3e5922a5b58155936'},
};
test('candidate ledger keeps actual source commits distinct from executed evidence',()=>{
  assert.equal(doc.schema,'atto.pointer-local-candidate-evidence.v1');
  assert.equal(doc.normative_spec,'atto-lang/atto-spec#18');
  assert.equal(doc.overall_status,'NOT_EXECUTED');
  assert.equal(doc.target_case_registry,'contracts/pointer-ref-local-v1.json');
  assert.equal(doc.candidate_count,4);
  assert.equal(doc.candidates.length,4);
  assert.equal(new Set(doc.candidates.map(c=>c.backend)).size,4);
  assert.equal(Object.keys(known).length,4);
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
    assert.ok(['CANDIDATE_COMMITTED','MAINLINE_CANDIDATE_COMMITTED'].includes(c.source_state));
    assert.equal(c.execution_status,'NOT_EXECUTED');
    assert.equal(c.compiler_artifact_sha256,null);
    assert.equal(c.guest_artifact_sha256,null);
    assert.equal(c.runner_job_id,null);
    assert.equal(c.executed_step_count,0);
    if (c.backend === 'atto-source.forge') {
      assert.equal(c.compiler_subtree,'151c08add7df9db670033b27bcefdba36f61753b');
      assert.equal(c.target_run_contract.compiler,'forge_scalar');
      assert.equal(c.target_run_contract.native_guest_count,4);
      assert.equal(c.target_run_contract.negative_no_artifact_count,24);
      assert.equal(c.target_run_contract.process_exit_status,0);
      assert.equal(c.target_run_contract.full_abi_parity,false);
      assert.deepEqual(c.exact_canonical_guest_sources,{
        'PRL-001':'6056400afa8d7b9b71f29be5ca4cfb15240a59b3',
        'PRL-002':'8fa66e68b386c2c6d1f2b15b9399e70a116c0828'
      });
      assert.equal(c.execution_status,'NOT_EXECUTED');
      assert.equal(c.executed_step_count,0);
      const carrier=c.token_free_carrier;
      assert.equal(carrier.repository,'gha-indie-worker/atto-ci');
      assert.equal(carrier.source_commit,c.source_head);
      assert.equal(carrier.source_git_tree,'2d95af6aa96776553cee0d0fa5cc4163618a1a24');
      assert.equal(carrier.carrier_mirror_git_tree,carrier.source_git_tree);
      assert.equal(carrier.exact_mirror_source_blob_count,80);
      assert.equal(carrier.mirror_verified,true);
      assert.equal(carrier.cross_organization_checkout_token_used,false);
      assert.deepEqual(carrier.job_executed_steps,[0,0]);
      assert.equal(carrier.status,'FAILED_BEFORE_JOB_STEPS');
      assert.equal(carrier.full_CTest_executed,false);
      assert.equal(carrier.artifact_sha256,null);
      const local=c.local_compiled_guest_subset;
      assert.equal(local.status,'PASS_LOCAL_SUBSET_NOT_FULL_CONFORMANCE');
      assert.equal(local.tested_source_commit,c.source_head);
      assert.equal(local.cxx_variants.length,2);
      assert.deepEqual(local.cxx_variants.map(v=>v.positive_native_guest_executions),[4,4]);
      assert.deepEqual(local.cxx_variants.map(v=>v.negative_no_artifact_rejections),[24,24]);
      assert.equal(local.canonical_rt_and_bang_emitted_cpp_sha256,'088b8c56d2d2cd87b56c99b33dd423038f7929a859465ebd55c7b29e3acd31d6');
      assert.equal(local.exact_cli_blob,'36f9380be4597771ad6d2b1aa64bc567f62995f1');
      assert.equal(local.exact_test_runner_blob,'dcb8ae2c808281daa4358352be37a75b95636f37');
      assert.equal(local.verified_blob_count,36);
      assert.equal(local.current_head_cmake_pointer_guests,'PASS_GCC_AND_CLANG_LOCAL');
      assert.deepEqual(local.cxx_variants.map(v=>v.negative_existing_output_preservation),[24,24]);
      assert.deepEqual(local.cxx_variants.map(v=>v.legacy_scalar_native_guests),[8,8]);
      assert.deepEqual(local.aggregate_scoped_local_results,{
        positive_guest_executions:8,
        negative_reject_fresh_no_artifact:48,
        negative_reject_existing_preserved:48,
        scalar_native_regressions:16,
        typed_ir_test_executables:2,
        verified_source_git_blobs:36
      });
      assert.match(local.local_json_receipt_sha256,/^[a-f0-9]{64}$/);
      assert.equal(local.public_evidence_pr_comment,'https://github.com/atto-lang/atto-source.forge/pull/50#issuecomment-7031779263');
      assert.equal(c.prior_local_compiled_guest_subset.tested_source_commit,'60e667238f943e4b6b47c0e4d0f603ad2b440ef5');
      assert.equal(local.full_existing_ctest_suite,'NOT_EXECUTED');
      assert.equal(local.full_36_case_matrix,'NOT_EXECUTED');
      assert.equal(local.github_actions_executed_steps,0);
      assert.equal(local.github_actions_artifact_certification,false);
      assert.equal(local.full_process_result_abi_parity,false);
      assert.equal(c.execution_status,'NOT_EXECUTED','local subset must not certify whole matrix');
      assert.equal(c.guest_exit_receipt,null);
    }

    if (c.backend === 'atto-source.rs') {
      const mirror=c.token_free_carrier;
      assert.equal(mirror.repository,'gha-indie-worker/atto-ci');
      assert.equal(mirror.upstream_commit,c.source_head);
      assert.equal(mirror.upstream_compiler_src_tree,c.compiler_subtree);
      assert.equal(mirror.upstream_compiler_src_tree,'274523e1adffc85c4f86c84e1983917ff089d4e0');
      assert.equal(mirror.source_tree_matches,true,'Git tree identity is source-only proof');
      assert.match(mirror.carrier_commit,/^[0-9a-f]{40}$/);
      assert.equal(mirror.cargo_toml_blob,'7bcb27474e87c1f05d6f96acf8a6a6c75ac4bcef');
      assert.equal(mirror.cargo_lock_blob,'387853d3838d48e0c89d77fbecfcd41d53fbd4ca');
      assert.equal(mirror.exact_prl_001_blob,c.exact_canonical_guest_sources['PRL-001']);
      assert.equal(mirror.exact_prl_002_blob,c.exact_canonical_guest_sources['PRL-002']);
      assert.match(mirror.run_url,/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/);
      assert.equal(mirror.latest_run_attempt,2);
      assert.equal(mirror.executed_steps,0,'not permitted to claim compiled guest proof');
      assert.equal(mirror.admission,'FAILED_ZERO_STEPS');
      assert.equal(mirror.compiler_executable_sha256,null);
      assert.equal(mirror.guest_wasm_sha256,null);
    }

    assert.equal(c.guest_exit_receipt,null);
    assert.equal(c.negative_rejection_receipt,null);
    assert.equal(c.independent_approval,null);
    assert.deepEqual(c.expected_guest_ids,['PRL-001','PRL-002']);
    assert.ok(c.test_entry.length>5);
    assert.ok(c.scope.includes('Pointer<int>')||c.scope.includes('BorrowedLocalIntPlan'));
    if(c.last_attempted_ci_run!==null) assert.match(c.last_attempted_ci_run,/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/);
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
