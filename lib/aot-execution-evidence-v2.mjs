// Structural classification only. This module NEVER authenticates GitHub CI,
// compiler provenance, artifact execution, or release eligibility.
const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^(?!0{64}$)[a-f0-9]{64}$/;
const BACKENDS = new Set(['java', 'llvm', 'net', 'wasm', 'forge', 'cranelift']);
const MODES = new Set(['full-aot', 'hybrid', 'jit']);
const STATUSES = new Set(['EXECUTED', 'NOT_EXECUTED', 'UNSUPPORTED', 'FAILED']);
const TRUST = new Set(['trusted', 'untrusted']);
const ISOLATIONS = new Set(['none', 'shared', 'isolated', 'untrusted']);
const ARTIFACTS = new Set(['linked-native-guest-executable', 'closed-guest-wasm-module',
  'native-host-runtime', 'relocatable-guest-object', 'jit-only-guest', 'none']);
const RECEIPT = ['schema', 'backend', 'mode', 'status', 'trust', 'isolation',
  'sourceCommit', 'sourceTree', 'sourceProgramSha256', 'compilerSha256',
  'artifact', 'closure', 'execution'];
const ARTIFACT = ['kind', 'sha256'];
const CLOSURE = ['macrosEliminated', 'importsResolved', 'genericsClosed',
  'actorHandlersClosed', 'asyncContinuationsClosed', 'dispatchClosed',
  'effectsChecked', 'ownershipChecked', 'runtimeCompilerAbsent'];
const EXECUTION = ['jobId', 'runnerName', 'completedSteps', 'guestEntrypointRan',
  'guestOutputSha256', 'guestInterpreterUsed', 'runtimeGuestCompilerUsed',
  'runtimeGuestJitUsed', 'aotBaselineRanWithoutJit'];

function record(x, fields) {
  if (x === null || typeof x !== 'object' || Array.isArray(x)
      || Object.getPrototypeOf(x) !== Object.prototype) return false;
  const keys = Object.keys(x);
  return keys.length === fields.length && fields.every(k => {
    const d = Object.getOwnPropertyDescriptor(x, k);
    return d && Object.hasOwn(d, 'value');
  }) && keys.every(k => fields.includes(k));
}
const sha = (x, re) => typeof x === 'string' && re.test(x);
const nullableSha = (x, re) => x === null || sha(x, re);
const count = x => Number.isSafeInteger(x) && x >= 0;
const positive = x => Number.isSafeInteger(x) && x > 0;
const result = (classification, errors = []) => ({
  ok: false, structurallyValid: errors.length === 0,
  classification, releaseQualified: false, errors
});

function classify(r, expected) {
  const errors = [];
  if (!record(r, RECEIPT) || !record(r.artifact, ARTIFACT)
      || !record(r.closure, CLOSURE) || !record(r.execution, EXECUTION))
    return result('INVALID', ['invalid own-data receipt fields']);
  if (r.schema !== 'atto.aot-execution-evidence.v2') errors.push('unknown schema');
  if (!BACKENDS.has(r.backend) || !MODES.has(r.mode)
      || !STATUSES.has(r.status) || !TRUST.has(r.trust)
      || !ISOLATIONS.has(r.isolation)) errors.push('unknown profile or status');
  if (!sha(r.sourceCommit, SHA40) || !sha(r.sourceTree, SHA40))
    errors.push('exact source commit/tree required');
  if (!nullableSha(r.sourceProgramSha256, SHA256)
      || !nullableSha(r.compilerSha256, SHA256)
      || !nullableSha(r.artifact.sha256, SHA256)) errors.push('invalid sha256');
  if (!ARTIFACTS.has(r.artifact.kind)) errors.push('unknown artifact kind');
  for (const k of CLOSURE) if (typeof r.closure[k] !== 'boolean')
    errors.push('invalid closure boolean: ' + k);
  const e = r.execution;
  if (!(e.jobId === null || positive(e.jobId)) ||
      !(e.runnerName === null || (typeof e.runnerName === 'string' &&
        e.runnerName.length > 0 && e.runnerName.length <= 160)) ||
      !count(e.completedSteps) || !nullableSha(e.guestOutputSha256, SHA256))
    errors.push('invalid step, runner or output evidence');
  for (const k of ['guestEntrypointRan', 'guestInterpreterUsed',
      'runtimeGuestCompilerUsed', 'runtimeGuestJitUsed', 'aotBaselineRanWithoutJit'])
    if (typeof e[k] !== 'boolean') errors.push('invalid execution boolean: ' + k);
  // expected is *not* an attestation; it is a trusted caller's independent SHA
  // comparison input. Even matches are only structural and require review.
  // Legacy source-only callers remain structural/unqualified. New callers
  // can also pin the independent backend lane: Forge is NOT a Cranelift alias.
  const legacySelector = record(expected, ['sourceCommit', 'sourceTree']);
  const backendSelector = record(expected, ['sourceCommit', 'sourceTree', 'backend']);
  if ((!legacySelector && !backendSelector)
      || !sha(expected.sourceCommit, SHA40) || !sha(expected.sourceTree, SHA40)
      || (backendSelector && !BACKENDS.has(expected.backend)))
    errors.push('trusted exact source/backend selector required');
  else if (r.sourceCommit !== expected.sourceCommit || r.sourceTree !== expected.sourceTree)
    errors.push('source identity differs from trusted selector');
  else if (backendSelector && r.backend !== expected.backend)
    errors.push('backend lane differs from trusted selector');
  if (errors.length) return result('INVALID', errors);

  if (r.status === 'NOT_EXECUTED' || r.status === 'UNSUPPORTED') {
    if (e.completedSteps !== 0 || e.jobId !== null || e.runnerName !== null ||
        e.guestEntrypointRan || e.guestOutputSha256 !== null ||
        e.guestInterpreterUsed || e.runtimeGuestCompilerUsed ||
        e.runtimeGuestJitUsed || e.aotBaselineRanWithoutJit ||
        r.sourceProgramSha256 !== null || r.compilerSha256 !== null ||
        r.artifact.sha256 !== null || r.artifact.kind !== 'none')
      return result('INVALID', ['unexecuted case must not claim runner, compiler, guest execution or artifact']);
    return result(r.status);
  }
  if (r.status === 'FAILED') {
    if (!positive(e.completedSteps) || !positive(e.jobId) || !e.runnerName)
      return result('INVALID',
        ['compiler failure requires an admitted job with executed steps']);
    return result('EXECUTED_FAILED_NO_AOT_CREDIT');
  }
  if (!positive(e.jobId) || !e.runnerName || !positive(e.completedSteps) ||
      !sha(r.sourceProgramSha256, SHA256) || !sha(r.compilerSha256, SHA256) ||
      !sha(r.artifact.sha256, SHA256) || !sha(e.guestOutputSha256, SHA256) ||
      !e.guestEntrypointRan)
    errors.push('executed receipt requires stepful job, guest entrypoint and hashes');
  if (r.mode === 'full-aot' || r.mode === 'hybrid') {
    const requiredKind = r.backend === 'wasm'
      ? 'closed-guest-wasm-module' : 'linked-native-guest-executable';
    if (r.artifact.kind !== requiredKind)
      errors.push('artifact must be a linked/closed program-specific guest image');
    for (const k of CLOSURE) if (!r.closure[k])
      errors.push('missing AOT closure: ' + k);
    if (e.guestInterpreterUsed || e.runtimeGuestCompilerUsed)
      errors.push('interpreter or runtime guest compiler fallback forbidden');
    if (!e.aotBaselineRanWithoutJit)
      errors.push('must execute exact compiled guest baseline with JIT disabled');
    if (r.mode === 'full-aot' && e.runtimeGuestJitUsed)
      errors.push('runtime guest JIT forbidden in strict AOT');
  } else if (r.mode === 'jit') {
    if (r.artifact.kind !== 'jit-only-guest')
      errors.push('JIT-only case cannot report a linked AOT artifact');
  }
  if (errors.length) return result('INVALID', errors);
  const label = r.mode === 'full-aot' ? 'AOT_STRUCTURAL_REVIEW_REQUIRED' :
    r.mode === 'hybrid' ? 'HYBRID_STRUCTURAL_REVIEW_REQUIRED' :
    'JIT_ONLY_STRUCTURAL_REVIEW_REQUIRED';
  return result(label);
}

export function classifyAotExecutionEvidence(receipt, trustedExpected) {
  try { return classify(receipt, trustedExpected); }
  catch { return result('INVALID', ['untrusted reflection trap or malformed receipt']); }
}

// New strict entrypoint: a caller must bind the exact independent backend lane
// as well as source SHA/tree. Legacy source-only consumers remain unqualified.
export function classifyAotExecutionEvidenceForBackend(receipt, trustedExpected) {
   try {
     if (!record(trustedExpected, ['sourceCommit', 'sourceTree', 'backend']))
       return result('INVALID', ['independent backend selector required']);
     return classify(receipt, trustedExpected);
   } catch {
     return result('INVALID', ['untrusted reflection trap or malformed selector']);
   }
}
