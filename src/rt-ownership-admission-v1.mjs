import { createHash } from 'node:crypto';

const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const OWNERSHIP_DIAGNOSTIC = /^[A-Z][A-Z0-9_]{3,63}$/;

export function sourceDigest(source) {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

// Shape checking only. Without independently verified compiler logs and Git
// object provenance, even a structurally matched receipt remains UNATTESTED.
export function inspectOwnershipReceipt(contract, receipt) {
  const errors = [];
  const fail = message => errors.push(message);
  if (contract?.contract !== 'rt-ownership-admission-v1' || contract.status !== 'candidate-unattested')
    fail('wrong or promoted contract');
  if (!Array.isArray(contract?.cases) || !Array.isArray(contract?.backendTargets))
    return { ok: false, status: 'INVALID_CONTRACT', errors: ['invalid case/backend inventory'] };
  if (!contract.backendTargets.includes(receipt?.backend)) fail('unknown backend');
  if (!SHA40.test(receipt?.sourceCommit ?? '')) fail('missing exact source commit');
  if (!SHA40.test(receipt?.sourceTree ?? '')) fail('missing exact source tree');
  if (!SHA40.test(receipt?.compilerCommit ?? '')) fail('missing exact compiler commit');
  if (!Array.isArray(receipt?.cases)) fail('missing case reports');
  const expected = new Map();
  for (const c of contract.cases) {
    if (expected.has(c.id)) fail('duplicate contract case: ' + c.id);
    if (!['accept', 'reject'].includes(c.expect)) fail('invalid expectation: ' + c.id);
    if (typeof c.source !== 'string' || c.source.length < 80) fail('missing source: ' + c.id);
    expected.set(c.id, c);
  }
  const seen = new Set();
  for (const report of Array.isArray(receipt?.cases) ? receipt.cases : []) {
    if (!report || typeof report.id !== 'string') { fail('unidentified report'); continue; }
    if (seen.has(report.id)) fail('duplicate report: ' + report.id);
    seen.add(report.id);
    const c = expected.get(report.id);
    if (!c) { fail('unknown case: ' + report.id); continue; }
    if (!SHA64.test(report.sourceSha256 ?? '') || report.sourceSha256 !== sourceDigest(c.source))
      fail('source digest mismatch: ' + report.id);
    if (!Number.isSafeInteger(report.compilerSteps) || report.compilerSteps <= 0)
      fail('no executed compiler steps: ' + report.id);
    if (report.suiteSkipped === true || report.status === 'NOT_EXECUTED')
      fail('unexecuted/skip cannot pass: ' + report.id);
    // A compiler can fail at lexing/parsing or during unsupported-feature
    // admission without ever checking borrow semantics. These fields are
    // necessary structural evidence, never sufficient independent attestation.
    if (report.parserAccepted !== true)
      fail('source parser acceptance not proven: ' + report.id);
    if (c.expect === 'reject') {
      if (report.ownershipCheckerRan !== true)
        fail('ownership checker execution not proven: ' + report.id);
      if (report.stage !== 'semantic' || !Number.isInteger(report.exitCode) || report.exitCode === 0 || report.emittedArtifact !== false)
        fail('rejection is not semantic compiler denial: ' + report.id);
      if (!OWNERSHIP_DIAGNOSTIC.test(report.diagnosticCode ?? '') ||
          report.diagnosticCode !== c.reason)
        fail('missing canonical ownership diagnostic: ' + report.id);
    } else {
      if (report.stage !== 'guest' || report.exitCode !== 0 ||
          report.guestExitCode !== c.expectedGuestExit || report.guestExecuted !== true)
        fail('positive guest oracle missing: ' + report.id);
    }
  }
  for (const c of contract.cases) if (!seen.has(c.id)) fail('missing case: ' + c.id);
  return { ok: errors.length === 0,
    status: errors.length ? 'REJECTED_UNATTESTED' : 'STRUCTURALLY_MATCHED_UNATTESTED',
    errors };
}
