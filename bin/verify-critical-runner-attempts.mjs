// Offline source-free evidence consistency. Authenticity comes only from independently
// re-reading GitHub run_attempt, jobs and logs; this file cannot grant any export.
const SHA=/^[a-f0-9]{40}$/;
const check=(x,msg)=>{if(!x)throw new Error(msg)};
export function verifyRunnerAttemptComparison(data, original) {
  check(data?.schema==='atto.critical-runner-admission-two-attempt-comparison/1','schema');
  check(original?.schema==='oreslang.critical-suspends.sourcefree-runner-admission-ab/1','original schema');
  check(data.head_immutable===true,'immutable head claim');
  for(const [side,expectSteps,expectOutcome,expectDiagnostic] of [
    ['source',0,'failure','RUNNER_NOT_ADMITTED'],
    ['alternate',4,'success','SOURCE_FREE_RUNNER_ADMITTED']
  ]) {
    const item=data[side],old=original[side];
    check(item && old && item.repository===old.repository && item.head===old.commit &&
      item.tree===old.tree && item.run_id===old.run_id,'origin identity '+side);
    check(SHA.test(item.head) && SHA.test(item.tree),'full SHA '+side);
    check(Array.isArray(item.attempts) && item.attempts.length===2,'two attempts required '+side);
    const jobs=new Set();
    for(const [idx,entry] of item.attempts.entries()) {
      check(entry.attempt===idx+1 && Number.isSafeInteger(entry.job_id) && entry.job_id>0,
        'attempt ordinal / job ID '+side);
      check(!jobs.has(entry.job_id),'duplicate job ID '+side);jobs.add(entry.job_id);
      check(entry.executed_steps===expectSteps && entry.conclusion===expectOutcome &&
            entry.diagnostic===expectDiagnostic && entry.verified_logs===(side==='alternate'),
            'runner observation '+side);
    }
    check(item.attempts[0].job_id===old.job_id &&
      item.attempts[0].executed_steps===old.steps,'original attempt drift '+side);
  }
  check(data.source.run_id!==data.alternate.run_id,'different organizations/runs');
  check(data.private_source_transferred===false &&
    data.source_git_tree_mirrored===false &&
    data.authorization_status==='NOT_AUTHORIZED' &&
    data.budget_remaining_verified===false &&
    data.root_cause_verified===false,'no authorization or billing conclusion');
  check(data.incident_gate?.all_closed_completed===false &&
    JSON.stringify(data.incident_gate.required)===JSON.stringify([22,77,127]) &&
    data.source_main_protected===false,'governance hold');
  check(data.native_compiler_execution_verified===false &&
    data.guest_runtime_execution_verified===false &&
    data.source_org_actions_execution==='NOT_EXECUTED' &&
    data.alternate_org_actions_execution==='SOURCE_FREE_STEPS_EXECUTED' &&
    data.canary_scope==='source-free-host-runner-only','evidence-class boundary');
  return Object.freeze({
    classification:'SOURCE_FREE_RUNNER_ADMISSION_DIVERGENCE_ONLY',
    attempts_per_org:2,source_executed_steps:0,alternate_executed_steps:8,
    source_transfer_approved:false,compiler_guest_verified:false
  });
}
