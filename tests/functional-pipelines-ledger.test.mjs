// Host-only evidence-ledger integrity, NOT guest execution or parser proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ledger = JSON.parse(await readFile(
  new URL('../contracts/functional-pipelines-v1/ledger.json', import.meta.url), 'utf8'));
const sha = /^[a-f0-9]{40}$/;
const statuses = new Set(['not_executed', 'passed', 'failed', 'unsupported']);

test('source identity and nonvacuous dual-direction fixtures', () => {
  assert.equal(ledger.schema, 'atto.functional-pipelines.evidence.v1');
  assert.equal(ledger.authority.repo, 'atto-lang/atto-spec');
  assert.match(ledger.authority.head_sha, sha);
  assert.match(ledger.authority.contract_blob_sha, sha);
  assert.equal(ledger.cases.length, 8);
  const names = ledger.cases.map(c => c.file);
  assert.equal(new Set(names).size, names.length);
  for (const c of ledger.cases) {
    assert.ok(c.file.startsWith('conformance/functional-pipelines-v1/'));
    assert.match(c.blob_sha, sha);
  }
  const positives = ledger.cases.filter(c => c.kind === 'positive');
  assert.deepEqual(positives.map(c => c.expected_main_value), [83, 83, 42, 42]);
  assert.deepEqual(ledger.acceptance.positive_main_values, [83, 83, 42, 42]);
  assert.deepEqual(ledger.acceptance.guest_result_profiles,
    ['os_exit_code','stdout_line_i64','wasm_export_i64']);
  const negatives = ledger.cases.filter(c => c.kind === 'negative');
  assert.equal(negatives.length, 4);
  assert.ok(negatives.every(c => ['type','syntax'].includes(c.expected_rejection)
      && c.no_guest_artifact === true));
});

test('every backend must carry independent genuine execution evidence', () => {
  const targets = Object.entries(ledger.backend_states);
  assert.ok(targets.length >= 12);
  for (const [name, row] of targets) {
    assert.match(name, /^[a-z0-9-]+$/);
    assert.match(row.repo, /^atto-lang\/atto-source\.[a-z]+$|^atto-lang\/atto-lang\.github\.io$/);
    assert.ok(statuses.has(row.execution_status), name);
    if (row.proposed_head_sha != null) assert.match(row.proposed_head_sha, sha, name);
    if (row.implementation === 'code_authored') assert.ok(row.implementation_pr, name);
    if (row.local_execution) {
      // Local execution may support auditability but is NEVER CI promotion.
      assert.equal(row.execution_status, 'not_executed', name);
      assert.equal(row.receipt, null, name);
      assert.equal(row.local_execution.status, 'executed_locally_not_ci_admitted');
      assert.match(row.local_execution.compiler_blob_sha, sha);
      assert.match(row.local_execution.tests_blob_sha, sha);
      assert.deepEqual(row.local_execution.guest_main_values, [83,83,42,42]);
      assert.equal(row.local_execution.guest_artifact_sha256.length, 4);
      for (const hash of row.local_execution.guest_artifact_sha256)
        assert.match(hash, /^[a-f0-9]{64}$/);
      assert.ok(row.local_execution.executed_test_groups > 0);
      assert.equal(row.local_execution.failing_test_groups, 0);
      if (name === 'java-scalar-bootstrap') {
        const local = row.local_execution;
        assert.equal(row.result_profile, 'os_exit_code');
        assert.deepEqual(local.observed_process_exit, [83,83,42,42]);
        assert.deepEqual(local.observed_guest_stdout, ['', '', '', '']);
        assert.equal(local.canonical_negative_no_output_artifact, true);
        assert.equal(local.extended_negative_cases, 11);
        assert.equal(local.extended_negative_no_output_artifact, true);
        assert.equal(local.i64_min_observed, '-9223372036854775808');
        assert.match(local.i64_min_input_blob_sha, sha);
        assert.match(local.i64_underflow_input_blob_sha, sha);
        assert.deepEqual(local.signed_underflow_rejection,
          {exit:2,diagnostic:'E_LITERAL',artifact_exists:false});
        assert.match(local.scope, /CI remain unexecuted/);
        assert.match(local.tests_blob_role, /not itself executed locally/);
      }
      if (name === 'forge') {
        const local = row.local_execution;
        assert.match(local.checked_i64_runtime_blob_sha, sha);
        assert.deepEqual(local.observed_guest_stdout, ['83\n','83\n','42\n','42\n']);
        assert.deepEqual(local.observed_process_exit, [0,0,0,0]);
        assert.equal(local.canonical_negative_no_output_artifact, true);
        assert.deepEqual(local.canonical_negative_results,
          ['E_TYPE','E_PARSE','E_MIXED_PIPE','E_MIXED_PIPE']);
        assert.equal(local.i64_min_observed, '-9223372036854775808');
        assert.deepEqual(local.checked_overflow_observed,
          {exit:70,stderr:'E_OVERFLOW\n'});
        assert.ok(local.sanitizer_observed);
        assert.deepEqual(local.sanitizer_observed.toolchains, ['g++','clang++']);
        for (const compiler of local.sanitizer_observed.toolchains) {
          const digests = local.guest_artifact_sha256_by_toolchain[compiler];
          assert.equal(digests.length, ledger.cases.filter(c => c.kind === 'positive').length);
          for (const digest of digests) assert.match(digest, /^[a-f0-9]{64}$/);
        }
        // This data is explicitly NOT a source-org Actions receipt.
        assert.match(local.scope, /CI unexecuted/);
      }
    }

    assert.ok(row.result_profile === null ||
      ledger.acceptance.guest_result_profiles.includes(row.result_profile), name);
    if (name === 'forge' || name === 'cranelift')
      assert.equal(row.result_profile, 'stdout_line_i64');
    if (row.execution_status === 'passed') {
      const receipt = row.receipt;
      assert.ok(receipt && typeof receipt === 'object', name);
      assert.ok(receipt.executed_step_count >= 1, name);
      assert.equal(receipt.real_guest, true, name);
      assert.match(receipt.compiler_head_sha, sha);
      assert.match(receipt.compiler_tree_sha, sha);
      assert.match(receipt.ci_run_url, /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/[0-9]+$/);
      assert.ok(receipt.command && typeof receipt.command === 'string', name);
      assert.ok(receipt.toolchain && typeof receipt.toolchain === 'string', name);
      assert.ok(ledger.acceptance.guest_result_profiles.includes(receipt.result_profile),
        name + ': missing actual guest ABI proof');
      if (row.result_profile !== null)
        assert.equal(receipt.result_profile, row.result_profile, name);
      assert.equal(receipt.case_results?.length, ledger.cases.length, name);
      const results = new Map(receipt.case_results.map(c => [c.file, c]));
      assert.equal(results.size, ledger.cases.length, name);
      for (const sourceCase of ledger.cases) {
        const evidence = results.get(sourceCase.file);
        assert.ok(evidence, name + ': missing ' + sourceCase.file);
        assert.equal(evidence.source_fixture_blob_sha, sourceCase.blob_sha);
        if (sourceCase.kind === 'positive') {
          assert.equal(evidence.guest_executed, true);
          assert.match(evidence.guest_emission_sha256, /^[a-f0-9]{64}$/);
          assert.ok(['native_binary', 'wasm_binary', 'jit_ir', 'cxx_source',
            'clr_assembly'].includes(evidence.emission_kind));
          assert.equal(evidence.observed_main_value, sourceCase.expected_main_value);
          if (receipt.result_profile === 'os_exit_code') {
            assert.equal(evidence.observed_process_exit, sourceCase.expected_main_value);
            assert.equal(evidence.observed_stdout, '');
          } else if (receipt.result_profile === 'stdout_line_i64') {
            assert.equal(evidence.observed_process_exit, 0);
            assert.equal(evidence.observed_stdout, sourceCase.expected_main_value + '\n');
          } else {
            assert.equal(receipt.result_profile, 'wasm_export_i64');
            assert.equal(evidence.observed_export_return, sourceCase.expected_main_value);
            assert.equal(evidence.observed_stdout, '');
          }
        } else {
          assert.equal(evidence.observed_rejection, sourceCase.expected_rejection);
          assert.equal(evidence.artifact_exists, false);
        }
      }
    } else {
      assert.equal(row.receipt, null, 'unexecuted/failed/unsupported status may not carry pass evidence: ' + name);
    }
  }
  assert.equal(ledger.formatter.verification_status, 'not_executed');
  assert.equal(ledger.formatter.receipt, null);
  assert.match(ledger.formatter.proposed_head_sha, sha);
  const fmt = ledger.formatter.local_v8_smoke;
  assert.match(fmt.source_blob_sha, sha);
  assert.match(fmt.test_blob_sha, sha);
  assert.equal(fmt.executed_cases, 31);
  assert.equal(fmt.failed_cases, 0);
  assert.equal(fmt.idempotent, true);
  assert.equal(fmt.multiarg_grouped_reverse_preserved, true);
  assert.match(fmt.scope, /GitHub Actions not executed/);
  // Formatter function execution proves normalization, not guest execution,
  // and must never upgrade the backend/formatter CI admission status.
  assert.ok(ledger.exclusions.includes('zero-step Actions runs'));
});


test('seven supplemental edge fixtures require per-backend execution, not authored test files', () => {
  const edge=ledger.edge_contract;
  assert.equal(edge.schema,'atto.functional-pipelines.edge.evidence.v1');
  assert.match(edge.authority_head_sha,sha);
  assert.match(edge.manifest_blob_sha,sha);
  assert.match(edge.relationship,/original 8 canonical cases remain unchanged/);
  assert.equal(ledger.cases.length,8,'supplemental fixture addition must not drop core cases');
  assert.deepEqual(edge.cases.map(c=>c.expected),[
    '61','42','-9223372036854775808',
    'runtime_checked_overflow','source_rejection','source_rejection','source_rejection'
  ]);
  assert.equal(edge.cases.length,7);
  assert.equal(new Set(edge.cases.map(c=>c.file)).size,7);
  for(const c of edge.cases){
    assert.match(c.file,/^[a-z0-9-]+\.atto$/);
    assert.match(c.blob_sha,sha);
  }
  const expected=[
    'rs-browser-wasm-compiler','rs-native-compiler','llvm-rust-aot','net-direct-cil',
    'java-scalar-bootstrap','forge','cranelift','js-compiled-esm'
  ];
  assert.deepEqual(Object.keys(edge.targets).sort(),expected.sort());
  for(const [backend,row]of Object.entries(edge.targets)){
    assert.equal(row.implementation_repo,ledger.backend_states[backend].repo);
    assert.match(row.proposed_head_sha,sha);
    assert.equal(row.proposed_head_sha,ledger.backend_states[backend].proposed_head_sha);
    assert.equal(row.tests_authored,true);
    assert.equal(row.fixture_files_copied_and_blob_verified,7);
    if (['rs-browser-wasm-compiler','rs-native-compiler','llvm-rust-aot'].includes(backend)) {
      assert.equal(row.full_signed_i64_test_authored,true);
      assert.equal(row.checked_overflow_guest_test_authored,true);
      assert.equal(row.three_fail_closed_source_tests_authored,true);
      assert.deepEqual(row.reserved_authority_keyword_negative_tests,
        ['unsafe','sync','task','pipe','rpipe']);
    }
    if (backend === 'rs-native-compiler')
      assert.match(row.conditional_compiler_check, /ATTOC/);
    if (['js-compiled-esm','forge','cranelift','net-direct-cil','java-scalar-bootstrap'].includes(backend)) {
      assert.equal(row.reserved_task_sync_yield_rejection_tests_authored,9);
      assert.equal(row.reserved_task_sync_yield_test_executed,false);
    }
    assert.equal(row.execution_status,'not_executed');
    assert.equal(row.receipt,null);
  }
  const admission=edge.runner_admission_observation;
  assert.equal(admission.status,'no_jobs_executed');
  assert.equal(admission.tested_carrier_execution_confirmed,false);
  assert.equal(admission.source_repository_runs.length,4);
  assert.ok(admission.source_repository_runs.every(r=>r.executed_steps===0));
  assert.ok(admission.alternate_carriers_checked.length>=8);
  assert.match(admission.disposition,/Do not mirror private source trees/);
  assert.equal(admission.fresh_canary_runs.length,8);
  assert.equal(new Set(admission.fresh_canary_runs.map(r=>r.repo)).size,8);
  for (const canary of admission.fresh_canary_runs) {
    assert.ok(admission.alternate_carriers_checked.includes(canary.repo));
    assert.ok(canary.run_id > 0);
    assert.equal(canary.job_conclusion,'failure');
    assert.equal(canary.executed_steps,0);
    assert.equal(canary.runner_assigned,false);
    assert.match(canary.kind,/no checkout/);
  }
  assert.ok(admission.possible_causes_not_verified.includes('billing/minutes'));
  assert.equal(edge.overall_execution_status,'not_executed');
  assert.equal(edge.guest_result_abi_must_be_recorded_separately,true);
  const llvmProbe=edge.local_llvm_adapter_abi_probe;
  assert.equal(llvmProbe.status,'test_adapter_syntax_verified_not_compiler_guest');
  assert.equal(llvmProbe.expected_and_observed_stdout,'-9223372036854775808\n');
  assert.equal(llvmProbe.exit_code,0);
  assert.match(llvmProbe.source_provenance, /NOT compiled from \.atto/);
  const smoke=edge.local_v8_smoke;
  assert.equal(smoke.status,'actual_generated_js_executed_in_process_no_Node_CI_admission');
  assert.match(smoke.compiler_blob_sha,sha);
  assert.equal(smoke.input_blobs_verified,15);
  assert.equal(smoke.executed_generated_guest_cases,7);
  assert.equal(smoke.executed_guest_runtime_traps,1);
  assert.equal(smoke.admission_rejections,16);
  assert.deepEqual(smoke.compiled_guest_values,
    ['83','83','42','42','61','42','-9223372036854775808']);
  assert.equal(smoke.compiled_overflow_observed,'E_OVERFLOW');
  assert.deepEqual(smoke.source_rejections,
    ['E_TYPE','E_PARSE','E_MIXED_PIPE','E_MIXED_PIPE','E_LITERAL','E_LITERAL','E_NAME']);
  assert.deepEqual(smoke.reserved_binding_rejections,
    ['sync/fnc','sync/param','sync/local','task/fnc','task/param','task/local','yield/fnc','yield/param','yield/local']);
  assert.match(smoke.scope,/not GitHub Actions/);
  const jsLocal=ledger.backend_states['js-compiled-esm'].local_execution;
  assert.equal(jsLocal.source_changed_since_local_Node_observation,true);
  assert.notEqual(jsLocal.compiler_blob_sha,jsLocal.current_compiler_blob_sha);
  assert.equal(jsLocal.current_compiler_blob_sha,smoke.compiler_blob_sha);
  assert.equal(ledger.backend_states.forge.local_execution.source_changed_since_local_observation,true);
  // A changed Java compiler may not inherit a prior unrelated local receipt.
  assert.equal(ledger.backend_states['java-scalar-bootstrap']
    .local_execution.source_changed_since_local_observation,true);
  assert.notEqual(ledger.backend_states['java-scalar-bootstrap']
    .local_execution.observed_compiler_blob_sha,
    ledger.backend_states['java-scalar-bootstrap'].local_execution.current_compiler_blob_sha);
  assert.equal(ledger.backend_states['js-compiled-esm']
    .local_execution.new_test_script_not_yet_run_in_Node,true);
});

test('new Linux publication and JS V8 smoke cannot masquerade as compiled CI guest receipts', () => {
  const forge = ledger.backend_states.forge;
  assert.equal(forge.execution_status,'not_executed');
  assert.equal(forge.receipt,null);
  const p=forge.local_publication_probe;
  assert.equal(p.status,'local_exact_syscall_logic_executed_no_full_forge_guest_on_new_head');
  assert.match(p.compiler_blob_sha,sha);
  assert.match(p.authored_script_blob_sha,sha);
  assert.equal(p.source_head,forge.proposed_head_sha);
  assert.equal(p.test_script_git_sha_verified_locally,true);
  assert.equal(p.adversarial_competing_processes,16);
  assert.equal(p.winning_publishers,1);
  assert.equal(p.losing_publishers,15);
  assert.equal(p.syscall_logic_additional_concurrent_writers,24);
  assert.equal(p.syscall_logic_additional_winners,1);
  assert.equal(p.source_mode,'0600');
  assert.equal(p.no_overwrite_regular,true);
  assert.equal(p.no_overwrite_symlink,true);
  assert.equal(p.no_named_temporary_publication,true);
  assert.equal(p.exact_head_full_forge_compile_run,false);
  assert.match(p.smoke_gate_executed_against,/stand-in Forge CLI/);
  assert.equal(Object.keys(p.smoke_gate_cases).length,4);
  assert.ok(Object.values(p.smoke_gate_cases).every(s=>s==='passed'));
  const js=ledger.backend_states['js-compiled-esm'];
  assert.equal(js.execution_status,'not_executed');
  assert.equal(js.receipt,null);
  const v=js.local_full_fixtures_v8;
  assert.match(v.compiler_blob_sha,sha);
  assert.equal(v.fixture_git_blobs_verified,15);
  assert.equal(v.compiled_function_executions,7);
  assert.equal(v.checked_overflow_runtime_traps,1);
  assert.equal(v.invalid_source_fail_closed,7);
  assert.equal(v.passed,15);
  assert.equal(v.failed,0);
  assert.deepEqual(v.observed_values,
    ['83','83','42','42','61','42','-9223372036854775808']);
  assert.match(v.scope,/in-process rather than Node ESM\/CLI or CI runner/);
  assert.equal(forge.local_execution.source_changed_since_local_observation,true);
});
