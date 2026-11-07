// Post-repair source-org private runner gate.
// This pure validator only checks API-derived source-free runner evidence.
// It is NOT compiler-backed guest parity, a billing diagnosis, or approval to
// copy private source to another organization.
export const PRIVATE_RUNNER_CONTROL = Object.freeze({
  repository: 'ores-truffle-oreslang/oreslang-platform-conformance',
  workflowPath: '.github/workflows/critical-sourcefree-runner-admission-20261102.yml',
  workflowId: 404169919,
  workflowBlob: '9fdf367e37c56c7c013b8a21222b0bbc4ad3c499',
  sourceHead: '3d5bdf454c65d87a915c5d23c2349522c80a958f',
  branch: 'feat/critical-suspends-unified-contract-20261101',
  runId: 41395829396,
  lastKnownFailedAttempt: 13,
  jobName: 'runner-admission',
  runnerLabel: 'ubuntu-24.04',
  stepNames: ['Check allocated runner', 'Verify second executed step'],
  markers: ['SOURCE_FREE_RUNNER_ADMITTED=1', 'SOURCE_FREE_TWO_STEPS_EXECUTED=1']
});

function strictUtc(value) {
  if (typeof value !== 'string') return null;
  const m = /^([1-9][0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.[0-9]{1,9})?Z$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > days[month - 1]) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

export function qualifySourceOrgPrivateRunner({run, page, job, workflow, log}) {
  const errors = [];
  const need = (ok, why) => { if (!ok) errors.push(why); };
  const p = PRIVATE_RUNNER_CONTROL;
  const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!obj(run)) return {ok: false, errors: ['run-object']};
  need(run.id === p.runId, 'pinned-run-id');
  need(run.workflow_id === p.workflowId, 'pinned-workflow-id');
  need(run.path === p.workflowPath, 'pinned-workflow-path');
  need(run.head_sha === p.sourceHead, 'immutable-source-head');
  need(run.head_branch === p.branch, 'pinned-source-branch');
  need(run.repository?.full_name === p.repository, 'source-repository');
  need(run.head_repository?.full_name === p.repository, 'source-head-repository');
  need(run.event === 'push', 'source-free-trigger');
  need(Number.isSafeInteger(run.run_attempt) &&
       run.run_attempt > p.lastKnownFailedAttempt, 'post-repair-run-attempt');
  need(run.status === 'completed' && run.conclusion === 'success',
       'successful-workflow-run');
  need(obj(workflow) && workflow?.sha === p.workflowBlob &&
       workflow?.path === p.workflowPath && workflow?.type === 'file',
       'immutable-source-free-workflow-blob');
  need(obj(page) && page?.total_count === 1 &&
       Array.isArray(page?.jobs) && page.jobs.length === 1, 'complete-single-job-page');
  need(obj(job), 'job-object');
  if (!obj(job)) return {ok: false, errors};
  need(page?.jobs?.[0]?.id === job.id, 'job-page-detail-identity');
  need(job.name === p.jobName, 'source-free-job-name');
  need(job.run_id === p.runId, 'job-run-id');
  need(job.run_attempt === run.run_attempt, 'job-run-attempt');
  need(job.head_sha === p.sourceHead, 'job-head-sha');
  need(job.status === 'completed' && job.conclusion === 'success', 'successful-job');
  need(Number.isSafeInteger(job.runner_id) && job.runner_id > 0, 'runner-admitted');
  need(typeof job.runner_name === 'string' && job.runner_name.length > 0,
       'runner-identity');
  need(Array.isArray(job.labels) && job.labels.includes(p.runnerLabel),
       'pinned-hosted-runner-label');
  const steps = Array.isArray(job.steps) ? job.steps : [];
  need(steps.length >= p.stepNames.length && steps.length <= 20, 'bounded-nonzero-job-steps');
  const names = new Set(), numbers = new Set();
  let previousEnd = null, previousNumber = 0;
  for (const step of steps) {
    need(obj(step), 'job-step-object');
    if (!obj(step)) continue;
    need(typeof step.name === 'string' && step.name.length > 0 &&
         !names.has(step.name), 'unique-step-name');
    names.add(step.name);
    need(Number.isSafeInteger(step.number) && step.number > previousNumber &&
         !numbers.has(step.number), 'ascending-unique-step-number');
    numbers.add(step.number);
    previousNumber = step.number;
    need(step.status === 'completed' && step.conclusion === 'success',
         'successful-executed-step');
    const start = strictUtc(step.started_at), end = strictUtc(step.completed_at);
    need(start !== null && end !== null && end >= start, 'valid-step-times');
    if (previousEnd !== null) {
      need(start !== null && start >= previousEnd, 'nonoverlapping-step-times');
    }
    previousEnd = end;
  }
  const required = p.stepNames.map(name => steps.find(step => step?.name === name));
  need(required.every(Boolean), 'both-source-free-steps-executed');
  if (required.every(Boolean)) {
    need(required[0].number < required[1].number, 'source-free-step-order');
    need(required.every(step => step.status === 'completed' && step.conclusion === 'success'),
      'source-free-step-conclusions');
  }
  const jobStart = strictUtc(job.started_at), jobEnd = strictUtc(job.completed_at);
  need(jobStart !== null && jobEnd !== null && jobEnd >= jobStart, 'valid-job-times');
  need(typeof log === 'string' && log.length > 0 && log.length <= 262144,
       'bounded-job-log');
  if (typeof log === 'string' && log.length <= 262144) {
    for (const marker of p.markers) {
      // Workflow step script lines can contain the marker as source code.
      // Only accept the observed command output line, optionally log-timestamped.
      const outputLines = log.split(/\r?\n/).filter(line => {
        const stripped = line.replace(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z\s+/, '');
        return stripped === marker;
      });
      need(outputLines.length === 1, 'observed-output-' + marker);
    }
  }
  if (errors.length) return {ok: false, errors};
  return {
    ok: true, errors: [],
    receipt: {
      evidenceClass: 'SOURCE_FREE_PRIVATE_RUNNER_ADMISSION_ONLY',
      sourceRepository: p.repository,
      sourceHeadSha: p.sourceHead,
      workflowBlobSha: p.workflowBlob,
      workflowId: p.workflowId,
      runId: p.runId,
      attempt: run.run_attempt,
      jobId: job.id,
      runnerId: job.runner_id,
      runnerName: job.runner_name,
      executedSteps: steps.length,
      markers: [...p.markers],
      sourceCheckout: false,
      guestTestsExecuted: false,
      backendParity: 'NOT_EXECUTED'
    }
  };
}
