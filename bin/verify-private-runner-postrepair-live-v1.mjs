#!/usr/bin/env node
// Read-only source-org private GitHub runner attestation. No checkout, no
// repository source export, no changes to org settings or billing.
import { execFileSync } from 'node:child_process';
import { PRIVATE_RUNNER_CONTROL as p, qualifySourceOrgPrivateRunner } from
  '../verification/qualify-private-runner-admission-v1.mjs';

const prefix = '/repos/' + p.repository;
const api = (suffix, maxBuffer=262144) => {
  // Hard-coded CLI executable and argument vector, never an interpolated shell.
  // GitHub-hosted Linux runners provide /usr/bin/gh; the caller must use
  // their own authenticated gh session or an appropriately scoped GH_TOKEN.
  return execFileSync('/usr/bin/gh',
    ['api', '-X', 'GET', '-H', 'Accept: application/vnd.github+json', prefix + suffix],
    {encoding:'utf8', timeout:30000, maxBuffer, stdio:['ignore','pipe','pipe']});
};
const json = suffix => JSON.parse(api(suffix));
const emit = (value, exit=1) => {
  process.stdout.write(JSON.stringify(value,null,2)+'\n');
  process.exitCode=exit;
};
try {
  const run=json('/actions/runs/'+p.runId);
  const attempt=run?.run_attempt;
  if (!Number.isSafeInteger(attempt) ||
      attempt <= p.lastKnownFailedAttempt ||
      run.status !== 'completed' ||
      run.conclusion !== 'success') {
    emit({
      evidenceClass:'RUNNER_NOT_EXECUTED',
      verified:false,
      runId:p.runId,
      observedAttempt:Number.isSafeInteger(attempt)?attempt:null,
      reason:'No successful post-repair attempt; do not retry before admin fix',
      guestTestsExecuted:false,backendParity:'NOT_EXECUTED'
    });
  } else {
    const page=json('/actions/runs/'+p.runId+'/attempts/'+attempt+'/jobs?per_page=100');
    if (page?.total_count !== 1 || !Array.isArray(page?.jobs) ||
        page.jobs.length !== 1 || !Number.isSafeInteger(page.jobs[0]?.id)) {
      emit({evidenceClass:'RUNNER_NOT_EXECUTED',verified:false,
        reason:'Incomplete or ambiguous job page'});
    } else {
      const job=json('/actions/jobs/'+page.jobs[0].id);
      const workflow=json('/contents/'+p.workflowPath+'?ref='+p.sourceHead);
      let log='';
      try { log=api('/actions/jobs/'+job.id+'/logs'); } catch { /* fail closed */ }
      const result=qualifySourceOrgPrivateRunner({run,page,job,workflow,log});
      if (!result.ok) {
        emit({evidenceClass:'RUNNER_NOT_EXECUTED',verified:false,
          runId:p.runId,attempt,
          errors:result.errors,guestTestsExecuted:false,backendParity:'NOT_EXECUTED'});
      } else {
        emit({verified:true,...result.receipt},0);
      }
    }
  }
} catch {
  // GitHub token, HTTP error content, and account data must not be printed.
  emit({evidenceClass:'RUNNER_NOT_EXECUTED',verified:false,
    reason:'Authenticated read-only GitHub evidence unavailable',
    guestTestsExecuted:false,backendParity:'NOT_EXECUTED'});
}
