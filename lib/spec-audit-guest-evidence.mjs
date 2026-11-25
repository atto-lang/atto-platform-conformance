// Source-free validation of claimed compiler/guest receipts. NOT authentication.
// Only an independent review of GitHub API jobs, compiler binary and artifacts
// can promote these metadata claims into compiler-backed evidence.
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const I64 = /^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/;
const BACKEND_REPOS = Object.freeze({
  java: 'ores-truffle-oreslang/oreslang-source.java',
  llvm: 'ores-truffle-oreslang/oreslang-source.llvm',
  net: 'ores-truffle-oreslang/oreslang-source.net',
  wasm: 'ores-truffle-oreslang/oreslang-source.wasm',
  forge: 'ores-truffle-oreslang/oreslang-source.forge'
});
function fail(message) { throw Error('SPEC_AUDIT_RECEIPT_INVALID: ' + message); }
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !Object.hasOwn(d, 'value')))
    fail(name + ' must be a plain data object');
  return value;
}
function keys(value, expected, name) {
  object(value, name);
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) fail(name + ' fields differ from contract');
}
function integer(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(name + ' must be positive');
}
function sha(pattern, value, name) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(name + ' is not a digest');
}
function i64Text(value, name) {
  if (typeof value !== 'string' || value.length > 20 || !I64.test(value) ||
      BigInt(value) < -(1n << 63n) || BigInt(value) > ((1n << 63n) - 1n))
    fail(name + ' is not canonical signed i64');
}
function checkSteps(steps, requiredNames) {
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 64) fail('missing or unbounded executed steps');
  const nums = new Set();
  for (const step of steps) {
    keys(step, ['number', 'name', 'status', 'conclusion'], 'step');
    integer(step.number, 'step number');
    if (nums.has(step.number)) fail('duplicate step number');
    nums.add(step.number);
    if (typeof step.name !== 'string' || step.name.length > 160 ||
        !/^[\x20-\x7e]+$/.test(step.name)) fail('invalid step name');
    if (step.status !== 'completed' || step.conclusion !== 'success') fail('step not successful');
  }
  for (const name of requiredNames) {
    if (steps.filter(step => step.name === name).length !== 1) fail('required step absent or duplicated: ' + name);
  }
}
export function validateSpecAuditGuestClaim(manifest, receipt, expected) {
  // Independent expectations must not be copied from an untrusted receipt.
  object(manifest, 'manifest');
  if (manifest.schema !== 'atto.spec-audit-candidates/1' || !Array.isArray(manifest.cases)) fail('manifest schema');
  keys(expected, ['backend', 'compilerHead', 'compilerTree', 'conformanceHead',
    'conformanceTree', 'requiredCaseIds', 'requiredSteps'], 'expected');
  if (!Object.hasOwn(BACKEND_REPOS, expected.backend)) fail('backend is unknown');
  for (const name of ['compilerHead', 'compilerTree', 'conformanceHead', 'conformanceTree'])
    sha(SHA1, expected[name], name);
  if (!Array.isArray(expected.requiredCaseIds) || expected.requiredCaseIds.length < 1 ||
      expected.requiredCaseIds.length > 15 ||
      new Set(expected.requiredCaseIds).size !== expected.requiredCaseIds.length ||
      !expected.requiredCaseIds.every(x => typeof x === 'string')) fail('required case pins');
  if (!Array.isArray(expected.requiredSteps) || expected.requiredSteps.length !== 2 ||
      new Set(expected.requiredSteps).size !== 2 ||
      !expected.requiredSteps.every(x => typeof x === 'string' && x.length > 3 && x.length < 120))
    fail('trusted required executed step names');

  keys(receipt, ['schema', 'backend', 'compilerRepository', 'compilerHead', 'compilerTree',
    'compilerSha256', 'conformanceHead', 'conformanceTree', 'runId', 'runAttempt',
    'jobId', 'runnerId', 'jobConclusion', 'steps', 'cases'], 'receipt');
  if (receipt.schema !== 'atto.spec-audit-guest-claim/1' ||
      receipt.backend !== expected.backend ||
      receipt.compilerRepository !== BACKEND_REPOS[expected.backend] ||
      receipt.compilerHead !== expected.compilerHead ||
      receipt.compilerTree !== expected.compilerTree ||
      receipt.conformanceHead !== expected.conformanceHead ||
      receipt.conformanceTree !== expected.conformanceTree)
    fail('receipt source identity or schema mismatch');
  sha(SHA256, receipt.compilerSha256, 'compiler artifact');
  for (const key of ['runId', 'runAttempt', 'jobId', 'runnerId']) integer(receipt[key], key);
  if (receipt.jobConclusion !== 'success') fail('failed workflow is not execution proof');
  checkSteps(receipt.steps, expected.requiredSteps);
  if (!Array.isArray(receipt.cases) || receipt.cases.length !== expected.requiredCaseIds.length)
    fail('missing or extra pinned cases');
  const eligible = new Map(manifest.cases.filter(c => c.kind === 'positive' || c.kind === 'negative')
    .map(c => [c.id, c]));
  const seen = new Set();
  for (const c of receipt.cases) {
    object(c, 'case');
    const m = eligible.get(c.id);
    if (!m || !expected.requiredCaseIds.includes(c.id) || seen.has(c.id) || c.kind !== m.kind)
      fail('unapproved, duplicate or mismatched case');
    seen.add(c.id);
    if (c.kind === 'positive') {
      keys(c, ['id', 'kind', 'sourceBlob', 'compileExit', 'guestExecuted',
        'resultI64', 'resultChannel', 'runExit', 'guestArtifactSha256'], 'positive case');
    } else {
      keys(c, ['id', 'kind', 'sourceBlob', 'compileExit', 'guestExecuted',
        'failureStage', 'diagnosticClass', 'control'], 'negative case');
    }
    if (c.sourceBlob !== m.source_git_blob_sha1) fail('source blob mismatch');
    if (c.kind === 'positive') {
      if (c.compileExit !== 0 || c.guestExecuted !== true) fail('positive guest did not run');
      i64Text(c.resultI64, 'guest result');
      if (c.resultI64 !== m.expected_guest_i64) fail('typed guest value differs from oracle');
      sha(SHA256, c.guestArtifactSha256, 'guest artifact');
      if (!['native-return', 'host-call', 'wasm-export', 'stdout', 'process-exit'].includes(c.resultChannel))
        fail('unsupported typed result channel');
      if (!Number.isSafeInteger(c.runExit) ||
          (c.resultChannel === 'process-exit' ? c.runExit !== Number(c.resultI64) : c.runExit !== 0))
        fail('observed run exit does not match typed result channel');
    } else {
      if (!Number.isSafeInteger(c.compileExit) || c.compileExit <= 0 ||
          c.guestExecuted !== false || c.failureStage !== 'semantic' ||
          c.diagnosticClass !== m.expected_diagnostic_class) fail('nonsemantic or wrong-class compile rejection');
      keys(c.control, ['sourceBlob', 'compileExit', 'guestExecuted'], 'paired control');
      if (c.control.sourceBlob !== m.control_git_blob_sha1 ||
          c.control.compileExit !== 0 || c.control.guestExecuted !== false)
        fail('paired control did not compile on same head');
    }
  }
  for (const id of expected.requiredCaseIds) if (!seen.has(id)) fail('missing required case: ' + id);
  // Even a structurally perfect JSON record can be fabricated. The caller must
  // independently authenticate API run/job/steps, tree identity, binary hashes
  // and diagnostic transcript. Never certify parity from self-reported JSON.
  return Object.freeze({classification: 'REVIEW_REQUIRED',
    sourceFreeShapeValid: true, independentlyAuthenticated: false,
    guestParityCertified: false, backend: receipt.backend, caseCount: seen.size});
}
