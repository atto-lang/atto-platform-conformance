#!/usr/bin/env node
// Receipt consistency gate, not CI provenance authentication or a guest runner.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {createHash} from 'node:crypto';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(fixtureDir, 'manifest.json'), 'utf8'));
const digest = data => createHash('sha256').update(data).digest('hex');
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);

export function verify(receipt) {
  const problems = [];
  const requireThat = (condition, reason) => {if (!condition) problems.push(reason);};
  for (const f of [manifest.source, ...manifest.negativeCases]) {
    requireThat(digest(readFileSync(resolve(fixtureDir, f.file))) === f.sha256, `fixture digest mismatch: ${f.file}`);
  }
  requireThat(Object.hasOwn(manifest.backends, receipt?.backend), 'unknown backend');
  requireThat(receipt?.kind === 'ACTUAL_COMPILED_ORES_GUEST', 'host-only or synthetic execution is not guest evidence');
  requireThat(sha(receipt?.sourceCommit) && sha(receipt?.sourceTree), 'missing exact source commit/root tree');
  requireThat(hash(receipt?.compilerSha256) && hash(receipt?.guestArtifactSha256), 'missing compiler/artifact hashes');
  requireThat(receipt?.sourceSha256 === manifest.source.sha256, 'mismatched guest source hash');
  requireThat(Number.isSafeInteger(receipt?.runId) && receipt.runId > 0 && Number.isSafeInteger(receipt?.jobId) && receipt.jobId > 0 && Number.isSafeInteger(receipt?.attempt) && receipt.attempt > 0, 'invalid CI run/job/attempt');
  const stages = ['compiler_build', 'guest_compile', 'guest_execute', 'reject_foreign_access', 'reject_read_loan_write'];
  for (const stage of stages) {
    const matching = Array.isArray(receipt?.steps) ? receipt.steps.filter(x => x.name === stage) : [];
    requireThat(matching.length === 1 && matching[0].executed === true && matching[0].conclusion === 'success' && Number.isSafeInteger(matching[0].number) && matching[0].number > 0, `missing successful executed step: ${stage}`);
  }
  const steps = Array.isArray(receipt?.steps) ? receipt.steps : [];
  requireThat(new Set(steps.map(x => x.number)).size === steps.length, 'duplicate CI step numbers');
  const output = receipt?.guestStdout;
  requireThat(Array.isArray(output) && output.length === 4 && output.every(x => x === '1' || x === '2') && output.filter(x => x === '1').length === 2 && output.filter(x => x === '2').length === 2, 'unexpected two-actor state trace');
  requireThat(receipt?.guestExitCode === 0, 'guest did not exit successfully');
  for (const c of manifest.negativeCases) {
    const n = receipt?.negatives?.[c.id];
    requireThat(n?.sourceSha256 === c.sha256 && n?.exitCode === 1 && n?.diagnosticClass === c.requiredDiagnosticClass && n?.outputArtifacts === 0, `missing semantic denial: ${c.id}`);
  }
  // Do not promote physical-retirement/loan/cancellation claims from stdout/JSON.
  return {ok: problems.length === 0, classification: problems.length ? 'REJECTED' : 'UNATTESTED_GUEST_CORE_RECEIPT', independentlyAttested: false, physicallyQuiescentVerified: false, publiclyPromotable: false, problems};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {console.error('Usage: node verify.mjs /path/to/backend-receipt.json'); process.exitCode = 2;}
  else {
    try {const result = verify(JSON.parse(readFileSync(process.argv[2], 'utf8'))); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1;}
    catch (error) {console.error(error.message); process.exitCode = 2;}
  }
}
