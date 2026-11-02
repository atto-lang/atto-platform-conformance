import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const hex = (value, bytes) => typeof value === 'string' && new RegExp('^[0-9a-f]{' + bytes * 2 + '}$').test(value);
const fail = (code) => ({ ok: false, error: code });
const hash = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

// Source-free, OFFLINE receipt-shape verifier. A forged receipt can still pass:
// independently authenticated GitHub check/run provenance is always required.
export function inspectMediaReplayGuestReceipt(report, inventory, expected) {
  if (!report || !inventory || !expected || typeof report !== 'object') return fail('INVALID_REPORT');
  if (inventory.contract !== 'oreslang.media-replay-guest-receipts/1' ||
      inventory.count !== 80 ||
      !Array.isArray(inventory.ordered_labels) ||
      inventory.ordered_labels.length !== inventory.count ||
      inventory.ordered_labels.some((label) => typeof label !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(label)) ||
      new Set(inventory.ordered_labels).size !== inventory.count ||
      inventory.receipt_prefix !== 'REPLAY-PASS|' ||
      inventory.terminal !== 'REPLAY-CONTRACT-DONE') return fail('INVALID_INVENTORY');
  if (expected.contract !== 'oreslang.native-replay-source-alignment/1' ||
      !Array.isArray(expected.backends) || expected.backends.length !== 5 ||
      !hex(expected.source_code_blob_sha, 20) ||
      new Set(expected.backends.map((item) => item?.name)).size !== 5 ||
      expected.backends.some((item) => !item || typeof item.repo !== 'string' ||
        !hex(item.head, 20) || !hex(item.test_blob_sha, 20)))
    return fail('INVALID_ALIGNMENT');
  const backend = expected.backends.find((item) => item.name === report.backend);
  if (!backend) return fail('UNKNOWN_BACKEND');
  if (report.repository !== backend.repo || report.sourceCommit !== backend.head ||
      report.sourceBlobSha !== expected.source_code_blob_sha ||
      report.fixtureBlobSha !== backend.test_blob_sha) return fail('UNPINNED_SOURCE');
  if (!hex(report.sourceCommit, 20) || !hex(report.compilerBinarySha256, 32) ||
      !hex(report.guestBinarySha256, 32)) return fail('UNPINNED_BINARY');
  if (!Number.isSafeInteger(report.workflowRunId) || report.workflowRunId < 1 ||
      !Number.isSafeInteger(report.workflowJobId) || report.workflowJobId < 1 ||
      !Array.isArray(report.steps) || report.steps.length < 3) return fail('ZERO_STEP_OR_MISSING_JOB');
  const required = ['checkout', 'compile_guest', 'execute_guest'];
  // Fail closed when a report contains conflicting duplicate step records.
  // A single successful fake record must not mask a failed/skipped duplicate.
  for (const name of required) {
    const matches = report.steps.filter((step) => step?.id === name);
    if (matches.length !== 1 || matches[0].status !== 'completed' ||
        matches[0].conclusion !== 'success') return fail('MISSING_EXECUTED_STEP');
  }
  if (report.runtimeExitCode !== 0 || report.runtimeSignal !== null ||
      report.guestExecuted !== true || report.checkOnly === true ||
      report.workflowConclusion !== 'success') return fail('NO_SUCCESSFUL_GUEST_EXECUTION');
  if (typeof report.stdout !== 'string' || typeof report.stderr !== 'string' ||
      Buffer.byteLength(report.stdout, 'utf8') > 32 * 1024 ||
      report.stderr.length !== 0 || !hex(report.stdoutSha256, 32) ||
      hash(report.stdout) !== report.stdoutSha256) return fail('UNBOUND_OUTPUT');
  const lines = report.stdout.endsWith('\n') ? report.stdout.slice(0, -1).split('\n') : report.stdout.split('\n');
  const expectedLines = inventory.ordered_labels.map((label) => 'REPLAY-PASS|' + label).concat(inventory.terminal);
  if (lines.length !== expectedLines.length || lines.some((line, i) => line !== expectedLines[i])) return fail('GUEST_RECEIPT_MISMATCH');
  return { ok: true, value: { backend: report.backend, receiptCount: 80, provenance: 'SHAPE_ONLY_NOT_AUTHENTICATED' } };
}

// Manual inspection: node lib/media-replay-receipts-v1.mjs manifest.json receipts.json report.json
if (process.argv[1]?.endsWith('/media-replay-receipts-v1.mjs')) {
  try {
    const [manifestPath, sourcesPath, reportPath] = process.argv.slice(2);
    if (!manifestPath || !sourcesPath || !reportPath) throw Error('expect inventory, source-alignment and report');
    const result = inspectMediaReplayGuestReceipt(
      JSON.parse(readFileSync(reportPath, 'utf8')),
      JSON.parse(readFileSync(manifestPath, 'utf8')),
      JSON.parse(readFileSync(sourcesPath, 'utf8')),
    );
    process.stdout.write(JSON.stringify(result) + '\n');
    if (!result.ok) process.exitCode = 1;
  } catch {
    process.stderr.write('MEDIA_REPLAY_RECEIPT_INVALID\n');
    process.exitCode = 1;
  }
}
