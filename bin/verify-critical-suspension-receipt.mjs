// Offline receipt consistency only. It does NOT authenticate CI or establish parity.
export function verifyCriticalSuspensionReceipt(receipt, contract) {
  const fail = message => { throw new Error(message); };
  const sha = /^[0-9a-f]{40}$/;
  const digest = /^[0-9a-f]{64}$/;
  if (contract?.schema !== 'oreslang.critical-suspension.contract/1') fail('invalid contract schema');
  if (receipt?.schema !== 'oreslang.critical-suspension.receipt/1') fail('invalid receipt schema');
  if (!contract.target_backends.includes(receipt.backend)) fail('unknown backend');
  if (!sha.test(receipt.source_commit_sha)) fail('source_commit_sha must be a full SHA');
  if (!sha.test(receipt.source_tree_sha)) fail('source_tree_sha must be a full SHA');
  if (!sha.test(receipt.fixture_tree_sha)) fail('fixture_tree_sha must be a full SHA');
  if (!digest.test(receipt.compiler_sha256)) fail('compiler_sha256 must be a full digest');
  if (receipt.exact_tree_verified !== true) fail('exact-tree verification required');
  if (!Number.isSafeInteger(receipt.executed_steps) || receipt.executed_steps < 1)
    fail('at least one executed CI step is required');
  if (!Number.isSafeInteger(receipt.runner_id) || receipt.runner_id < 1)
    fail('real runner ID required, not zero-step admission');
  // Require resolvable GitHub Actions identities and a pinned test plan.
  // Format consistency is NOT remote attestation.
  for (const key of ['run_id', 'job_id', 'run_attempt']) {
    if (!Number.isSafeInteger(receipt[key]) || receipt[key] < 1)
      fail(key + ': positive GitHub Actions identity required');
  }
  if (!digest.test(receipt.test_plan_sha256))
    fail('test_plan_sha256 required for reproducible compiler/guest plan');
  if (receipt.runner_admission_only !== false) fail('runner-admission-only not evidence');
  if (receipt.compiler_invoked !== true) fail('real compiler invocation required');
  if (receipt.cross_backend_parity !== false) fail('single receipt cannot claim cross-backend parity');
  const expected = new Map(contract.cases.map(c => [c.id, c]));
  if (!receipt.cases || Object.keys(receipt.cases).length !== expected.size)
    fail('complete exact case set required');
  for (const [id, c] of expected) {
    const result = receipt.cases[id];
    if (!result || result.phase !== c.phase || result.status !== 'pass')
      fail(id + ': missing, mismatched, or failed case');
    // No host or compiler-only case may impersonate a native executable.
    if ((c.phase !== 'runtime' &&
         (result.native_guest_executed === true || result.guest_executed === true)) ||
        (c.phase === 'runtime' && result.host_test_executed === true) ||
        (c.phase === 'compile-reject' && result.compiler_accepted === true) ||
        (c.phase === 'compile-pass' && result.compiler_rejected === true))
      fail(id + ': contradictory evidence phase');
    if (c.phase === 'runtime' &&
        (result.native_guest_executed !== true ||
         result.guest_mode !== 'COMPILED_NATIVE_EXECUTABLE' ||
         !digest.test(result.guest_executable_sha256) ||
         result.compiler_accepted !== true ||
         result.exit_code !== 0 || result.timed_out !== false ||
         result.signal !== null))
      fail(id + ': native compiled guest execution and executable identity required');
    if (c.phase === 'compile-reject') {
      // Crashes, timeouts, emitted IR, and earlier unrelated diagnostics
      // are not valid target compiler rejections.
      const firstDiagnostic=typeof result.stderr === 'string'
        ? result.stderr.match(/\bE_[A-Z0-9_]+\b/)?.[0] : null;
      if (result.compiler_rejected !== true ||
          result.diagnostic_code !== c.expected_diagnostic ||
          firstDiagnostic !== c.expected_diagnostic ||
          !Number.isInteger(result.exit_code) || result.exit_code < 1 ||
          result.exit_code > 255 || result.timed_out !== false ||
          result.signal !== null || result.emitted_artifact !== false)
        fail(id + ': actual compiler rejection with EXACT expected diagnostic required');
    }
    if (c.phase === 'compile-pass' &&
        (result.compiler_accepted !== true || result.exit_code !== 0 ||
         result.timed_out !== false || result.signal !== null))
      fail(id + ': actual compiler acceptance with clean exit required');
  }
  return Object.freeze({ classification: 'ONE_BACKEND_RECORD_CONSISTENT_UNATTESTED',
    backend: receipt.backend, cases: expected.size });
}
