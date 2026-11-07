import { createHash } from 'node:crypto';

const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const OWNERSHIP_DIAGNOSTIC = /^[A-Z][A-Z0-9_]{3,63}$/;
const CASE_ID = /^[a-z][a-z0-9-]{2,63}$/;
const BACKENDS = ['java', 'llvm', 'wasm', 'forge', 'net'];

export function sourceDigest(source) {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

// SHAPE-ONLY validation. "ok" is intentionally ALWAYS false: callers
// cannot promote self-reported steps, diagnostics or Git identifiers into
// verified backend proof. shapeMatched is a distinct, advisory property.
// Actual validation requires independently fetched source objects, job steps,
// signed/provenanced compiler logs, and executable guest oracles.
export function inspectOwnershipReceipt(contract, receipt) {
  const errors = [];
  const fail = message => errors.push(message);
  const invalid = message => ({ ok: false, shapeMatched: false, status: 'INVALID_CONTRACT', errors: [message] });

  if (!contract || contract.contract !== 'rt-ownership-admission-v1' ||
      contract.schemaVersion !== 1 || contract.status !== 'candidate-unattested' ||
      contract.sourceExtension !== '.atto')
    return invalid('wrong version, extension or promoted contract');
  if (!Array.isArray(contract.cases) || contract.cases.length === 0 ||
      !Array.isArray(contract.backendTargets) ||
      contract.backendTargets.length !== BACKENDS.length ||
      !BACKENDS.every(b => contract.backendTargets.includes(b)) ||
      new Set(contract.backendTargets).size !== BACKENDS.length)
    return invalid('invalid case/backend inventory');

  const promotion = contract.promotion;
  if (!promotion || promotion.requireIndependentProvenance !== true ||
      promotion.requireExactCommitAndTree !== true ||
      promotion.requireStepfulCompilation !== true ||
      promotion.requireSemanticOwnershipDiagnostic !== true ||
      promotion.rejectParserOnlyEvidence !== true ||
      promotion.requirePositiveGuestExecution !== true ||
      promotion.requireBackendSpecificArtifacts !== true ||
      promotion.allowZeroStepAsPassing !== false ||
      promotion.allowSourceFreeHostModelAsPassing !== false)
    return invalid('ownership contract may not relax required proof gates');

  const expected = new Map();
  for (const c of contract.cases) {
    if (!c || typeof c !== 'object' || !CASE_ID.test(c.id ?? '') ||
        !['accept', 'reject'].includes(c.expect) ||
        typeof c.source !== 'string' || c.source.length < 80)
      return invalid('invalid contract case');
    if (expected.has(c.id)) return invalid('duplicate contract case: ' + c.id);
    if (c.expect === 'reject' && !OWNERSHIP_DIAGNOSTIC.test(c.reason ?? ''))
      return invalid('missing normalized ownership diagnostic for: ' + c.id);
    if (c.expect === 'accept' && !Number.isSafeInteger(c.expectedGuestExit))
      return invalid('missing positive guest oracle for: ' + c.id);
    expected.set(c.id, c);
  }

  if (!BACKENDS.includes(receipt?.backend)) fail('unknown backend');
  if (typeof receipt?.sourceCommit !== 'string' || !SHA40.test(receipt.sourceCommit))
    fail('missing exact source commit');
  if (typeof receipt?.sourceTree !== 'string' || !SHA40.test(receipt.sourceTree))
    fail('missing exact source tree');
  if (typeof receipt?.compilerCommit !== 'string' || !SHA40.test(receipt.compilerCommit))
    fail('missing exact compiler commit');
  if (!Array.isArray(receipt?.cases)) fail('missing case reports');

  const seen = new Set();
  for (const report of Array.isArray(receipt?.cases) ? receipt.cases : []) {
    if (!report || typeof report.id !== 'string') { fail('unidentified report'); continue; }
    if (seen.has(report.id)) fail('duplicate report: ' + report.id);
    seen.add(report.id);
    const c = expected.get(report.id);
    if (!c) { fail('unknown case: ' + report.id); continue; }
    if (typeof report.sourceSha256 !== 'string' ||
        !SHA64.test(report.sourceSha256) ||
        report.sourceSha256 !== sourceDigest(c.source))
      fail('source digest mismatch: ' + report.id);
    if (!Number.isSafeInteger(report.compilerSteps) || report.compilerSteps <= 0)
      fail('no executed compiler steps: ' + report.id);
    if (report.suiteSkipped === true || report.status === 'NOT_EXECUTED')
      fail('unexecuted/skip cannot pass: ' + report.id);

    // These are self-reported necessary facts, NEVER independent proof.
    // A parser error or unsupported feature is not an ownership rejection.
    if (report.parserAccepted !== true)
      fail('source parser acceptance not proven: ' + report.id);
    if (c.expect === 'reject') {
      if (report.ownershipCheckerRan !== true)
        fail('ownership checker execution not proven: ' + report.id);
      if (report.stage !== 'semantic' || !Number.isInteger(report.exitCode) ||
          report.exitCode === 0 || report.emittedArtifact !== false)
        fail('rejection is not semantic compiler denial: ' + report.id);
      if (typeof report.diagnosticCode !== 'string' ||
          !OWNERSHIP_DIAGNOSTIC.test(report.diagnosticCode) ||
          report.diagnosticCode !== c.reason)
        fail('missing canonical ownership diagnostic: ' + report.id);
    } else {
      if (report.stage !== 'guest' || report.exitCode !== 0 ||
          report.guestExitCode !== c.expectedGuestExit || report.guestExecuted !== true)
        fail('positive guest oracle missing: ' + report.id);
    }
  }
  for (const c of contract.cases) if (!seen.has(c.id)) fail('missing case: ' + c.id);

  return {
    ok: false,
    shapeMatched: errors.length === 0,
    status: errors.length ? 'REJECTED_UNATTESTED' : 'STRUCTURALLY_MATCHED_UNATTESTED',
    errors
  };
}
