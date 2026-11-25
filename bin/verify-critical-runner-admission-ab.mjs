// Source-free readback consistency: this does not authenticate Actions or
// grant cross-organization private-source transfer approval.
const sha40 = /^[0-9a-f]{40}$/;
const expect = (condition, message) => { if (!condition) throw new Error(message); };
export function verifyRunnerAdmissionAB(record) {
  expect(record?.schema === 'oreslang.critical-suspends.sourcefree-runner-admission-ab/1','schema');
  expect(record.outcome === 'RUNNER_ADMISSION_DIVERGENCE_CAUSE_UNDETERMINED','conclusion must not infer root cause');
  expect(record.budget_available_claim === false,'no billing balance claim');
  expect(record.mirror_authorized === false && record.private_source_transferred === false,'no source transfer authorization');
  expect(record.same_job_definition === true,'jobs are not equivalent');
  const source=record.source, other=record.alternate;
  expect(source?.repository === 'ores-truffle-oreslang/oreslang-platform-conformance','source repository');
  expect(other?.repository === 'gha-indie-worker/gha-indie-worker-docs','alternate repository');
  expect(source.repository !== other.repository,'must compare organizations');
  for (const [key,entity] of [['source',source],['alternate',other]]) {
    expect(sha40.test(entity.commit) && sha40.test(entity.tree) && sha40.test(entity.workflow_blob),key+' pinned Git identity');
    expect(typeof entity.branch === 'string' && entity.branch.length > 0,key+' branch');
    expect(Number.isSafeInteger(entity.run_id) && entity.run_id > 0,key+' run id');
    expect(Number.isSafeInteger(entity.run_attempt) && entity.run_attempt >= 1,key+' run attempt');
    expect(Number.isSafeInteger(entity.job_id) && entity.job_id > 0,key+' job id');
    expect(entity.job_name === 'runner-admission',key+' same job name');
  }
  expect(source.run_conclusion === 'failure' && source.job_conclusion === 'failure' &&
         source.steps === 0 && source.logs_available === false,'source must remain unexecuted');
  expect(other.run_conclusion === 'success' && other.job_conclusion === 'success' &&
         other.steps === 4 && other.logs_available === true,'alternate steps cannot be forged');
  expect(JSON.stringify(other.named_steps) === JSON.stringify([
    'Set up job','Check allocated runner','Verify second executed step','Complete job'
  ]),'alternate named steps');
  expect(JSON.stringify(other.log_markers) === JSON.stringify([
    'SOURCE_FREE_RUNNER_ADMITTED=1','SOURCE_FREE_TWO_STEPS_EXECUTED=1'
  ]),'source-free log markers');
  expect(record.source_org_branch_protection_observed === false &&
         JSON.stringify(record.security_incidents_open) === JSON.stringify([22,77,127]),
         'security gates must remain unresolved');
  return Object.freeze({
    classification:'SOURCE_FREE_CAPACITY_COMPARISON_ONLY',
    source_steps:0,alternate_steps:4,private_source_mirror_authorized:false
  });
}
