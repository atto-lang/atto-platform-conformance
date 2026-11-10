import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SHA40 = /^[0-9a-f]{40}$/;
const positiveInteger = x => Number.isSafeInteger(x) && x > 0;

/**
 * Classify authoritative GitHub Actions run/job snapshots without converting
 * workflow or host execution into compiler, guest, sanitizer or parity proof.
 * This tool does not consult GitHub, fetch private source, or trust user-supplied
 * success summaries. Its verdict is deliberately non-promoting.
 */
export function auditActorCI(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
    throw new TypeError('Expected one CI snapshot object');
  const { repository, expected_head_sha: head, run, jobs } = snapshot;
  if (typeof repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new TypeError('A canonical owner/repo is required');
  if (typeof head !== 'string' || !SHA40.test(head))
    throw new TypeError('An exact 40-hex expected_head_sha is required');

  const result = {
    repository, expected_head_sha: head, run_id: null, run_attempt: null,
    classification: 'MISSING_RUN', certified: false,
    compiler: 'NOT_VERIFIED', guest: 'NOT_EXECUTED',
    sanitizers: 'NOT_EXECUTED', parity: 'NOT_CERTIFIED', jobs: [],
  };
  if (!run || typeof run !== 'object' || Array.isArray(run)) return result;
  result.run_id = positiveInteger(run.id) ? run.id : null;
  result.run_attempt = positiveInteger(run.run_attempt) ? run.run_attempt : null;
  if (!result.run_id || !result.run_attempt) {
    result.classification = 'MISSING_RUN_IDENTITY';
    return result;
  }
  if (run.head_sha !== head ||
      (run.head_repository?.full_name && run.head_repository.full_name !== repository)) {
    result.classification = 'STALE_OR_FOREIGN_RUN';
    return result;
  }
  if (!Array.isArray(jobs)) {
    result.classification = 'MISSING_JOB_DATA';
    return result;
  }
  if (jobs.length === 0) {
    result.classification = 'NO_JOBS_CREATED';
    return result;
  }

  const jobIds = new Set();
  for (const job of jobs) {
    if (!job || !positiveInteger(job.id) || jobIds.has(job.id)) {
      result.classification = 'INVALID_JOB_IDENTITY';
      result.jobs = [];
      return result;
    }
    jobIds.add(job.id);
    const item = { id: job.id, name: job.name || '', classification: 'ZERO_STEPS',
      executed_steps: 0 };
    if (job.run_id != null && job.run_id !== run.id) {
      item.classification = 'FOREIGN_JOB';
    } else if (!Array.isArray(job.steps) || job.steps.length === 0) {
      item.classification = 'ZERO_STEPS';
    } else if (job.steps.some(s => !s || typeof s.name !== 'string' ||
               !Number.isSafeInteger(s.number) || s.number < 1) ||
               new Set(job.steps.map(s => s.number)).size !== job.steps.length) {
      item.classification = 'INVALID_STEP_DATA';
    } else {
      const executed = job.steps.filter(s =>
        ['success', 'failure', 'cancelled', 'timed_out', 'action_required'].includes(s.conclusion));
      item.executed_steps = executed.length;
      if (executed.length === 0) {
        item.classification = 'NO_EXECUTED_STEPS';
      } else if (executed.some(s => s.conclusion !== 'success') ||
                 job.conclusion === 'failure') {
        item.classification = 'EXECUTED_STEP_FAILURE';
      } else {
        // Names are not signed receipts. A green checkout/compile/guest step is
        // insufficient to establish a real executed AttoLang binary or sanitizer.
        item.classification = 'STEPS_EXECUTED_UNVERIFIED';
      }
    }
    result.jobs.push(item);
  }

  const kinds = result.jobs.map(j => j.classification);
  result.classification = kinds.includes('FOREIGN_JOB') ||
    kinds.includes('INVALID_STEP_DATA') ? 'INVALID_JOB_EVIDENCE' :
    kinds.every(k => k === 'ZERO_STEPS') ? 'ZERO_STEP_RUNNER_ADMISSION' :
    kinds.some(k => k === 'ZERO_STEPS' || k === 'NO_EXECUTED_STEPS') ? 'PARTIAL_NOT_EXECUTED' :
    kinds.some(k => k === 'EXECUTED_STEP_FAILURE') ? 'EXECUTED_FAILURE' :
    'STEPS_EXECUTED_UNVERIFIED';
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node audit-actor-ci-evidence.mjs snapshot.json');
    const verdict = auditActorCI(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');
    if (verdict.classification !== 'STEPS_EXECUTED_UNVERIFIED') process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`CI evidence audit error: ${error.message}\n`);
    process.exitCode = 2;
  }
}
