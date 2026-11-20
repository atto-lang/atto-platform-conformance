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
  assert.ok(ledger.exclusions.includes('zero-step Actions runs'));
});
