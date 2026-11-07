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
  runnerGroupName: 'GitHub Actions',
  requiredJobSteps: ['Set up job', 'Check allocated runner', 'Verify second executed step', 'Complete job'],
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
  need(run.repository?.private === true && run.head_repository?.private === true,
    'private-repository-evidence');
  need(run.event === 'push', 'source-free-trigger');
  need(Number.isSafeInteger(run.run_attempt) &&
       run.run_attempt > p.lastKnownFailedAttempt, 'post-repair-run-attempt');
  need(run.status === 'completed' && run.conclusion === 'success',
       'successful-workflow-run');
  const runCreated = strictUtc(run.created_at);
  const runUpdated = strictUtc(run.updated_at);
  need(runCreated !== null && runUpdated !== null && runUpdated >= runCreated,
    'valid-run-lifetime');
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
  need(Array.isArray(job.labels) && job.labels.length === 1 &&
       job.labels[0] === p.runnerLabel, 'pinned-hosted-runner-label');
  // A requested runner label alone is never hosted-runner evidence: a
  // self-hosted machine could register the same label. Require GitHub's
  // canonical hosted runner-group metadata plus actual image header below.
  need(job.runner_group_id === 0 && job.runner_group_name === p.runnerGroupName,
    'github-hosted-runner-group');
  need(typeof job.runner_name === 'string' &&
       job.runner_name === 'GitHub Actions ' + job.runner_id,
       'github-hosted-runner-name');
  const steps = Array.isArray(job.steps) ? job.steps : [];
  need(steps.length === p.requiredJobSteps.length, 'exact-source-free-step-count');
  need(steps.length === p.requiredJobSteps.length &&
       steps.every((step,i) => step?.name === p.requiredJobSteps[i]),
       'exact-source-free-step-inventory');
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
  need(runCreated !== null && runUpdated !== null &&
       jobStart !== null && jobEnd !== null &&
       jobStart >= runCreated && jobEnd <= runUpdated + 1000,
       'job-within-pinned-run-lifetime');
  for (const step of steps) {
    const start = strictUtc(step?.started_at), end = strictUtc(step?.completed_at);
    need(start !== null && end !== null && jobStart !== null && jobEnd !== null &&
         start >= jobStart - 1000 && end <= jobEnd + 1000,
         'step-within-job-lifetime');
  }
  need(typeof log === 'string' && log.length > 0 && log.length <= 262144,
       'bounded-job-log');
  if (typeof log === 'string' && log.length <= 262144) {
    const lines = log.split(/\r?\n/).map(line => line.replace(/^\uFEFF/, ''));
    const parseLogged = line => {
      const m = /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z) (.*)$/.exec(line);
      const when = strictUtc(m?.[1]);
      return when === null ? null : {when, message:m[2]};
    };
    const entries = lines.map(parseLogged);
    const firstRunGroup = entries.findIndex(e => e?.message.startsWith('##[group]Run '));
    const header = firstRunGroup > 0 ? entries.slice(0,firstRunGroup) : [];
    const observedHeader = exact => header.some(entry => entry?.message === exact);
    need(observedHeader('Hosted Compute Agent'), 'hosted-compute-agent-header');
    need(observedHeader('Image: ' + p.runnerLabel), 'hosted-runner-image-header');
    need(observedHeader('Complete job name: ' + p.jobName), 'pinned-job-log-header');
    need(header.some(entry => entry?.message.startsWith('Current runner version: ')),
         'runner-version-header');
    const observedMarkers = [];
    for (let i=0; i<p.markers.length; i++) {
      const marker = p.markers[i], step = required[i];
      // Accept only timestamps from observed stdout, not script source,
      // ANSI-highlighted echo commands, unprefixed text or unrelated steps.
      const matches = entries.filter(e => e?.message === marker);
      const unprefixed = lines.some(line => line.trim() === marker);
      need(!unprefixed, 'unattributed-output-' + marker);
      need(matches.length === 1 && !unprefixed, 'observed-output-' + marker);
      if (matches.length === 1) {
        const value = matches[0];
        observedMarkers.push(value.when);
        const start = strictUtc(step?.started_at), end = strictUtc(step?.completed_at);
        // GitHub's REST step times are rounded to seconds while log lines
        // retain fractional timestamps. One-second tolerance only.
        need(start !== null && end !== null &&
             value.when >= start - 1000 && value.when <= end + 1000,
             'marker-tied-to-executed-step-' + marker);
      }
    }
    need(observedMarkers.length === p.markers.length &&
         observedMarkers.every((t,i) => i===0 || t >= observedMarkers[i-1]),
         'marker-chronological-order');
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
      runnerGroupName: job.runner_group_name,
      hostedRunnerEvidence: 'GITHUB_HOSTED_GROUP_AND_RUNNER_IMAGE_LOG',
      hostedRunnerAttestation: 'API_AND_RUNNER_LOG_ONLY_NOT_CRYPTOGRAPHIC',
      executedSteps: steps.length,
      markers: [...p.markers],
      sourceCheckout: false,
      guestTestsExecuted: false,
      backendParity: 'NOT_EXECUTED'
    }
  };
}
