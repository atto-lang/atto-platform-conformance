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
      inventory.count !== 73 || inventory.ordered_labels?.length !== 73 ||
      new Set(inventory.ordered_labels).size !== 73) return fail('INVALID_INVENTORY');
  const backend = expected.backends?.find((item) => item.name === report.backend);
  if (expected.contract !== 'oreslang.native-replay-source-alignment/1' || !backend) return fail('UNKNOWN_BACKEND');
  if (report.repository !== backend.repo || report.sourceCommit !== backend.head ||
      report.sourceBlobSha !== expected.source_code_blob_sha ||
      report.fixtureBlobSha !== backend.test_blob_sha) return fail('UNPINNED_SOURCE');
  if (!hex(report.sourceCommit, 20) || !hex(report.compilerBinarySha256, 32) ||
      !hex(report.guestBinarySha256, 32)) return fail('UNPINNED_BINARY');
  if (!Number.isSafeInteger(report.workflowRunId) || report.workflowRunId < 1 ||
      !Number.isSafeInteger(report.workflowJobId) || report.workflowJobId < 1 ||
      !Array.isArray(report.steps) || report.steps.length < 3) return fail('ZERO_STEP_OR_MISSING_JOB');
  const required = ['checkout', 'compile_guest', 'execute_guest'];
  for (const name of required) {
    if (!report.steps.some((step) => step?.id === name && step?.status === 'completed' && step?.conclusion === 'success'))
      return fail('MISSING_EXECUTED_STEP');
  }
  if (report.runtimeExitCode !== 0 || report.runtimeSignal !== null ||
      report.guestExecuted !== true || report.checkOnly === true ||
      report.workflowConclusion !== 'success') return fail('NO_SUCCESSFUL_GUEST_EXECUTION');
  if (typeof report.stdout !== 'string' || typeof report.stderr !== 'string' ||
      report.stderr.length !== 0 || !hex(report.stdoutSha256, 32) ||
      hash(report.stdout) !== report.stdoutSha256) return fail('UNBOUND_OUTPUT');
  const lines = report.stdout.endsWith('\n') ? report.stdout.slice(0, -1).split('\n') : report.stdout.split('\n');
  const expectedLines = inventory.ordered_labels.map((label) => 'REPLAY-PASS|' + label).concat(inventory.terminal);
  if (lines.length !== expectedLines.length || lines.some((line, i) => line !== expectedLines[i])) return fail('GUEST_RECEIPT_MISMATCH');
  return { ok: true, value: { backend: report.backend, receiptCount: 73, provenance: 'SHAPE_ONLY_NOT_AUTHENTICATED' } };
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
