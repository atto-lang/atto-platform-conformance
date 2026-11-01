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
    if (c.phase === 'runtime' && result.native_guest_executed !== true)
      fail(id + ': native compiled guest execution required');
    if (c.phase === 'compile-reject' &&
      (result.compiler_rejected !== true || typeof result.diagnostic_code !== 'string' ||
       !/^E_[A-Z0-9_]+$/.test(result.diagnostic_code)))
      fail(id + ': actual compiler rejection with diagnostic required');
    if (c.phase === 'compile-pass' && result.compiler_accepted !== true)
      fail(id + ': actual compiler acceptance required');
  }
  return Object.freeze({ classification: 'ONE_BACKEND_RECORD_CONSISTENT_UNATTESTED',
    backend: receipt.backend, cases: expected.size });
}
