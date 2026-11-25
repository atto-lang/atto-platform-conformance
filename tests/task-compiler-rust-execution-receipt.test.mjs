import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => JSON.parse(readFileSync(new URL('../contracts/' + path, import.meta.url)));
const evidence = read('task-compiler-local-execution-20261120.json');
const registry = read('task-payload-sync-v1.json');

test('exact Rust compiler carrier receipt is stepful, blob pinned and profile restricted', () => {
  const rust = evidence.rust;
  assert.equal(rust.source_repo, 'atto-lang/atto-source.rs');
  assert.equal(rust.source_pr, 416);
  assert.equal(rust.source_pr_head, 'c3712257cabf6090adc0e227328ae1f487872f0e');
  assert.equal(rust.source_compiler_src_git_tree_sha, '3fbde653128781524cf4f0fb357180a2657624e9');
  assert.equal(rust.exact_source_git_blobs_verified, 71);
  assert.equal(rust.exact_source_git_blobs_total, 71);
  assert.equal(rust.job_steps_executed, true);
  assert.equal(rust.job_conclusion, 'success');
  assert.equal(rust.run_id, 44772469684);
  assert.equal(rust.carrier_private, true);
  assert.equal(rust.cross_org_checkout, false);
  assert.equal(rust.source_repo_secret_or_token, false);
  assert.deepEqual(rust.compiled_rust_host_and_compiler_library_tests, {
    passed: 118, total: 118, includes_host_task_lock_model_tests: 56
  });
  assert.deepEqual(rust.mutex_compiler_acceptance_tests, { passed: 12, total: 12 });
  assert.equal(rust.native_attoc_built, true);
  assert.equal(rust.strict_clippy_minus_d_warnings, 'PASS');
});

test('all 15 compiled mutex guest receipts have typed result checks and no artifacts on denial', () => {
  const receipt = evidence.rust.wasm_guest_receipt;
  assert.equal(receipt.profile, 'single_task_uncontended_only');
  assert.equal(receipt.pass, true);
  assert.match(receipt.compiler_binary_sha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.cases.length, 15);
  assert.equal(receipt.positive_executed, 7);
  assert.equal(receipt.negative_no_artifact_executed, 8);
  const positives = receipt.cases.filter(c => c.kind === 'real_compiled_wasm_guest');
  const negatives = receipt.cases.filter(c => c.kind === 'negative');
  for (const guest of positives) {
    assert.equal(guest.status, 'PASS', guest.id);
    assert.match(guest.wasm_sha256, /^[a-f0-9]{64}$/, guest.id);
    assert.ok(guest.wasm_bytes > 8, guest.id);
    assert.ok(Number.isInteger(guest.exit), guest.id);
  }
  for (const rejected of negatives) {
    assert.equal(rejected.status, 'PASS', rejected.id);
    assert.equal(rejected.guest_artifact, false, rejected.id);
    assert.match(rejected.diagnostic, /^E_[A-Z0-9_]+$/, rejected.id);
  }
});

test('Rust host state machine is not misreported as cancellable guest or TenantVM runtime parity', () => {
  const rust = evidence.rust;
  assert.equal(rust.task_cancel_guest_runtime, 'NOT_EXECUTED');
  assert.equal(rust.real_contended_mutex_async, 'NOT_EXECUTED');
  assert.equal(rust.tenantvm_quiescence_and_physical_retirement, 'NOT_EXECUTED');
  assert.equal(rust.all_ten_backend_canonical_runtime_cells, 'NOT_EXECUTED');
  assert.equal(registry.lock_cancellation_runtime_probes.length >= 17, true);
  assert.ok(Object.values(registry.backends).every(b =>
    b.status === 'NOT_EXECUTED' && b.release_qualified === false));
});
