// Read-only source identity / zero-step snapshot guard. NOT a CI attestation,
// native compiler invocation, guest receipt, or permission to mirror private code.
const SHA40 = /^[0-9a-f]{40}$/;
const REQUIRED = Object.freeze({
  'java-graal': ['ores-truffle-oreslang/oreslang-source.java', 2433],
  llvm: ['ores-truffle-oreslang/oreslang-source.llvm', 1289],
  'dotnet-nativeaot': ['ores-truffle-oreslang/oreslang-source.net', 320],
  cranelift: ['ores-truffle-oreslang/oreslang-source.forge', 168],
  wasm: ['ores-truffle-oreslang/oreslang-source.wasm', 258]
});
const error = message => { throw new Error(message); };
const exactly = (actual, expected, name) => {
  if (actual !== expected) error(name + ': unexpected value');
};
export function verifyCurrentHeadPreflight(plan, contract, fixtureManifest, history) {
  exactly(plan?.schema, 'oreslang.critical-suspends.current-head-preflight/1', 'schema');
  exactly(plan.classification, 'PREPARED_NOT_EXECUTED', 'preflight status');
  exactly(contract?.schema, 'oreslang.critical-suspension.contract/1', 'contract schema');
  exactly(plan.contract?.case_count, 34, 'contract case count');
  exactly(contract.cases.length, plan.contract.case_count, 'contract cases');
  exactly(plan.contract?.pr, 292, 'contract PR');
  exactly(plan.contract?.repository, 'ores-truffle-oreslang/oreslang-platform-conformance', 'contract repository');
  if (!SHA40.test(plan.contract.head_at_capture)) error('contract head not pinned');
  if (!Array.isArray(contract.target_backends) ||
      Object.keys(REQUIRED).length !== contract.target_backends.length ||
      contract.target_backends.some(x => !Object.hasOwn(REQUIRED, x)))
    error('backend mismatch with normative contract');
  if (!Array.isArray(plan.entries) || plan.entries.length !== 5)
    error('five distinct backend entries required');
  const seen = new Set();
  for (const entry of plan.entries) {
    const pair = REQUIRED[entry.backend];
    if (!pair || seen.has(entry.backend)) error('duplicate or unexpected backend');
    seen.add(entry.backend);
    exactly(entry.repository, pair[0], entry.backend + ' repository');
    exactly(entry.pr, pair[1], entry.backend + ' PR');
    if (!SHA40.test(entry.commit) || !SHA40.test(entry.tree))
      error(entry.backend + ' missing full commit/tree hash');
    if (!Number.isSafeInteger(entry.run_id) || entry.run_id < 1 ||
        !Number.isSafeInteger(entry.job_id) || entry.job_id < 1)
      error(entry.backend + ' missing job evidence identity');
    if (entry.executed_steps !== 0 || entry.phase !== 'NOT_EXECUTED' ||
        entry.compiler_invoked !== false || entry.guest_verified !== false)
      error(entry.backend + ' zero-step record cannot be promoted');
    if (!entry.required_stage || typeof entry.required_stage !== 'string')
      error(entry.backend + ' missing concrete next check');
    // Disallow synthetic positive receipts smuggled into this admission-only schema.
    for (const field of ['compiler_sha256', 'native_guest_executed', 'execution_pass',
                         'runner_admitted', 'cross_backend_parity', 'attested'])
      if (Object.hasOwn(entry, field)) error(entry.backend + ' unexpected evidence field: ' + field);
  }
  const java = plan.entries.find(x => x.backend === 'java-graal');
  exactly(plan.fixture?.manifest_path, 'evidence/critical-suspends-java-stage1-original-manifest-20261101.json', 'fixture path');
  if (!SHA40.test(plan.fixture.manifest_blob_sha1)) error('fixture manifest blob not pinned');
  if (plan.fixture.verified_current_java_head !== java.commit)
    error('current Java fixture head does not match pinned Java head');
  if (plan.fixture.origin_java_head !== fixtureManifest?.source_commit)
    error('fixture provenance changed');
  exactly(plan.fixture.verified_blob_count, 4, 'fixture count');
  if (!Array.isArray(fixtureManifest.fixtures) ||
      fixtureManifest.fixtures.length !== plan.fixture.verified_blob_count ||
      fixtureManifest.fixtures.some(x => !SHA40.test(x.git_blob_sha1) || x.verified_guest !== false))
    error('fixture identity / guest flags invalid');
  exactly(plan.fixture.verification_kind,
    'GIT_BLOB_IDENTITY_ONLY_NOT_GUEST_EXECUTION', 'fixture proof class');
  for (const verified of Object.values(fixtureManifest.target_verified ?? {}))
    if (verified !== false) error('guest verification flag cannot be promoted');
  const security = plan.security;
  exactly(security?.private_source_mirroring,
    'BLOCKED_PENDING_INDEPENDENT_APPROVAL', 'private source policy');
  exactly(security.source_main_protected, false, 'observed source protection');
  exactly(security.source_free_capacity_canary_is_authorization, false,
    'capacity canary is not authorization');
  if (JSON.stringify(security.required_open_incidents) !== JSON.stringify([22,77,127]))
    error('mandatory open incident snapshot mismatch');
  // Historical ledger is purposefully immutable and may pin older PR heads.
  // Check its semantics, not equality with the new snapshot's current heads.
  exactly(history?.schema, 'oreslang.critical-suspends.backend-evidence/1', 'history schema');
  if (history.entries?.length !== 5 ||
      history.entries.some(x => x.executed_steps !== 0 ||
                               x.execution !== 'NOT_EXECUTED' ||
                               x.guest_parity_verified !== false))
    error('historical runner admission data was changed or promoted');
  return Object.freeze({classification:'PREPARED_NOT_EXECUTED', backends:seen.size, guest_receipts:0});
}
